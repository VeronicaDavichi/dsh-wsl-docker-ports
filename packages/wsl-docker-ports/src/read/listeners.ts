/**
 * `ss -ltn` 的**纯解析面**（013）—— 零进程、零 `dsh-wsl-shared` 依赖
 *
 * ## 为什么从 `listeners-probe.ts` 拆出来
 *
 * 判决引擎（`diff/engine.ts`）要按 `connectPort` 查监听表，于是它需要 `isWildcardBind` 等小函数；
 * 而引擎经 `write/index.ts` 的运行时再导出**已经在客户端 chunk 的依赖图里**
 * （`chunk-ports.ts` 的注释写着这条边）。若引擎直接从探针文件 import，就会把
 * `execInDistro` → `node:child_process` 拖进浏览器 bundle（实测 esbuild 直接报
 * `Could not resolve "node:child_process"`）。
 *
 * ⇒ 拆分口径：**纯函数（解析 / 绑定分类 / 类型）在这里；进程与 001 的错误映射留在探针文件里**。
 * 浏览器只可能拿到这个文件，永远拿不到 `dsh-wsl-shared`。
 */

/** 一条监听项：`port` = 监听端口，`bind` = 本地地址的**原文**（`0.0.0.0` / `*` / `[::]` / `127.0.0.1` / 具体 IP） */
export interface ListenerEntry {
  readonly port: number;
  readonly bind: string;
}

/**
 * 引擎只需要「成功表 / 失败」两态 ⇒ 最小输入类型。
 * （`ListenersOutcome` 的失败分支带 message/hint/raw，全部对引擎无意义。）
 */
export type ListenerTable =
  | { readonly ok: true; readonly entries: readonly ListenerEntry[] }
  | { readonly ok: false; readonly reason: string };

/** 通配绑定（内核语法三种写法都见得到：IPv4 `0.0.0.0`、ss 简写 `*`、IPv6 `[::]`/`::`） */
const WILDCARD_BINDS: readonly string[] = ['0.0.0.0', '*', '[::]', '::'];
/** 回环绑定：只有本机可连 ⇒ portproxy（从 Windows 侧发起）连不到它 */
const LOOPBACK_BINDS: readonly string[] = ['127.0.0.1', '[::1]', '::1'];

export function isWildcardBind(bind: string): boolean {
  return WILDCARD_BINDS.includes(bind);
}

export function isLoopbackBind(bind: string): boolean {
  return LOOPBACK_BINDS.includes(bind);
}

/** 绑定地址**就是本机 eth0**（`[<ip>]` 也认，ss 对 IPv6 形态可能带方括号） */
export function isEth0Bind(bind: string, eth0Ip: string): boolean {
  if (eth0Ip.length === 0) return false;
  return bind === eth0Ip || bind === `[${eth0Ip}]`;
}

/** `ss -ltn` 的本地地址列 → `{port, bind}`；认不出返回 `null`（由调用方当 parse-error） */
function splitBindPort(token: string): ListenerEntry | null {
  // 端口永远在**最后一个冒号**之后：IPv4 / `*` / `[::]` 三种形态都成立
  const at = token.lastIndexOf(':');
  if (at <= 0) return null;
  const bind = token.slice(0, at);
  const portText = token.slice(at + 1);
  if (!/^[0-9]{1,5}$/u.test(portText)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { port, bind };
}

/**
 * 解析 `ss -ltn` 的真实输出（纯函数，零进程）。
 *
 * 逐行取**第 4 列**（`State Recv-Q Send-Q Local-Address:Port Peer-Address:Port`）：
 *
 * ```
 * State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
 * LISTEN 0      4096         0.0.0.0:3306       0.0.0.0:*
 * LISTEN 0      4096           [::]:22            [::]:*
 * LISTEN 0      4096             *:8080             *:*
 * ```
 *
 * - **只认 `LISTEN` 行**：表头与其它状态一律跳过（`-t` 已过滤，但不同版本仍可能多打东西）；
 * - **认不出的 LISTEN 行 ⇒ 抛错**（不是跳过）：静默丢一条就等于把「有服务」说成「没有」，
 *   而那正是本 Spec 要消灭的错误判决 —— 宁可整表判 `parse-error`。
 */
export function parseSsListeners(text: string): ListenerEntry[] {
  const entries: ListenerEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const columns = line.split(/\s+/u);
    if ((columns[0] ?? '').toUpperCase() !== 'LISTEN') continue;
    const local = columns[3];
    if (local === undefined) throw new Error(`无法识别的 LISTEN 行（缺本地地址列）：${line}`);
    const entry = splitBindPort(local);
    if (entry === null) throw new Error(`无法解析本地地址「${local}」`);
    entries.push(entry);
  }
  return entries;
}
