/**
 * **共享错误模型**（016）—— 两个插件包各自的路由/装配都只经这几件把「未知错误」变成可读结果。
 *
 * ## 为什么抽到 core
 *
 * 拆包前两侧各写一遍 `error instanceof Error ? error.message : String(error)`
 * （`route.ts` / `containers/route.ts` / 几个装配点），拆包后如果各自再写一遍，
 * 「同一类失败在两个包里说两种话」就只是时间问题。这里给**一个**归一化口径，
 * 顺带把「哪些码算上游不可用」做成表 —— 两侧的 HTTP 状态映射都从同一张表取词。
 *
 * ## 边界（**不**包含业务码）
 *
 * 业务错误码（`port-not-managed` / `docker-failed` …）属于各自的传输契约，留在各自的 `wire.ts`：
 * 把两套码塞进 core 等于让共享库知道两个插件的状态机。这里只有「进程/解析/未知」三层。
 */

/** 错误归一化：任何 `unknown`（含字符串、对象、`Error`）都变成**非空**一句话 */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    const message = value.message.trim();
    return message === '' ? value.name : message;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? '未知错误（空字符串）' : text;
  }
  if (value === null || value === undefined) return '未知错误（没有错误对象）';
  try {
    const text = JSON.stringify(value);
    return text === undefined || text === '{}' ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** 取 Node/宿主错误的机器码（`ENOENT` / `Timeout` / `NonZeroExit` …）；没有 ⇒ `undefined` */
export function errorCodeOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() !== '' ? code : undefined;
}

/**
 * 「进程/依赖层」失败的三分类 —— 两侧路由据此决定是 500（我们自己的问题）还是 502/503（上游不可用）。
 *
 * 判据刻意只看**码**（不看文案）：文案会随 locale 变，码不会。
 */
export type UpstreamFailureClass = 'missing-tool' | 'timeout' | 'non-zero-exit' | 'unexpected';

export function classifyUpstreamFailure(
  value: unknown,
): UpstreamFailureClass {
  const code = errorCodeOf(value);
  if (code === 'CommandNotFound' || code === 'ENOENT') return 'missing-tool';
  if (code === 'Timeout' || code === 'ETIMEDOUT') return 'timeout';
  if (code === 'NonZeroExit' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'non-zero-exit';
  return 'unexpected';
}
