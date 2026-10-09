/**
 * 握手校验：来源（Origin）+ 一次性短 TTL 令牌（002 T3.2 / REQ-7.2 / REQ-7.5）
 *
 * 两条独立的判据，顺序固定 **Origin → 令牌**：
 * ① Origin 是浏览器**一定会带**的头（WS 无法伪造），跨源请求必须就地拒绝；
 * ② 令牌挡的是「同源但非本页」的发起方（同源页面/扩展/另一个标签页）。
 *
 * 🔴 **失败关闭**：`allowedOrigins` 为空 ⇒ 一律拒绝（不是「放行一切」）。这条是刻意的 ——
 * 配置漏填时的默认行为必须是「通道不可用」，而不是「通道裸奔」。
 *
 * 🔴 失败文案是**固定字符串**，绝不拼接实例/配置信息（REQ-7.2「SHALL NOT 泄露实例信息」）；
 * 判据与文案的对应关系由 T3.2 的测试钉死（响应体不含任何实例信息）。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TERM_WS_TOKEN_PENDING_MAX, TERM_WS_TOKEN_TTL_MS, WS_TOKEN_HEADER, WS_TOKEN_QUERY_PARAM } from './constants.ts';
import type { HeaderBag, HttpRequestLike } from './types.ts';

/** 令牌兑换结果：区分「没见过」与「过期」只为让用户看到不同的原因，两者都拒绝 */
export type TokenRedeemResult = 'ok' | 'unknown' | 'expired';

/**
 * 一次性令牌表。
 *
 * **一次性**的实现方式：`redeem` 先取后删（无论结果如何都删）—— 这样「拿过期令牌反复试」
 * 也不会留下任何可用状态，且不会因为「先判过期再删」的写法在过期分支漏删。
 */
export interface TokenStore {
  readonly ttlMs: number;
  /** 未使用且未过期的令牌数（测试与日志用） */
  readonly pending: number;
  /** 下发一枚新令牌（Host 在页面挂载时调用） */
  issue(now?: number): string;
  /** 兑换（**只能用一次**）；`now` 可注入，便于用假时钟测过期 */
  redeem(token: string, now?: number): TokenRedeemResult;
}

export interface TokenStoreOptions {
  readonly ttlMs?: number | undefined;
  readonly capacity?: number | undefined;
  /** 令牌生成器（默认 `randomBytes(24).toString('base64url')`；测试注入固定值便于断言） */
  readonly generate?: (() => string) | undefined;
}

export function createTokenStore(options: TokenStoreOptions = {}): TokenStore {
  const ttlMs = options.ttlMs ?? TERM_WS_TOKEN_TTL_MS;
  const capacity = options.capacity ?? TERM_WS_TOKEN_PENDING_MAX;
  const generate = options.generate ?? (() => randomBytes(24).toString('base64url'));
  // Map 保持插入序 ⇒ 「丢最旧」= 删第一个 key，不需要另存队列
  const issued = new Map<string, number>();

  const sweep = (now: number): void => {
    for (const [token, expiresAt] of issued) {
      if (expiresAt <= now) issued.delete(token);
    }
  };

  return {
    ttlMs,
    get pending(): number {
      return issued.size;
    },
    issue(now = Date.now()): string {
      sweep(now);
      while (issued.size >= capacity) {
        const oldest = issued.keys().next();
        if (oldest.done === true) break;
        issued.delete(oldest.value);
      }
      const token = generate();
      issued.set(token, now + ttlMs);
      return token;
    },
    redeem(token: string, now = Date.now()): TokenRedeemResult {
      const expiresAt = issued.get(token);
      if (expiresAt === undefined) return 'unknown';
      issued.delete(token);
      return expiresAt <= now ? 'expired' : 'ok';
    },
  };
}

/**
 * Origin 归一化：去首尾空白、去尾斜杠、转小写。
 *
 * 为什么必须归一化：`Origin` 是**精确串**（`http://127.0.0.1:19387` 与 `http://127.0.0.1:19387/`
 * 是不同字符串），而配置里手写的允许项两种写法都可能出现 —— 不归一化就会变成「配置看着对、
 * 通道拒了」的幽灵故障（§7：任何失败都要让用户看到原因，而这类失败连原因都看不出）。
 */
export function normalizeOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.replace(/\/+$/, '').toLowerCase();
}

/** 来源是否在允许列表内（**空列表 = 全拒**，见文件头） */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  const normalized = normalizeOrigin(origin);
  if (normalized === undefined) return false;
  for (const allowed of allowedOrigins) {
    if (normalizeOrigin(allowed) === normalized) return true;
  }
  return false;
}

/** 定长安全比较（长度不同直接 false：`timingSafeEqual` 对长度不等会抛） */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** 大小写不敏感地取头（数组取第一个：Node 对重复头给数组） */
export function readHeader(headers: HeaderBag, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first === 'string' ? first : undefined;
    }
    return undefined;
  }
  return undefined;
}

/**
 * 从请求里读令牌：查询参数 → 专用头 → `Authorization: Bearer`。
 *
 * 三条都认的理由：查询参数是**浏览器**唯一自然可用的通道（WS 构造函数不能自定义头）；
 * 专用头与 Bearer 是非浏览器客户端/测试的顺手写法。三者优先级固定，避免歧义。
 */
export function readHandshakeToken(req: {
  readonly url?: string | undefined;
  readonly headers: HeaderBag;
}): string | undefined {
  if (req.url !== undefined) {
    try {
      const parsed = new URL(req.url, 'http://dsh.invalid');
      const fromQuery = parsed.searchParams.get(WS_TOKEN_QUERY_PARAM);
      if (fromQuery !== null && fromQuery !== '') return fromQuery;
    } catch {
      // 畸形 url 不该让校验抛错：退到请求头路径继续判（最终仍会因缺令牌被拒）
    }
  }
  const fromHeader = readHeader(req.headers, WS_TOKEN_HEADER);
  if (fromHeader !== undefined && fromHeader !== '') return fromHeader;
  const authorization = readHeader(req.headers, 'authorization');
  if (authorization !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1] !== undefined && match[1] !== '') return match[1];
  }
  return undefined;
}

export type HandshakeFailureCode = 'origin-missing' | 'origin-denied' | 'token-missing' | 'token-invalid' | 'token-expired';

export type HandshakeResult =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly code: HandshakeFailureCode;
      /** HTTP 状态码（upgrade 被拒时写进响应行；list 路由直接用它） */
      readonly status: number;
      /** 固定文案：**不含**任何实例/配置信息（REQ-7.2） */
      readonly message: string;
    };

export interface HandshakeOptions {
  readonly tokens: TokenStore;
  readonly allowedOrigins: readonly string[];
  /** 可注入时钟（测试过期路径用；缺省 `Date.now`） */
  readonly now?: (() => number) | undefined;
}

/**
 * 握手校验（upgrade 与 list 路由**共用同一个函数** —— REQ-7.5 要求 list 同样过握手，
 * 共用实现才能保证两条路径不会漂移成两套判据）。
 */
export function validateHandshake(req: HttpRequestLike, options: HandshakeOptions): HandshakeResult {
  const origin = readHeader(req.headers, 'origin');
  if (normalizeOrigin(origin) === undefined) {
    return { ok: false, code: 'origin-missing', status: 403, message: '缺少 Origin 头：拒绝建立未授权通道。' };
  }
  if (!isOriginAllowed(origin, options.allowedOrigins)) {
    return { ok: false, code: 'origin-denied', status: 403, message: 'Origin 不在允许列表内：拒绝建立未授权通道。' };
  }
  const token = readHandshakeToken(req);
  if (token === undefined) {
    return { ok: false, code: 'token-missing', status: 401, message: '缺少一次性令牌：拒绝建立未授权通道。' };
  }
  const now = options.now?.() ?? Date.now();
  const redeemed = options.tokens.redeem(token, now);
  if (redeemed === 'unknown') {
    return { ok: false, code: 'token-invalid', status: 401, message: '令牌无效或已被使用：拒绝建立未授权通道。' };
  }
  if (redeemed === 'expired') {
    return { ok: false, code: 'token-expired', status: 401, message: '令牌已过期：请重新打开页面获取新令牌。' };
  }
  return { ok: true, token };
}
