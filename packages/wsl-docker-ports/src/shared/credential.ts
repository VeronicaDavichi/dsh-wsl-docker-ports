/**
 * **共享凭据面**（015 `P1`）—— 008/010 的「插件自有凭据」底座，搬到 `src/shared/` 供两侧共用。
 *
 * ## 为什么凭据底座可以共享、而凭据本身不能
 *
 * 共享的是**比较算法与取值规则**（`sha256` + `timingSafeEqual`、`?token=` → `Authorization: Bearer`、
 * 未配置 ⇒ fail-safe 401、拒绝文案固定且不回显）。**不共享**的是：哪份配置、哪个命名空间、提示里
 * 写哪个行 id —— 那些由调用方经 `hint` 传进来（015 R4「凭据/票据按行 id 隔离」）。
 *
 * ⇒ 两侧各持一个 `createWriteAuthenticator(configSource, hint)` 实例、各读自己的 `writeToken`；
 * A 的令牌打不通 B 的通道（015 A3 的判据），而比较语义**只有一份实现**。
 *
 * ## 口径（原样保留，逐条都有既有回归用例）
 *
 * 1. **未配置 ⇒ 一律拒绝**（fail-safe）；默认必须是「通道不可用」，不能是「通道裸奔」。
 * 2. **配置了 ⇒ 常量时间比较**：两侧先 `sha256` 再 `timingSafeEqual` ⇒ 任何长度都走同一条代码路径。
 * 3. **绝不回显/记录凭据**：拒绝文案是固定文本，审计里也不可能出现凭据。
 *
 * 判据用例仍在 `tests/unit/transport-write-auth.test.ts`（`transport/write-auth.ts` 再导出本文件）。
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { readConfigToken } from './config-read.ts';
import type { ConfigValueSource } from './config-read.ts';

/** 请求面（只要 `url` 与可选的 `headers`） */
export interface CredentialRequestLike {
  readonly url?: string | undefined;
  readonly headers?: WriteHeaderBag | undefined;
}

/** 头袋（大小写不敏感取值；重复头取第一个 —— 与 002 的 `HeaderBag` 同一假设） */
export type WriteHeaderBag = Record<string, string | readonly string[] | undefined>;

/** 凭据的查询参数名（与宿主 GUI 入口 `…/?token=…`、002 的 `WS_TOKEN_QUERY_PARAM` 逐字一致） */
export const WRITE_TOKEN_QUERY_PARAM = 'token';

/** 凭据的头名（`Authorization: Bearer <令牌>`） */
export const WRITE_AUTHORIZATION_HEADER = 'authorization';

/**
 * 「配置路径提示」的**缺省实现**：只说「给本插件配置项的 `writeToken` 字段加随机长串」，
 * **不指定是哪一个**（015 R3：字段名与行 id 属业务，由调用方经 `configHint` 传入）。
 *
 * ⚠️ 转发侧/容器侧各有一份带行 id 的长文案（`transport/write-auth.ts` 与
 * `containers/credential.ts`）；未传 `configHint` 时用本句，保证「未配置」的拒绝仍然是
 * **可操作**的（不是只说「拒绝」）。
 */
export const GENERIC_CREDENTIAL_HINT =
  '配置方法：给本插件的配置项加一项 `writeToken`（随机长串），保存后即时生效；之后以 ' +
  '`Authorization: Bearer <令牌>` 或 `?token=<令牌>` 调用本通道。';

/** 鉴权失败：只有 `unauthorized` 一个码（401）⇒ 与既有 404/405/503 的语义不重叠 */
export interface WriteAuthFailure {
  readonly ok: false;
  readonly code: 'unauthorized';
  /** 人类可读原因（REQ-NFR-4 的中文口径）；**固定文本**，绝不回显凭据 */
  readonly message: string;
  /** 本次请求**是否带了凭据**（纯布尔事实：审计/诊断只允许记这个，不记凭据本体） */
  readonly presented: boolean;
}

export type WriteAuthResult = { readonly ok: true; readonly presented: true } | WriteAuthFailure;

export interface WriteAuthenticator {
  /** 是否配置了 `writeToken`（`false` ⇒ 所有写请求 401；**不泄露凭据本体**） */
  readonly configured: boolean;
  /** 判定一次请求：**不读请求体、不调 deps、不写审计**（判定必须发生在一切副作用之前） */
  authorize(request: CredentialRequestLike): WriteAuthResult;
}

/**
 * 常量时间比较：两侧都先 `sha256`（定长 32 字节）再 `timingSafeEqual`。
 * ⇒ 长度不等也只是摘要不同，**不会抛**、**不走分支**，比较耗时与输入长度无关。
 */
function constantTimeEquals(left: string, right: string): boolean {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** 大小写不敏感地取头（数组取第一个：Node 对重复头给数组）；缺 ⇒ `undefined` */
function readHeader(headers: WriteHeaderBag | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first: unknown = value[0];
      return typeof first === 'string' ? first : undefined;
    }
    return undefined;
  }
  return undefined;
}

/**
 * 从请求里取凭据：`?token=` → `Authorization: Bearer`。
 * 畸形 url **不抛**（退到头路径继续判，最终仍会因缺凭据被拒）；空串一律当「没带」。
 */
export function readWriteCredential(request: CredentialRequestLike): string | undefined {
  if (typeof request.url === 'string' && request.url !== '') {
    try {
      const value = new URL(request.url, 'http://dsh.invalid').searchParams.get(WRITE_TOKEN_QUERY_PARAM);
      if (value !== null && value !== '') return value;
    } catch {
      // 见上：不抛，继续判头
    }
  }
  const authorization = readHeader(request.headers, WRITE_AUTHORIZATION_HEADER);
  if (authorization !== undefined) {
    const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
    const bearer = match?.[1];
    if (bearer !== undefined && bearer !== '') return bearer;
  }
  return undefined;
}

/**
 * 造一个鉴权器（**一次注册一个实例**，但**每次请求现读凭据**）。
 *
 * @param source 插件配置里的 `writeToken`：字符串 / volatile 活体包装 / 零参取值函数三类都收；
 *   解包后为空/空白/非串 ⇒ **未配置** ⇒ 一律拒绝（fail-safe）。
 * @param configHint 未配置时的**配置路径提示**（不含凭据本体）。**必填**：共享层不认识
 *   两个命名空间，也不认识行 id（015 R3）—— 提示写错行会让人去改另一行的配置。
 *
 * 🔴 **为什么每次现读而不是注册期拍一次**：`Config` 全部字段标了 volatile ⇒ `update` 是**原地**更新、
 * 不重挂载；若把凭据拍在注册期，用户在配置页轮换凭据后宿主仍拿旧值 ⇒ 新凭据一律 401。
 * `configured` 也做成 getter，同一条理由。
 */
export function createWriteAuthenticator(source: ConfigValueSource, configHint: string = GENERIC_CREDENTIAL_HINT): WriteAuthenticator {
  /** 每次现读并归一化：空/空白/非串 ⇒ `undefined`（= 未配置） */
  const expectedToken = (): string | undefined => readConfigToken(source);

  const deny = (message: string, presented: boolean): WriteAuthFailure => ({
    ok: false,
    code: 'unauthorized',
    message,
    presented,
  });

  return {
    get configured(): boolean {
      return expectedToken() !== undefined;
    },
    authorize(request: CredentialRequestLike): WriteAuthResult {
      const supplied = readWriteCredential(request);
      const expected = expectedToken();
      if (expected === undefined) {
        return deny(`未配置写通道凭据：拒绝所有写请求（plan / apply / audit 一律 401，fail-safe）。${configHint}`, supplied !== undefined);
      }
      if (supplied === undefined) {
        return deny('缺少写通道凭据：拒绝本次请求（零执行、零写入、零审计）。', false);
      }
      if (!constantTimeEquals(supplied, expected)) {
        return deny('写通道凭据不正确：拒绝本次请求（零执行、零写入、零审计）。', true);
      }
      return { ok: true, presented: true };
    },
  };
}
