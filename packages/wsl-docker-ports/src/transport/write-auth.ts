/**
 * 008 T2.9 写通道鉴权：**插件自有凭据**（宿主没有可用的鉴权面 ⇒ 走方案 (B)，见 `tasks.md` T2.9）
 *
 * ## 为什么不是「宿主鉴权」（侦察结论，证据见 tasks.md T2.9）
 *
 * 宿主 GUI 入口 URL 确带 `?token=`（T2.8 的真机观察：不带它也照样 200 ⇒ 插件的具名路由**不被**
 * 宿主的 token 门覆盖）。但在本仓**允许读的范围内**找不到任何「把该 token 交给插件」的 API：
 * ① `route.ts` 的 `WebServerRoute`（真机证实过的对象式注册签名）**只有** `kind` / `path` / `handler`
 *    三个字段 —— 没有 `auth` / `token` / `guard` / `authorize`；
 * ② 本仓 `node_modules` 里 `@deepseek-ai/*` 的 23 个包、**1816** 个 js/d.ts/json 产物里
 *    `webServer` **零命中** ⇒ 宿主的 web-server 插件不在可读依赖面内，其声明读不到；
 * ③ 没有任何 `ctx.auth` / `ctx.webServer.token` 之类的成员出现在可读声明里。
 * ⇒ **绝不臆造 API**，改为下面这套插件自有凭据（形态与 002 `ws/auth.ts` 的既有习惯一致）。
 *
 * ## 三条判据（全部离线可判，见 `tests/unit/transport-write-auth.test.ts`）
 *
 * 1. **未配置 ⇒ 一律拒绝**（fail-safe）：`writeToken` 缺失或空白 ⇒ `plan` / `apply` / `audit`
 *    **全部 401**，文案里给出配置方法。默认必须是「通道不可用」，不能是「通道裸奔」。
 * 2. **配置了 ⇒ 常量时间比较**：两侧先 `sha256` 再 `timingSafeEqual` ⇒ **任何长度都走同一条
 *    代码路径**（002 的 `safeEqual` 是长度不等直接 `false`；这里刻意更强：连长度都不经分支，
 *    也绕开 `timingSafeEqual` 对长度不等**抛错**的坑）。
 * 3. **绝不回显/记录凭据**：拒绝文案是**固定文本**（不含凭据本体、不含期望值、不含长度）；
 *    审计里也不可能有凭据 —— `audit.ts` 的白名单拷贝从结构上保证这一点，且 401 路径**不写审计**。
 *
 * ## 凭据怎么带（沿用既有习惯，不自创头名）
 *
 * `?token=<t>`（宿主 GUI 入口与 002 都用 `token` 这个名字；浏览器 fetch 也最省事）
 * 或 `Authorization: Bearer <t>`。优先级 = **查询参数 → 头**（与 002 `readHandshakeToken` 同序）。
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** 请求面（`WriteRequestLike` 的结构子集：只要 `url` 与可选的 `headers`） */
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
 * 配置提示（**不含凭据本体**；未配置时随 401 一起给用户看）。
 * 配置路径 = 既有的「插件 config」那条路（与 `elevationPolicy` 同一处）：
 * profile 的 `cordis.patch.yml` 里那一条 `- id: dsh-wsl-docker-ports` 的 `config:` 块。
 */
export const WRITE_TOKEN_CONFIG_HINT =
  '配置方法：在 profile 的 cordis.patch.yml 里给 `- id: dsh-wsl-docker-ports` 条目加一项 ' +
  '`config: { writeToken: "<随机长串>" }`（与 elevationPolicy 同一处；改完需重载插件），' +
  '之后以 `Authorization: Bearer <令牌>` 或 `?token=<令牌>` 调用本通道。';

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
 * 造一个鉴权器（**一次注册一个实例**：凭据在注册期就定下来，请求期不再读配置）。
 *
 * @param token 插件配置里的 `writeToken`；`undefined` / 空白 ⇒ **未配置** ⇒ 一律拒绝（fail-safe）
 */
export function createWriteAuthenticator(token: string | undefined): WriteAuthenticator {
  const expected = typeof token === 'string' ? token.trim() : '';
  const configured = expected !== '';

  const deny = (message: string, presented: boolean): WriteAuthFailure => ({
    ok: false,
    code: 'unauthorized',
    message,
    presented,
  });

  return {
    configured,
    authorize(request: CredentialRequestLike): WriteAuthResult {
      const supplied = readWriteCredential(request);
      if (!configured) {
        return deny(
          `未配置写通道凭据：拒绝所有写请求（plan / apply / audit 一律 401，fail-safe）。${WRITE_TOKEN_CONFIG_HINT}`,
          supplied !== undefined,
        );
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
