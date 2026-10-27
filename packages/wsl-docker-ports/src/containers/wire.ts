/**
 * 容器侧的 **HTTP 契约**（015 `P2`/`P3`）—— 路径、动作、校验、快照 DTO。
 *
 * ## 🔴 为什么不复用 `src/docker/wire.ts`
 *
 * `src/docker/wire.ts` 是 010 的**转发侧**容器通道（前缀挂在 `/dsh-wsl-docker-ports/container` 下、
 * 用转发侧的 `writeToken`、与转发侧同生共死）。015 的容器侧是**独立一侧**：
 *
 * | | 转发侧（010 遗留） | 容器侧（015） |
 * | --- | --- | --- |
 * | 前缀 | `/dsh-wsl-docker-ports/container` | `/dsh-wsl-docker-containers` |
 * | 凭据 | 转发侧 `writeToken` | 容器侧自己的 `writeToken` |
 * | 数据源 | 转发侧快照里的容器表 | **自己的** `GET /snapshot`（不读 netsh） |
 * | 提权 | 无 | 无（容器动作不需要提权） |
 *
 * 015 `R1` 把 `docker/` 列进容器侧黑名单**就是为了**让两者在 import 图上真的分开：
 * 复用会立刻把「转发侧的容器通道」变成容器侧的数据源，两行又成一棵树。
 *
 * ## 校验口径（与 010 逐条一致，不另立一套）
 *
 * - 容器 id：`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`（docker 自己接受的 name/id 字符集）⇒ 不存在
 *   「id 里带空格/分号」的注入面，也不需要 shell 引号。
 * - 动作：**恰好** `start` / `stop` / `restart`（`exec` / `rm` / `compose` 属于下一期，见 003 分期边界）。
 * - 日志 `tail`：夹紧到 `1..200`；缺省 200。
 * - 请求体上限 **8 KiB**（动作体只有一个 id + action）。
 */

/** 容器侧的 URL 前缀（**独占**：与 `/dsh-wsl-docker-ports` 互不包含，宿主按最长 prefix 分派） */
export const CONTAINERS_PREFIX = '/dsh-wsl-docker-containers';

/** 只读快照（P3）：容器列表 + 目标发行版 + 可读的失败原因 */
export const CONTAINERS_SNAPSHOT_PATH = `${CONTAINERS_PREFIX}/snapshot`;
export const CONTAINERS_SNAPSHOT_METHOD = 'GET';

/** 动作（POST）与日志（GET）—— 两条都要容器侧自己的凭据 */
export const CONTAINERS_ACTION_PATH = `${CONTAINERS_PREFIX}/action`;
export const CONTAINERS_ACTION_METHOD = 'POST';
export const CONTAINERS_LOGS_PATH = `${CONTAINERS_PREFIX}/logs`;
export const CONTAINERS_LOGS_METHOD = 'GET';

/** 允许的动作（**恰好三个**；顺序即 UI 上按钮的顺序） */
export const CONTAINERS_ACTIONS = ['start', 'stop', 'restart'] as const;
export type ContainersAction = (typeof CONTAINERS_ACTIONS)[number];

export const CONTAINER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u;

export function isContainerId(value: unknown): value is string {
  return typeof value === 'string' && CONTAINER_ID_PATTERN.test(value);
}

export function isContainersAction(value: unknown): value is ContainersAction {
  return typeof value === 'string' && (CONTAINERS_ACTIONS as readonly string[]).includes(value);
}

/** 日志尾部行数的边界（与 010 同一组数：`1..200`，缺省 200） */
export const MIN_LOG_TAIL = 1;
export const MAX_LOG_TAIL = 200;
export const DEFAULT_LOG_TAIL = 200;

/** 夹紧 `tail`：缺省/非数/非有限 ⇒ 200；越界 ⇒ 边界值（**不报错**：用户只想要「多一点」） */
export function clampLogTail(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_LOG_TAIL;
  return Math.min(MAX_LOG_TAIL, Math.max(MIN_LOG_TAIL, Math.trunc(parsed)));
}

/** 动作/日志请求体的上限（只有 `{id, action}` 两个字段；超过即 400，不读进内存） */
export const CONTAINERS_BODY_MAX_BYTES = 8 * 1024;

/** 容器侧的错误码（与转发侧码表**故意分开**：两侧的状态机不该互相冒名） */
export type ContainersErrorCode = 'not-found' | 'method-not-allowed' | 'unauthorized' | 'bad-request' | 'docker-failed' | 'internal';

/** 错误码 → HTTP 状态（`docker-failed` = 502：上游 docker 不可用，不是本插件的 500） */
export function statusForContainers(code: ContainersErrorCode): number {
  if (code === 'not-found') return 404;
  if (code === 'method-not-allowed') return 405;
  if (code === 'unauthorized') return 401;
  if (code === 'bad-request') return 400;
  if (code === 'docker-failed') return 502;
  return 500;
}

/** 快照里的容器行（**视图无关**：客户端自己决定怎么排、怎么标色） */
export interface ContainersRow {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly status: string;
  /** 已格式化的端口映射（`0.0.0.0:8080->80/tcp` 这种，按 docker 给的顺序） */
  readonly ports: readonly string[];
}

/** 容器侧自己解析出的目标发行版（**不**复用转发侧的 `DistroPanelData` 结构：容器侧只需要这几个字段） */
export interface ContainersDistro {
  readonly name: string;
  readonly state: string | null;
  /** `config` / `wslDefault` / `onlyOne` / `first`（001 的四态来源，逐字复用 001 的 `DistroSource`） */
  readonly source: string;
  readonly staleConfig: boolean;
  readonly message: string | null;
}

/** 一次可读失败（原因 + 引导；`hint` 可为空串，但**不许**把原始 stderr 拼进来） */
export interface ContainersFailure {
  readonly reason: string;
  readonly message: string;
  readonly hint: string;
}

/** `GET /dsh-wsl-docker-containers/snapshot` 的成功载荷 */
export interface ContainersSnapshot {
  /** `Date.now()` 的 ISO 串（客户端显示「上次刷新」用） */
  readonly generatedAt: string;
  readonly distro: ContainersDistro | null;
  /** 发行版解析失败的原因（与 `distro === null` 配套；两者都为 null 才算「没话说」） */
  readonly distroError: string | null;
  readonly containers: readonly ContainersRow[];
  /** 容器列表读取失败（**不是**空列表：空列表 + 这个字段才叫「读不到」） */
  readonly error: ContainersFailure | null;
  /** 副标题式的说明（例如「`docker ps -a` 整体失败，已退回只看运行中」）；空数组 ⇒ 不显示 */
  readonly notes: readonly string[];
}
