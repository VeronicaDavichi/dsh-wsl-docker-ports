/**
 * 把宿主 `dsh-settings` 的**真函数**离线取出来跑（009 缺陷 1 的 Task C）
 *
 * ## 为什么是「切片真源码」而不是「重写一份判定」
 *
 * 「命名空间会不会出现」的判据住在宿主里（`describe()` → `volatileForm(schema) !== undefined`）。
 * 自己按理解重写一遍 `volatileForm` 会引入「我以为是这个语义」的风险，而且无法向别人证明两份判定
 * 等价。⇒ 本文件**只做一件事**：把宿主产物里那几个函数的**原文**切出来、在本地作用域里求值，
 * 唯一注入的外部依赖是宿主自己的 `z`（schemastery）与 `isVolatile`（cosmokit）。
 *
 * 🔴 切片按 **`function <name>(` 的顶层边界**做（不是硬编码行号）：宿主升级后行号会漂，
 * 而产物是 esbuild/rolldown 风格的**顶层函数声明**（列 0 起）⇒ 按声明边界切是稳定的。
 * 切出来的每个函数都回报它的**宿主行号区间**（`lineRange`），这就是「逐行对照表」——
 * 表里每一行都来自宿主文件，不是我写的。
 *
 * ## 拿不到宿主产物时
 *
 * 返回 `null` + 每个锚点的失败原因（**不抛、更不造假**）。调用方（`config-gate.test.ts`）
 * 因此只能 `skip` 并打印原因 —— 「宿主不在盘上」与「判定不通过」是两件不同的事，不许混。
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** 宿主 `dsh-settings` 产物在本机的相对路径（`@deepseek-ai/dsh` 自带的嵌套依赖树） */
export const HOST_SETTINGS_RELATIVE = 'node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js';

/** 只取本判定链上用到的那些宿主函数（依赖顺序见 `extractHostFunctions`） */
export const HOST_FUNCTIONS = [
  'isRecord',
  'walk',
  'redactSecrets',
  'plainConfig',
  'plainSchema',
  'volatileForm',
  'isExpression',
  'projectForm',
  // ── 009 收口轮 T3 追加：`mutate` 路径的三个真函数 ──────────────────────────────
  // 「清除凭据」走宿主 `mutate` ⇒ 该路径的核心是 `applyPathOp`（按路径 unset，**真的**把键删掉）。
  // 🔴 追加而不是重写：这三段同样是宿主**原文切片**（行号随 `slices` 一起报出），
  // 因此「空串仍算已配置 / unset 才算删掉」这个结论来自宿主，不来自我的理解。
  'isPlainObject',
  'applyPathOp',
  'member',
] as const;

export interface HostGateAttempt {
  readonly anchor: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface HostFunctionSlice {
  readonly name: string;
  /** 在宿主文件里的行号区间（1-based，闭区间）—— 「逐行对照表」的素材 */
  readonly from: number;
  readonly to: number;
  readonly bytes: number;
}

export interface HostSecret {
  readonly path: readonly string[];
  readonly set: boolean;
}

export interface HostGate {
  /** 实际用的宿主产物绝对路径 */
  readonly file: string;
  /** 切出来的函数 + 各自的宿主行号区间 */
  readonly slices: readonly HostFunctionSlice[];
  /** 宿主自己的 schemastery 工厂（从**同一个产物** `createRequire` 解析 ⇒ 与宿主同版本） */
  readonly z: {
    object(shape: Record<string, unknown>): unknown;
    string(): unknown;
    array(item: unknown): unknown;
    any(): unknown;
    dict?(item: unknown): unknown;
  };
  /**
   * 宿主自己的 cosmokit 活体协议（**顺带从同一个产物解析**）：`createVolatile` 造真引用、
   * `updateVolatile` 就是宿主 `_commitVolatile()` 用的那个原地更新 ⇒ 测试能造出**真** ref，
   * 而不是自己仿一个 `{ get }`（仿的那个过不了 `isVolatile`，`plainConfig` 不认）。
   */
  readonly refs: {
    readonly createVolatile: (value: unknown) => { readonly get: () => unknown };
    readonly isVolatile: (value: unknown) => boolean;
    readonly updateVolatile: (target: unknown, source: unknown) => void;
  };
  /** 宿主自己的 `volatileForm`（**原文**） */
  readonly volatileForm: (schema: unknown) => { readonly type?: string; readonly dict?: Record<string, unknown> } | undefined;
  readonly plainSchema: (schema: unknown) => unknown;
  readonly plainConfig: (value: unknown) => unknown;
  readonly projectForm: (schema: unknown, value: unknown) => unknown;
  readonly redactSecrets: (schema: unknown, value: unknown) => { readonly value: unknown; readonly secrets: readonly HostSecret[] };
  /**
   * 宿主 `applyPathOp(section, op, schema)` 的**原文**（`lib/index.js:189`）——
   * `mutate` 按路径编辑配置的那一步。🔴 判据来源：`unset` 是 `Reflect.deleteProperty`（键**消失**），
   * 而「写空串」只是把值换成 `''`（键还在，`walk()` 的 `set: value !== void 0` 照样给 `true`）。
   */
  readonly applyPathOp: (section: unknown, op: { readonly op: 'set' | 'unset'; readonly path: readonly string[]; readonly value?: unknown }, schema?: unknown) => Record<string, unknown>;
  /** 宿主 `isPlainObject`（原文；`applyPathOp` 的依赖） */
  readonly isPlainObject: (value: unknown) => boolean;
  /** 宿主 `member(node, key, own?)`（原文；`applyPathOp`/`mutate` 的依赖） */
  readonly member: (node: unknown, key: string, own?: boolean) => unknown;
}

/** 按顶层 `function <name>(` 边界切一段（列 0 的声明 ⇒ 下一个 `\nfunction ` 就是终点） */
function sliceFunction(text: string, name: string): { code: string; from: number; to: number } | null {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const next = text.indexOf('\nfunction ', start + 1);
  const end = next < 0 ? text.length : next;
  const code = text.slice(start, end).trimEnd();
  const lineOf = (index: number): number => text.slice(0, index).split('\n').length;
  return { code, from: lineOf(start), to: lineOf(start + code.length) };
}

/** 候选锚点（按「宿主可能长在哪里」排序；每个都只是 `createRequire`/路径探测的基准，不写任何东西） */
export function hostSettingsCandidates(): readonly string[] {
  const out: string[] = [];
  const add = (candidate: unknown): void => {
    if (typeof candidate !== 'string' || candidate.trim() === '') return;
    if (!out.includes(candidate)) out.push(candidate);
  };
  add(process.env['DSH_SETTINGS_LIB']);
  const execDir = dirname(process.execPath);
  add(join(execDir, HOST_SETTINGS_RELATIVE));
  add(join(execDir, 'node_modules/@deepseek-ai/dsh-settings/lib/index.js'));
  const resources = (process as { resourcesPath?: unknown }).resourcesPath;
  if (typeof resources === 'string') {
    for (const variant of ['app.asar', 'app', 'app.asar.unpacked']) add(join(resources, variant, HOST_SETTINGS_RELATIVE));
  }
  add(join(process.cwd(), HOST_SETTINGS_RELATIVE));
  // 有的安装形态把 dsh-settings 直接放在可解析的依赖树里（宿主 0.2.0-rc.2 是嵌套的，故这条只是兜底）
  for (const anchor of [process.execPath, process.argv[1], join(process.cwd(), 'index.js')]) {
    if (typeof anchor !== 'string' || anchor.trim() === '') continue;
    try {
      add(createRequire(anchor).resolve('@deepseek-ai/dsh-settings/lib/index.js'));
    } catch {
      // 解析不到就换下一个锚点（失败原因由外面统一报「没有可用的宿主产物」）
    }
  }
  return out;
}

/**
 * 取宿主的判定函数。**找不到就返回 `null`**（附每个候选的失败原因），绝不造一份替代判定。
 */
export function loadHostGate(candidates: readonly string[] = hostSettingsCandidates()): { readonly gate: HostGate | null; readonly attempts: readonly HostGateAttempt[] } {
  const attempts: HostGateAttempt[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) {
      attempts.push({ anchor: file, ok: false, detail: '不存在' });
      continue;
    }
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      attempts.push({ anchor: file, ok: false, detail: `读失败：${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const pieces: string[] = [];
    const slices: HostFunctionSlice[] = [];
    let missing: string | null = null;
    // 🔴 依赖顺序不能变：walk 用 isRecord；plainSchema 用 redactSecrets；volatileForm 用 plainSchema。
    for (const name of HOST_FUNCTIONS) {
      const piece = sliceFunction(text, name);
      if (piece === null) {
        missing = name;
        break;
      }
      pieces.push(piece.code);
      slices.push({ name, from: piece.from, to: piece.to, bytes: Buffer.byteLength(piece.code) });
    }
    if (missing !== null) {
      attempts.push({ anchor: file, ok: false, detail: `切不到宿主函数 ${missing}（产物版本可能变了 ⇒ 不猜）` });
      continue;
    }
    try {
      const require = createRequire(file);
      const z = require('@deepseek-ai/schemastery');
      const cosmokit = require('@deepseek-ai/cosmokit') as {
        readonly isVolatile?: unknown;
        readonly createVolatile?: unknown;
        readonly updateVolatile?: unknown;
      };
      const { isVolatile, createVolatile, updateVolatile } = cosmokit;
      if (typeof isVolatile !== 'function') throw new Error('cosmokit 没导出 isVolatile');
      if (typeof createVolatile !== 'function') throw new Error('cosmokit 没导出 createVolatile');
      if (typeof updateVolatile !== 'function') throw new Error('cosmokit 没导出 updateVolatile');
      const source = `${pieces.join('\n')}\nreturn { volatileForm, plainSchema, plainConfig, projectForm, redactSecrets, applyPathOp, isPlainObject, member };`;
      // eslint-disable-next-line no-new-func
      const factory = new Function('z', 'isVolatile', source) as (z: unknown, isVolatile: unknown) => Omit<HostGate, 'file' | 'slices' | 'z'>;
      const evaluated = factory(z, isVolatile);
      for (const name of ['volatileForm', 'plainSchema', 'plainConfig', 'projectForm', 'redactSecrets', 'applyPathOp', 'isPlainObject', 'member'] as const) {
        if (typeof evaluated[name] !== 'function') throw new Error(`切出来的源码里 ${name} 不是函数`);
      }
      if (typeof (z as { object?: unknown }).object !== 'function') throw new Error('宿主产物里解析到的 schemastery 不是工厂（缺 object）');
      attempts.push({ anchor: file, ok: true, detail: `宿主真函数 ${String(slices.length)} 个（${slices.map((slice) => `${slice.name}:${String(slice.from)}-${String(slice.to)}`).join(' ')}）` });
      const refs = {
        createVolatile: createVolatile as HostGate['refs']['createVolatile'],
        isVolatile: isVolatile as HostGate['refs']['isVolatile'],
        updateVolatile: updateVolatile as HostGate['refs']['updateVolatile'],
      };
      return { gate: { ...evaluated, z: z as HostGate['z'], refs, file, slices }, attempts };
    } catch (error) {
      attempts.push({ anchor: file, ok: false, detail: `求值失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { gate: null, attempts };
}
