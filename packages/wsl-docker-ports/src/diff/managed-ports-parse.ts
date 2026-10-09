/**
 * `managedPorts` 声明的**文本 → 区间**解析与拒绝（003 T3.5 / REQ-16.1 / REQ-16.2）
 *
 * ## 为什么单独一个文件（而不是塞进 `managed-ports.ts`）
 *
 * `managed-ports.ts` 是**表示 + 成员判定 + 求交**（引擎每跑一次都要用），本文件是**配置录入侧**的
 * 解析与校验（只在读配置时用一次）。两者改动理由不同、消费方不同，拆开让「引擎的输入形状」
 * 与「用户怎么把它写出来」各自可独立复核。
 *
 * ## 两条硬约束
 *
 * 1. **绝不展开区间**（REQ-16.2）：`'1-65535'` 解析出来就是**一个**区间对象。
 *    若在这里展开成 6.5 万个元素，期望集的「先求交」就没意义了，配置一次能卡住整个插件。
 * 2. **全有或全无**：任一项非法 ⇒ 整体拒绝，失败结果里**连 `ports` 字段都没有**。
 *    半套声明被写进配置并静默生效，比当场报错危险得多（用户以为 `1000-3000` 生效了，
 *    实际只有前半段进了配置）。
 *
 * ## 错误模型（为什么是「全部 issue 一次报完」而不是首错即停）
 *
 * 配置页会让用户一次填多行。首错即停意味着「改一处、再试、又一处」的循环；
 * 全部报完 + 每条带**下标 + 原始项 + 可读原因**，用户改一次就能过。
 * `reason` 是给程序判的（测试 / UI 分类），`message` 是给人看的（可直接显示）。
 */

import { singlePort, type ManagedPortRange, type ManagedPorts } from './managed-ports.ts';

/** 声明项的**输入形态**：配置里可以写字符串（`'1000-3000'`），也可以写数字（YAML 里 `3306`） */
export type ManagedPortsDecl = string | number;

/** 合法端口范围（端口空间本身：1–65535；`0` 与 `65536` 都越界） */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/** 拒绝原因（机器可判）；每一种都对应 `REASON_TEXT` 里一句给用户看的话 */
export type ManagedPortsParseReason =
  | 'empty'
  | 'not-a-number'
  | 'not-an-integer'
  | 'range-missing-start'
  | 'range-missing-end'
  | 'range-too-many-parts'
  | 'out-of-range'
  | 'range-inverted';

/** 一处非法项 —— REQ-16.1 要求「给出原因（**含所在项**）」，故 `index` 与 `item` 都是结构化字段 */
export interface ManagedPortsParseIssue {
  /** 该项在声明数组里的下标（0 起） */
  readonly index: number;
  /** 出问题的**具体项**（trim 后的原文；空串项就是空串） */
  readonly item: string;
  readonly reason: ManagedPortsParseReason;
  /** 可读原因：已把「第 N 项 + 该项原文 + 为什么」拼成一句话，UI 直接显示 */
  readonly message: string;
}

export interface ManagedPortsParseSuccess {
  readonly ok: true;
  readonly ports: ManagedPorts;
}

export interface ManagedPortsParseFailure {
  readonly ok: false;
  /** **全部**非法项（不是首错即停），顺序 = 声明顺序 */
  readonly issues: readonly ManagedPortsParseIssue[];
}

export type ManagedPortsParseResult = ManagedPortsParseSuccess | ManagedPortsParseFailure;

const REASON_TEXT: Readonly<Record<ManagedPortsParseReason, string>> = {
  empty: '空项（声明项不能为空）',
  'not-a-number': '不是数字',
  'not-an-integer': '不是整数（端口必须是十进制整数，如 3306）',
  'range-missing-start': '区间缺少起点（形如 "1-"）',
  'range-missing-end': '区间缺少终点（形如 "-5"）',
  'range-too-many-parts': '区间里多于一个 "-"（只支持单端口或 "起点-终点" 闭区间）',
  'out-of-range': `端口越界（合法范围 ${String(MIN_PORT)}-${String(MAX_PORT)}）`,
  'range-inverted': '区间倒置（起点大于终点）',
};

function issue(index: number, item: string, reason: ManagedPortsParseReason): ManagedPortsParseIssue {
  // 空串要显式写成「(空串)」：否则 `第 2 项 ：空项` 看起来像排版坏了，用户会以为是插件的 bug
  const shown = item === '' ? '(空串)' : `"${item}"`;
  return { index, item, reason, message: `第 ${String(index + 1)} 项 ${shown}：${REASON_TEXT[reason]}` };
}

type PortToken =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: ManagedPortsParseReason };

/**
 * 单个端点 token → 端口号。
 *
 * 只认**纯十进制数字**：`+5` / `1e3` / `1.5` 一律拒。声明是要给人对照核对的，
 * 指数与正号写法会让「配置里写的」和「界面显示的」看起来不是同一个数。
 */
function toPort(token: string): PortToken {
  const text = token.trim();
  if (!/^\d+$/.test(text)) {
    // 「差一点」（`1.5` / `1e3` 是有限数）与「写错了」（`abc`）分开报，提示才可用
    return { ok: false, reason: Number.isFinite(Number(text)) ? 'not-an-integer' : 'not-a-number' };
  }
  const value = Number(text);
  if (value < MIN_PORT || value > MAX_PORT) return { ok: false, reason: 'out-of-range' };
  return { ok: true, value };
}

function parseDecl(raw: ManagedPortsDecl, index: number): ManagedPortRange | ManagedPortsParseIssue {
  // 数字也先归一成文本再解析 ⇒ **单一路径**：`-5` 与 `'-5'` 必然同一结论（缺起点的区间），
  // 不会出现「按类型走两套判据」的分叉。两者的结局都是**被拒**，安全性不受影响。
  const text = (typeof raw === 'number' ? String(raw) : raw).trim();
  if (text === '') return issue(index, '', 'empty');

  const parts = text.split('-');
  if (parts.length === 1) {
    const port = toPort(parts[0] ?? '');
    return port.ok ? singlePort(port.value) : issue(index, text, port.reason);
  }
  if (parts.length !== 2) return issue(index, text, 'range-too-many-parts');

  // `'1-'` / `'-5'` 的「只有一端」在这里落地（先判空再看数字，否则空串会被报成「不是整数」）
  const [startText, endText] = parts;
  if ((startText ?? '').trim() === '') return issue(index, text, 'range-missing-start');
  if ((endText ?? '').trim() === '') return issue(index, text, 'range-missing-end');

  const start = toPort(startText ?? '');
  if (!start.ok) return issue(index, text, start.reason);
  const end = toPort(endText ?? '');
  if (!end.ok) return issue(index, text, end.reason);
  if (start.value > end.value) return issue(index, text, 'range-inverted');
  // 两端相等 ⇒ 按单端口（`'80-80'` 与 `'80'` 同义：表示层本来就用 `start === end` 表示单端口）
  return start.value === end.value ? singlePort(start.value) : { start: start.value, end: end.value };
}

/**
 * 声明数组 → `ManagedPorts`（单端口与闭区间可混写，REQ-16.1）。
 *
 * 空白两端 trim（`' 1000 - 3000 '` 合法）；区间**不展开**（REQ-16.2）；
 * 任一非法 ⇒ `ok: false` 且只有 `issues`（见文件头「全有或全无」）。
 */
export function parseManagedPorts(decls: readonly ManagedPortsDecl[]): ManagedPortsParseResult {
  const ports: ManagedPortRange[] = [];
  const issues: ManagedPortsParseIssue[] = [];
  decls.forEach((raw, index) => {
    const parsed = parseDecl(raw, index);
    if ('reason' in parsed) issues.push(parsed);
    else ports.push(parsed);
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, ports };
}
