/**
 * 6 个工具的**输出 schema**（004 design §2 的「返回」列；A-1 的 `output:{schema,render}` 必填）
 *
 * 为什么单独一个文件：`register.ts` 里 6 个 `defineTool` 已经很长，schema 是本 Spec 的**对模型
 * 的公开契约**（模型靠它决定怎么解析结果），值得能被单独读到、单独 diff。
 *
 * ⚠️ 两条刻意写法：
 * ① **成功形状才进 schema** —— 失败一律抛出（见 `./failure.ts` 的文件头），宿主归一化成
 *    `isError:true` 的可读结果，**不**出现在 `value` 里；所以这里没有 `ok` 判别字段。
 * ② `managed_terminal_read` 的两模式用 `oneOf` 且靠 `mode` 的 `enum` 单值判别：模型不必猜自己拿到的是哪一种
 *    （与 002 的 `TerminalRead` 判别联合一一对应）。
 *
 * ⚠️ 唯一进 schema 的「非成功」是 `cancelled`（REQ-3.5：**不是** error 语义，见 design §5 表格）。
 *
 * 🔴 **必填的写法（2026-10-09 集成方读真源码校订，不是风格选择）**
 * `defineTool` 把 `output.schema` 交给 `valueSchemaSpecToJsonSchema`（真包
 * `@deepseek-ai/dsh-tools@0.2.0-rc.2` 的 `lib/types/schema.js` L228-232），它走的是**值 schema DSL**
 * 的 `assertAuthorKeys` 白名单（同文件 L126-192）：
 * · 必填 = **属性节点上写 `required: true`**（L78-82：只能是字面 `true`）；
 * · **顶层 `required: [...]` 数组不被承认** ⇒ 抛 `…schema.required is not supported by the value schema DSL`
 *   —— 这正是本文件原先（照 JSON Schema 习惯写）导致 **6 个工具全部注册失败**的原因；
 * · `object` 节点的 `additionalProperties` **必须显式给 boolean**；
 * · `oneOf` 的分支节点**不得**再带 `required`（L144 的 `allowRequired: false`）——但分支内部
 *   `properties` 的子节点**可以**（L83-89 每个属性节点都拿到 `allowRequired: true`）。
 * 端到端证据（真 `defineTool` 注册 6 个工具全过）：`tests/unit/tools-real-define.test.ts`。
 */

import type { ValueNode } from './host.ts';

/** `managed_terminal_new` → `{ id, pid? }`（REQ-1.2） */
export const NEW_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '新实例 id（`term-N`，每次都是新的，REQ-3.4）' },
    profile: { type: 'string', required: true, description: '来源 profile 名' },
    pid: { type: 'integer', description: '宿主 pid（拿不到时缺省）' },
    rows: { type: 'integer', required: true },
    cols: { type: 'integer', required: true },
  },
};

/** `managed_terminal_list` → 实例数组（REQ-1.3 的 id/profile/pid/尺寸/存活 + REQ-2.4 的 `dropped`） */
export const LIST_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    instances: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          profile: { type: 'string', required: true, description: '来源 profile 名' },
          pid: { type: 'integer' },
          rows: { type: 'integer', required: true },
          cols: { type: 'integer', required: true },
          alive: { type: 'boolean', required: true, description: '顶层进程未退出（= !002 的 exited）' },
          seq: {
            type: 'integer',
            required: true,
            description: '下一号：原样存下来当下次 sinceSeq 永远安全（REQ-2.1）',
          },
          dropped: {
            type: 'integer',
            required: true,
            description: '有界缓冲丢弃的块数（REQ-2.4，**不隐藏**）',
          },
        },
      },
    },
    count: { type: 'integer', required: true },
  },
};

/** `managed_terminal_read` 的快照分支（002 `ScreenSnapshot` 的直射，REQ-2.1） */
const SNAPSHOT_NODE: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true, description: '可回放的转义序列（含颜色/光标），不是纯文本' },
    rows: { type: 'integer', required: true },
    cols: { type: 'integer', required: true },
    seq: { type: 'integer', required: true, description: '产出该快照时的下一号' },
    dropped: { type: 'integer', required: true },
  },
};

/** `managed_terminal_read` → 快照 | 增量块 | 丢失+快照（REQ-1.4 / REQ-2.2） */
export const READ_OUTPUT: ValueNode = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', required: true, enum: ['snapshot'] },
        snapshot: { ...SNAPSHOT_NODE, required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', required: true, enum: ['incremental'] },
        lost: {
          type: 'boolean',
          required: true,
          enum: [false],
          description: '增量仍在（`chunks` 可为空 = 没有新输出）',
        },
        chunks: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              seq: { type: 'integer', required: true },
              data: { type: 'string', required: true, description: '该块的输出文本（002 的 `TermChunk.data`）' },
              bytes: { type: 'integer', description: 'UTF-8 字节数（002 的缓冲计量口径）' },
            },
          },
        },
        seq: { type: 'integer', required: true },
        dropped: { type: 'integer', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', required: true, enum: ['incremental'] },
        lost: { type: 'boolean', required: true, enum: [true], description: 'sinceSeq 早于缓冲下界（REQ-2.2）' },
        snapshot: { ...SNAPSHOT_NODE, required: true },
        requestedSeq: { type: 'integer', required: true },
        oldestSeq: { type: 'integer', required: true },
        seq: { type: 'integer', required: true },
        dropped: { type: 'integer', required: true },
      },
    },
  ],
};

/** `managed_terminal_write` → `{ written, key }`（REQ-1.5；`key` 让「按了什么键」可追溯） */
export const WRITE_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    written: {
      type: 'integer',
      required: true,
      description: '写进 PTY 的字符数（UTF-16 码元数，与 002 的 `written` 同口径）',
    },
    key: {
      type: 'string',
      required: true,
      description: '命中键名表时是归一化后的键名；按字面发时为 `text`',
    },
  },
};

/** `managed_terminal_resize` → **实际生效**值（REQ-1.6；夹紧在 002，这里只回报） */
export const RESIZE_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rows: { type: 'integer', required: true, description: '实际生效行数（夹紧后）' },
    cols: { type: 'integer', required: true, description: '实际生效列数（夹紧后）' },
    requestedRows: { type: 'integer', description: '入参原值（越界时能看出被夹紧）' },
    requestedCols: { type: 'integer' },
  },
};

/** `managed_terminal_kill` → `{ killed, id, warning? }`（REQ-1.7；`warning` = 进程树终止的尽力而为告警） */
export const KILL_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    killed: { type: 'boolean', required: true, enum: [true] },
    id: { type: 'string', description: '被终止的实例 id' },
    warning: { type: 'string', description: '尽力而为的告警（Windows ConPTY 不在 Job containment 内）' },
  },
};

/** 审批取消的**正常值**（REQ-3.5：不是 error；唯一不抛的失败形状） */
export const CANCELLED_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true, enum: [false] },
    code: { type: 'string', required: true, enum: ['cancelled'] },
    message: { type: 'string', required: true },
    hint: { type: 'string' },
  },
};

/**
 * 写工具的**联合**输出：成功形状 | 审批取消形状。
 *
 * 为什么取消要做成联合而不是「也抛」：见 `./failure.ts` 的文件头 —— 抛 = 宿主标记 `isError:true`，
 * 而 REQ-3.5 明写拒绝/取消**不得**被标记为系统错误。
 */
export function withCancelled(success: ValueNode): ValueNode {
  return { oneOf: [success, CANCELLED_OUTPUT] };
}
