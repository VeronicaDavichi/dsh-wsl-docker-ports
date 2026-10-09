/**
 * 配置页的**表单行模型**（002 T6.4；纯函数 ⇒ node 环境就能测，不需要 jsdom）
 *
 * ## 为什么表单用「文本」而不是直接持有结构化值
 *
 * `args`（字符串数组）与 `env`（字符串映射）在输入框里没有原生形态：用户要能**边打字边看**，
 * 而「打到一半」的 `KEY=`、空行、尾随换行都不该让组件崩或静默吞字符。故表单层用文本
 * （`args` 一行一个、`env` 一行一个 `KEY=VALUE`），**转换**在 `draftRow()` 一处完成，
 * 结构化校验仍走宿主同款 `parseRowStructure`（单一判定层，别在 UI 里再写一套字段口径）。
 *
 * ## 转换错误 ≠ 结构错误，但两者都只影响**这一行**（REQ-1.2 / T6.4）
 *
 * `draftRow()` 的 `problems` 是**转换层**的问题（例如 `env` 里有一行没有 `=`）；
 * **结构层**的问题由 `parseRowStructure` 给（缺 `name`、类型错…）。页面把两者合起来标红，
 * 并把有问题的行排除出 patch —— 其余行照常保存（「单条无效不阻塞保存其余」）。
 */

import type { RawProfileRow } from '../config/row-rules.ts';

/** 表单字段（`args` / `env` 是**文本**形态） */
export const EDITABLE_FIELDS = ['name', 'command', 'args', 'cwd', 'cwdLinux', 'env'] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** 表单里的一行（全部字段都是字符串 ⇒ 受控输入不会拿到 `undefined`） */
export type EditableRow = Readonly<Record<EditableField, string>>;

/** 空行（新增按钮用）：必填字段留空 ⇒ 保存时会被 `parseRowStructure` 标出来，不静默丢弃 */
export function emptyRow(): EditableRow {
  return { name: '', command: '', args: '', cwd: '', cwdLinux: '', env: '' };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function linesToArgs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** `env` 文本 → 映射；返回问题列表（**不抛**，问题只影响这一行） */
export function parseEnvText(text: string): { readonly env: Record<string, string>; readonly problems: string[] } {
  const env: Record<string, string> = {};
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const [position, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator <= 0) {
      problems.push(`第 ${position + 1} 行「${line}」不是 KEY=VALUE（缺少「=」或键为空）`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (key === '') {
      problems.push(`第 ${position + 1} 行「${line}」的键为空`);
      continue;
    }
    env[key] = line.slice(separator + 1);
  }
  return { env, problems };
}

/** 配置里的原始行 → 表单行（读回来的值可能不是字符串 ⇒ 一律以空串兜底并在结构校验里现形） */
export function fromRawRow(raw: unknown): EditableRow {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const args = Array.isArray(record['args']) ? record['args'] : [];
  const env = typeof record['env'] === 'object' && record['env'] !== null && !Array.isArray(record['env'])
    ? (record['env'] as Record<string, unknown>)
    : {};
  return {
    name: asText(record['name']),
    command: asText(record['command']),
    args: args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item) ?? '')).join('\n'),
    cwd: asText(record['cwd']),
    cwdLinux: asText(record['cwdLinux']),
    env: Object.entries(env)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value) ?? ''}`)
      .join('\n'),
  };
}

/** 表单行 → 结构化草稿（`raw` 与宿主 `parseProfiles` 的输入**同形**） */
export interface RowDraft {
  readonly index: number;
  readonly raw: Record<string, unknown>;
  readonly problems: readonly string[];
}

export function draftRow(row: EditableRow, index: number): RowDraft {
  const { env, problems } = parseEnvText(row.env);
  const raw: Record<string, unknown> = {
    name: row.name,
    command: row.command,
    args: linesToArgs(row.args),
    env,
  };
  if (row.cwd.trim() !== '') raw['cwd'] = row.cwd;
  if (row.cwdLinux.trim() !== '') raw['cwdLinux'] = row.cwdLinux;
  return { index, raw, problems };
}

/** 结构化行 → 表单行（写回后再读回来的**唯一**比较口径：见 `rowsEqual`） */
export function toComparable(row: EditableRow): RawProfileRow['args'] | string {
  const draft = draftRow(row, 0);
  return JSON.stringify(draft.raw);
}

/** 两行是否有差异（脏检查；用**转换后**的结构比，避免「多个空格」被误判为改动） */
export function rowsEqual(left: EditableRow, right: EditableRow): boolean {
  return toComparable(left) === toComparable(right);
}

/** 不可变改一个字段（受控输入用） */
export function withField(row: EditableRow, field: EditableField, value: string): EditableRow {
  return { ...row, [field]: value };
}

/** 字段的输入框提示（UI 文案集中一处，便于测试逐字断言） */
export const FIELD_PLACEHOLDER: Readonly<Record<EditableField, string>> = {
  name: 'profile 名（唯一）',
  command: '命令，如 wsl.exe',
  args: '一行一个参数',
  cwd: 'Windows 路径，如 E:\\work',
  cwdLinux: 'WSL 路径，如 /mnt/e/work（留空则自动推导）',
  env: '一行一个 KEY=VALUE',
};
