/**
 * WS 通道的命名常量（002 Phase 3 / REQ-7.1 / REQ-7.2 / REQ-7.7）
 *
 * 为什么不塞进 `../limits.ts`：那边的口径是**会话/屏幕**的界（尺寸夹紧、增量缓冲），
 * 这边的界是**通道**的界（令牌 TTL、待发队列）。两套界的调参动机不同，混在一起会让
 * 「改 TTL」这种小事也动到 PTY 相关常量。文件边界由 Phase 3 的任务书钉死（只能写 `src/ws/**`）。
 *
 * ⚠️ 队列上限**直接复用** `limits.ts` 的两个命名常量（不是另抄数字）：T3.4 的判据要求
 * 「队列长度 ≤ `limits.ts` 里的命名常量」，复用后测试引用常量而非数字，调参会立刻反映。
 * 语义上也自洽：会话侧缓冲按 `256 块 × 256KB` 配平，通道侧待发队列用同一组界，
 * 两侧谁先撞界都收敛到同一条「丢 + 明确告知 + 附快照」的路径（REQ-6.4 / REQ-7.7）。
 */

import { TERM_BUFFER_MAX_BLOCKS, TERM_BUFFER_MAX_BYTES } from '../limits.ts';

/** 具名 HTTP 路由的**独占前缀**（REQ-7.1；HTTP 侧用 `kind: 'prefix'`） */
export const TERM_WS_HTTP_PREFIX = '/dsh-managed-terminal/';

/**
 * upgrade 的**单一 exact 端点**（REQ-7.1）。
 * ⚠️ 宿主 `registerUpgrade` 只接受 exact path ⇒ 「独占前缀的 upgrade」不成立，
 * 多终端只能靠协议层的 `instanceId` 复用这一个端点。
 */
export const TERM_WS_UPGRADE_PATH = '/dsh-managed-terminal/ws';

/** 实例枚举端点（REQ-7.5：与 upgrade 同一套握手校验） */
export const TERM_WS_LIST_PATH = '/dsh-managed-terminal/instances';

/**
 * 一次性令牌的存活期。30s 覆盖「页面挂载 → 建连」这段人手不可能超过的间隔；
 * 再长就是白白拉大窗口（令牌出现在 URL 里，会被历史记录/日志抄走）。
 */
export const TERM_WS_TOKEN_TTL_MS = 30_000;

/**
 * 未使用的令牌数量上限。页面反复挂载但从不建连时会堆积 ⇒ 必须有界（REQ-6.4 的同一条精神）。
 * 超出时**先清过期、再丢最旧**（失败关闭方向：宁可让用户重新挂载页面，也不留无限表）。
 */
export const TERM_WS_TOKEN_PENDING_MAX = 64;

/** 单连接**待发队列**的块数上限（= 会话侧缓冲块数，口径见文件头） */
export const TERM_WS_QUEUE_MAX_FRAMES = TERM_BUFFER_MAX_BLOCKS;

/** 单连接**待发队列**的字节上限（同上） */
export const TERM_WS_QUEUE_MAX_BYTES = TERM_BUFFER_MAX_BYTES;

/**
 * 单帧（解帧后）字节上限。挡的是**恶意/损坏的客户端**：长度字段声明 1GB 时不能再去分配。
 * 取 1MiB：正常帧是 PTY 分片（≤4KB），连黏贴回显都远到不了。
 */
export const TERM_WS_MAX_FRAME_BYTES = 1 << 20;

/** RFC 6455 的握手魔数（`Sec-WebSocket-Accept` 的计算输入，不能改） */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 令牌传递的查询参数名（`?token=…`）：页面挂载时由 Host 拼进 URL */
export const WS_TOKEN_QUERY_PARAM = 'token';

/** 令牌传递的请求头名（非浏览器客户端用；与查询参数二选一） */
export const WS_TOKEN_HEADER = 'x-dsh-terminal-token';
