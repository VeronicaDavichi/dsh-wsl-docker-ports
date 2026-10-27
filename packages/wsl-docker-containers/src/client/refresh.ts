/**
 * 自动刷新频次的**纯函数面**（016：容器包自己的一份，只被 chunk 侧引用 ⇒ 主包零字节）
 *
 * 三件事，都刻意做成无副作用、无 React 依赖（于是 `node --test` 也能直接证）：
 * 1. 固定五档（`关闭 / 15 秒 / 30 秒 / 60 秒 / 5 分钟`）——口径与宿主 `config-read.ts` 的读者一致；
 * 2. 归一化：只认这五档，其余（`undefined` / 负数 / 未登记秒数 / 乱码）一律 ⇒ `0`（关闭，fail-safe）；
 * 3. 快照比较：**忽略顶层时间戳**后稳定序列化再比 ⇒ 轮询只在数据真变化时重绘。
 *    容器快照的时间戳字段是 `generatedAt`（见 `containers/source.ts`）。
 *
 * 与转发侧那份的差异只有「时间戳字段名」与「有没有端口快照专用包装」：五档与归一化**逐字相同**
 * （验收要读 `sel-containers-refresh-interval` 的五档）。
 */

export interface RefreshIntervalOption {
  readonly value: number;
  readonly label: string;
}

/** 主人拍板的五档（顺序 = 下拉呈现顺序；`0` = 关闭，也是缺省） */
export const REFRESH_INTERVAL_OPTIONS: readonly RefreshIntervalOption[] = [
  { value: 0, label: '关闭' },
  { value: 15, label: '15 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '60 秒' },
  { value: 300, label: '5 分钟' },
];

/**
 * 归一化刷新频次：数值 / 纯数字字符串都收，**只有五档算合法**；
 * 其余（含 `20`、`-15`、`NaN`、空串、乱码）⇒ `0`（关闭）。
 */
export function normalizeRefreshIntervalSec(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return REFRESH_INTERVAL_OPTIONS.some((option) => option.value === parsed) ? parsed : 0;
}

/** 稳定序列化：对象键排序（键序不同的同一份数据不得被当成变化） */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((item) => stableKey(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
    .join(',')}}`;
}

/**
 * 可比较形态：**剔除顶层指定键**后稳定序列化。
 *
 * 容器快照忽略 `generatedAt`（每次拉取都会变的时间戳，不是数据）⇒「数据未变不重绘」的判据。
 */
export function comparablePayload<T extends object>(value: T, ignoredKeys: readonly string[]): string {
  const record: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of ignoredKeys) delete record[key];
  return stableKey(record);
}
