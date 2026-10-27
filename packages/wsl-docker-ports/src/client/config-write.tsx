/**
 * 行级配置页里的两块：**写通道预演**与**原始输出**（017 六订·六）。
 *
 * ## 版式（主人 2026-10-27 第三次改口径，最终定死）
 *
 * 「写通道预演 只读事实层 这两个的css保持和其他一致」—— 它们曾经是「分组框 + 卡片」
 * （照 whale-pet 抄的那套），但页面上其余每一项都是同一个 **field** 语法：
 * 标签行（可带右侧小字）→ 控件 → 一句说明。于是这两块也改成 field：
 * `ConfigField`（`.wdp-cfg-field` / `.wdp-cfg-head` / `.wdp-cfg-label` / `.wdp-cfg-tag` / `.wdp-cfg-hint`），
 * 与其他项靠 `.wdp-cfg-field + .wdp-cfg-field` 的分隔线接起来，视觉上连成一张表。
 *
 * ## 🔴 NAT 前提为什么不做置灰
 *
 * 右栏页能置灰是因为它手里有 `view.nat`（快照里带来的）。配置页只有 `settings` 管道，
 * 要判 NAT 就得额外读一次快照（`docker ps`，冷启实测 2–5 秒）—— 为一行提示让整页慢这么多不划算。
 * 主人同日拍板：**不置灰**，改成「写一句前提 + 让服务端如实回原因」。这不算静默降级：
 * `/write/plan` 读的是真所有权声明，NAT 不满足时它会带原因失败，页面原样显示那条原因。
 *
 * ## 原始输出为什么按需读
 *
 * 读侧原文就是 `docker ps` 那一次读的结果；配置页加载期**零读**（同上那条冷启代价），
 * 点「查看原始输出」才经 `loadRawOutput`（主包壳注入）读一次，展开/收起不再重复读。
 */

import { useEffect, useState, type ReactElement } from 'react';

import { installConfigStyles } from './config-css.ts';
import { ConfigField } from './config-fields.tsx';

import type { WriteWiring } from './write-channel.ts';
import { WriteChannelBlock } from './write-panel.tsx';

export interface WriteChannelSectionProps {
  /** 写通道整包；`undefined` = 未接线 ⇒ 预演控件置灰 + 写明原因 */
  readonly write: WriteWiring | undefined;
}

export interface RawOutputSectionProps {
  /** 原始输出读取器：**只在用户点开时**调用一次；`undefined` = 未接线 ⇒ 按钮置灰并写明原因 */
  readonly loadRawOutput?: (() => Promise<string | null>) | undefined;
}

/** 原始输出（REQ-3.5）：**只**展示脱敏后的读侧原文，不提供任何解析/执行入口 */
export function RawOutputSection(props: RawOutputSectionProps): ReactElement {
  const { loadRawOutput: load } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // 版面与配置页同一套（`CONFIG_CSS` 只在挂载时注入；这一块单独渲染时也要注入）
  useEffect(() => installConfigStyles(), []);

  const toggle = async (): Promise<void> => {
    if (open) {
      setOpen(false);
      return;
    }
    if (load === undefined) return;
    setOpen(true);
    if (text !== null) return; // 原文已在手里：反复展开不重复读
    setBusy(true);
    try {
      const next = await load();
      setText(next);
      setNote(next === null ? '这次读没有可展示的原文。' : '');
    } catch (error) {
      setText('');
      setNote(`读取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wdp-cfg-raw" data-testid="config-raw-page">
      <ConfigField
        label="原始输出"
        tag="只在点开时读"
        hint="docker ps 这一次读的原文（已脱敏）。点开才读一次，加载期零读，展开/收起不重复读。"
      >
        {/* 主人 2026-10-27：「查看原始输出/收起原始输出 理应是两个按钮，点击查看原始输出的时候
            下拉一个窗口展开里面是内容，点收起的时候收回」⇒ 两个**独立**的按钮，各管一件事：
            `config-raw-output` 只负责展开（读一次），`config-raw-output-collapse` 只负责收回。 */}
        <div className="wdp-cfg-field-body" data-testid="config-raw-output-card" data-open={open ? '1' : '0'}>
          {open ? (
            <button
              type="button"
              className="wdp-textbtn"
              data-testid="config-raw-output-collapse"
              title="收回这个窗口（已读到的原文留在内存里，再展开不重复读）"
              onClick={() => {
                setOpen(false);
              }}
            >
              收起原始输出
            </button>
          ) : (
            <button
              type="button"
              className="wdp-textbtn"
              data-testid="config-raw-output"
              disabled={busy || load === undefined}
              title={load === undefined ? '原始输出未接线：主包壳没注入读取器' : '按需读一次 docker ps，看它在这次读里的原文'}
              onClick={() => {
                void toggle();
              }}
            >
              {busy ? '读取中…' : '查看原始输出'}
            </button>
          )}
          {open && text !== null ? (
            // 「下拉一个窗口」：展开区是一块有边框底色的面板，原文在面板里（横向可滚，不撑破页面）
            <div className="wdp-cfg-raw-panel" data-testid="config-raw-output-panel">
              <pre className="wdp-pre" data-testid="config-raw-output-body">
                {text}
              </pre>
            </div>
          ) : null}
          {note === '' ? null : <p className="wdp-cfg-hint">{note}</p>}
        </div>
      </ConfigField>
    </div>
  );
}

/** 写通道预演：前提 + 凭据指向 + 预演控件（同一个 field，与页面上其他项同构） */
export function WriteChannelSection(props: WriteChannelSectionProps): ReactElement {
  const { write } = props;
  const premise = (
    <>
      <span data-testid="config-write-premise">
        前提：WSL 必须是 NAT 网络模式（mirrored 下规则会指向失效地址）。预演只读计划、零写入；NAT 不满足时会当场报出原因，不静默。
        <br />
      </span>
      <span data-testid="config-write-token-pointer">
        凭据不在这儿：「WSL Docker 端口」右栏页的「写通道凭据」块生成；没有凭据时预演会在本地被拦下（零请求）。
      </span>
    </>
  );
  return (
    <div data-testid="config-write-channel">
      <ConfigField label="写通道预演" tag="只在确认后执行" hint={premise}>
        <div data-testid="config-write-preview">
          <WriteChannelBlock write={write} enabled={write !== undefined} disabledReason={null} variant="field" />
        </div>
      </ConfigField>
    </div>
  );
}
