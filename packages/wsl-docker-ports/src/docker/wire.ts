/**
 * 容器控制（010 `T7.1` / `T7.2`）—— 传输常量与**二值判据**的唯一出口。
 *
 * ## 为什么又占一个前缀
 *
 * 宿主对重复 `(kind, path)` 注册**直接抛错**（003 `route.ts` 的长注释 / 002 的实测）。
 * 本包现有两条：快照 `/dsh-wsl-docker-ports`（003）、写通道 `/dsh-wsl-docker-ports/write`（008）。
 * 容器动作**不经**写通道（010 `REQ-P1-2`：那条通道是系统级转发规则的写路径，含票据 / 审计 / 401，
 * 语义与风险面都不同）⇒ 另占 `/dsh-wsl-docker-ports/container`。
 * 🔴 判据：本目录（`src/docker/**`）的静态扫描里 **`/write/` 前缀命中 = 0**（`tests/unit/docker-wire.test.ts`）。
 */

/** 容器动作 / 日志的独占前缀（**不带尾斜杠**，理由同 `../wire.ts` 的 `PORTS_HTTP_PREFIX`） */
export const CONTAINER_HTTP_PREFIX = '/dsh-wsl-docker-ports/container';

/** `POST`：容器启停 / 重启 */
export const CONTAINER_ACTION_PATH = `${CONTAINER_HTTP_PREFIX}/action`;

/** `GET`：容器日志（`?id=<容器>&tail=<N>`） */
export const CONTAINER_LOGS_PATH = `${CONTAINER_HTTP_PREFIX}/logs`;

export const CONTAINER_ACTION_METHOD = 'POST';
export const CONTAINER_LOGS_METHOD = 'GET';

/**
 * 允许的三个动作（`REQ-11.1` 的字面枚举）。
 * ⚠️ 不含 `kill` / `pause` / `rm`：**写动作白名单**，多的一个都不做（`REQ-11.4` 同源取向：宁可少做）。
 */
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart'] as const;
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

/** 日志尾部条数的界（`REQ-11.2`：`N` 有界、默认 200；**上界就是 200**，不给「拉全量」的入口） */
export const MIN_LOG_TAIL = 1;
export const DEFAULT_LOG_TAIL = 200;
export const MAX_LOG_TAIL = 200;

/** 请求体上限（只有 `{id, action}` 两个短字段；给 8 KiB 已经极宽） */
export const CONTAINER_BODY_MAX_BYTES = 8 * 1024;

/**
 * 容器动作的错误码（与 `PortsErrorCode` / `WriteErrorCode` **并列**，不混用）。
 * `docker-failed` = 命令真跑了但没成功（退出码 / 超时 / 权限），与「请求本身不合法」分开。
 */
export type ContainerErrorCode = 'unauthorized' | 'bad-request' | 'not-found' | 'method-not-allowed' | 'docker-failed' | 'internal';

export interface ContainerErrorBody {
  readonly ok: false;
  readonly error: { readonly code: ContainerErrorCode; readonly message: string };
}

export interface ContainerActionSuccess {
  readonly ok: true;
  readonly action: ContainerAction;
  readonly containerId: string;
}

export interface ContainerLogsSuccess {
  readonly ok: true;
  readonly containerId: string;
  /** 实际生效的尾部条数（**夹紧之后**的值，不是请求里的原值） */
  readonly tail: number;
  /** 日志正文（**只在内存**：`REQ-11.3` 不落盘、不进审计、不进错误文案） */
  readonly text: string;
}

export type ContainerActionResponse = ContainerActionSuccess | ContainerErrorBody;
export type ContainerLogsResponse = ContainerLogsSuccess | ContainerErrorBody;

/** 容器标识的**白名单**（docker 允许 `[a-zA-Z0-9][a-zA-Z0-9_.-]*`）：不合规 ⇒ 400，**不交给 docker 判** */
const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function isContainerId(value: unknown): value is string {
  return typeof value === 'string' && CONTAINER_ID_RE.test(value);
}

export function isContainerAction(value: unknown): value is ContainerAction {
  return typeof value === 'string' && (CONTAINER_ACTIONS as readonly string[]).includes(value);
}

/**
 * 尾部条数夹紧（`REQ-11.2` 的「有界」判据）：缺省 → 200；非整数 / ≤0 → 200；
 * 超过 `MAX_LOG_TAIL` → **夹到 200**（不是拒绝：用户点「日志」不该因为多写一个 0 就失败）。
 */
export function clampLogTail(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < MIN_LOG_TAIL) return DEFAULT_LOG_TAIL;
  return Math.min(parsed, MAX_LOG_TAIL);
}

/** 错误码 → HTTP 状态（二值：每条码只有一个答案，测试逐条断言） */
export function statusForContainer(code: ContainerErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'bad-request':
      return 400;
    case 'not-found':
      return 404;
    case 'method-not-allowed':
      return 405;
    case 'docker-failed':
      return 502;
    case 'internal':
      return 500;
  }
}
