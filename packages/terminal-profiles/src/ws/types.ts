/**
 * WS 通道的类型面（002 Phase 3 / design §2.3）
 *
 * 三层结构，每层只依赖上一层：
 * ① **宿主面**（`WebServerSurface` / `HttpRequestLike` / `UpgradeSocketLike`）—— 本包**不** import
 *    宿主包（零运行时依赖、离线可验证），只把真正用到的成员抄成结构面；
 * ② **字节/文本面**（`FrameSink`）—— 通道核心只认「一帧文本 + 一个 boolean 背压位」，
 *    不认 WS 帧格式（帧编解码在 `./frames.ts`、字节<->文本的粘合在 `./upgrade-socket.ts`）；
 * ③ **协议面**（`ClientMessage` / `ServerMessage`）—— design §2.3 的表**逐字段照抄**。
 *
 * 把 ① 与 ② 隔开的理由：宿主 upgrade 给的是**裸 socket**（Node 的 `upgrade` 事件语义），
 * 但这一点在本机**无法核实**（零真机）。若真机给的是已解帧的 ws-like 对象，只需换掉
 * `./upgrade-socket.ts` 一个文件，通道逻辑与全部单测**一行不动**。
 */

/** 请求头集合（Node 的 `IncomingMessage.headers` 形状：值可能是数组、可能缺） */
export interface HeaderBag {
  readonly [name: string]: string | readonly string[] | undefined;
}

/** 宿主 `webServer` 路由处理器的请求面（只列本层读的成员） */
export interface HttpRequestLike {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
  readonly headers: HeaderBag;
}

/**
 * 宿主 `webServer` 路由处理器的响应面。
 *
 * ⚠️ 形状按 Node `http.ServerResponse` 取（`statusCode` 可写 + `setHeader` + `end`）——
 * **假设**，真机需复核；若宿主给的是别的响应对象，改动点集中在 `./routes.ts` 的 `sendJson`。
 */
export interface HttpResponseLike {
  statusCode?: number | undefined;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export type HttpRouteHandler = (req: HttpRequestLike, res: HttpResponseLike) => void | Promise<void>;

/** upgrade 拿到的**裸 socket**（Node `upgrade` 事件语义：字节进、字节出、可 destroy） */
export interface UpgradeSocketLike {
  /** 返回 false = 内核写缓冲已满（背压信号，不表示写入失败） */
  write(chunk: Uint8Array): boolean;
  destroy(): void;
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  /** 内核缓冲排空（背压解除）⇒ 通道层据此放行待发队列 */
  on(event: 'drain', listener: () => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

/** 具名路由注册项（REQ-7.1：HTTP 用 `prefix`） */
export interface WebServerRoute {
  readonly kind: 'exact' | 'prefix';
  readonly path: string;
  readonly handler: HttpRouteHandler;
}

/** upgrade 注册项（REQ-7.1：**只支持 exact path**） */
export interface WebServerUpgrade {
  readonly path: string;
  readonly handler: (req: HttpRequestLike, socket: UpgradeSocketLike, head?: unknown) => void;
}

/**
 * 宿主 webServer 里本层用到的注册口。
 *
 * 两条已核实事实钉在注释上：**重复 `(kind, path)` 注册会抛错**（所以重挂载时不能二次注册同一路径）、
 * 返回的 disposer 宿主**不会**自动收集（必须登记到 `ctx.effect`，否则卸载后路由残留 = 泄漏）。
 */
export interface WebServerSurface {
  register(route: WebServerRoute): () => void;
  registerUpgrade(upgrade: WebServerUpgrade): () => void;
}

/**
 * 插件上下文里本层用到的部分。
 *
 * 🔴 服务获取走**非严格** `get('webServer')`（返回 `undefined` 由我们自判），
 * 不用 `static inject` —— 缺服务时应当「不注册任何路由」而不是整插件启动失败。
 */
export interface ChannelPluginContext {
  effect(callback: () => void | (() => void)): unknown;
  get(name: string): unknown;
}

/** 通道核心的出口：一帧文本 + 一个背压位（`write` 返回 false = 消费者已暂停） */
export interface FrameSink {
  write(text: string): boolean;
  destroy(): void;
}

/** C→H：`attach`（design §2.3 第一行；令牌在握手时已用掉，这里比对绑定值） */
export interface AttachMessage {
  readonly type: 'attach';
  readonly instanceId: string;
  readonly token: string;
  readonly sinceSeq?: number | undefined;
}

/** C→H：`input`（原样写 PTY，不经 shell 切词） */
export interface InputMessage {
  readonly type: 'input';
  readonly data: string;
}

/** C→H：`resize`（行在前，夹紧在会话层，REQ-5.3） */
export interface ResizeMessage {
  readonly type: 'resize';
  readonly rows: number;
  readonly cols: number;
}

export type ClientMessage = AttachMessage | InputMessage | ResizeMessage;

/** H→C 的 `error.code`：只出**通道层**的词汇（会话层的失败码另在 `SessionFailureCode`） */
export type ServerErrorCode =
  /** 令牌与绑定值不符（REQ-7.2 的后续校验） */
  | 'unauthorized'
  /** 被新连接顶掉（REQ-7.4，实现选择见 design §2.3） */
  | 'superseded'
  /** 帧不是合法 JSON / 字段类型不对 / 顺序不对（先 input 后 attach 等） */
  | 'bad-message'
  /** 还没 attach 就想 input/resize */
  | 'not-attached'
  /** 实例不在表里（已 kill / 从未存在） */
  | 'instance-not-found'
  /** 读屏幕失败（会话层失败码的人话透传） */
  | 'read-failed'
  /** 写输入失败 */
  | 'write-failed'
  /** 改尺寸失败 */
  | 'resize-failed'
  /** 本层未预料的异常 */
  | 'internal';

export interface ServerSize {
  readonly rows: number;
  readonly cols: number;
}

/**
 * H→C 消息（design §2.3 的表逐条对应）。
 *
 * ⚠️ **一处有意的细化**：`attached.snapshot` 允许多一个 `null`。
 * 表里写的是 `{ size, snapshot, seq }`，但 REQ-7.3 的两条路径是互斥的 —— 「续传成功」时
 * 客户端**已经有屏幕**，此时再发一次快照、随后又补发 `sinceSeq` 起的块，同一段输出会在
 * 屏幕上**打印两遍**。故：全新 attach（无 `sinceSeq`）→ `snapshot` 是文本；
 * 续传成功 → `snapshot: null`（=「沿用你已有的屏幕」）；续传失败 → 走 `lost` 并附快照。
 * 字段名与类型位置未变，判空即判别，客户端无需学第二套消息。
 */
export type ServerMessage =
  | { readonly type: 'attached'; readonly size: ServerSize; readonly snapshot: string | null; readonly seq: number }
  | { readonly type: 'chunk'; readonly seq: number; readonly data: string }
  | { readonly type: 'lost'; readonly snapshot: string; readonly seq: number }
  | { readonly type: 'exit'; readonly code: number | null }
  | { readonly type: 'error'; readonly code: ServerErrorCode; readonly message: string };
