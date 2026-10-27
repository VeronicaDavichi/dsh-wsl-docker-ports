/**
 * 配置页里的**写通道**分组（017 三订「预演搬来配置页」→ 017 六订「照 whale-pet 的组件配置页排版」）。
 *
 * ## 版式（主人 2026-10-27 两次给图定死）
 *
 * 参考 [@luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet) 的组件配置页：
 * 点插件标题进去，看到的是一块**分组**（外框 + 分组标题），分组里横排若干**子组件卡片**，
 * 每张卡片自带标题 + 一句说明 + 控件。主人原话：「我让你学习这个把原始输出放这里」
 * 「在子组件的下面，而不是在子组件的外面」⇒ 「原始输出」是「写通道预演」**下面那张兄弟卡片**，
 * 同一个分组里，不是分组外的新段落、也不是预演卡片内部的一行。
 *
 * ## 为什么单独一个文件
 *
 * `config-page.tsx` 贴着 400 行 SHALL ⇒ 这一段连同它的前提句拆出来。拆的边界是**职责**：
 * 这段只负责「写通道分组 + 原始输出卡片」，不碰配置草稿（`config-model.ts` / `config-page.tsx`）。
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

import { useState, type ReactElement } from 'react';

import type { WriteWiring } from './write-channel.ts';
import { WriteChannelBlock } from './write-panel.tsx';

export interface WriteChannelSectionProps {
  /** 写通道整包；`undefined` = 未接线 ⇒ 预演控件置灰 + 写明原因 */
  readonly write: WriteWiring | undefined;
  /**
   * 原始输出读取器：**只在用户点开时**调用一次，返回 docker 那一段的原文；
   * `undefined` = 未接线 ⇒ 按钮置灰并写明原因。返回 `null` = 读到了但没有可展示的原文。
   */
  readonly loadRawOutput?: (() => Promise<string | null>) | undefined;
}

/** 原始输出卡片（REQ-3.5）：**只**展示脱敏后的读侧原文，不提供任何解析/执行入口 */
function RawOutputCard(props: { readonly load: (() => Promise<string | null>) | undefined }): ReactElement {
  const { load } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState('');

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
    <article className="wdp-cfg-card" data-testid="config-raw-output-card" data-open={open ? '1' : '0'}>
      <div className="wdp-cfg-head">
        <span className="wdp-cfg-card-title">原始输出</span>
        <span className="wdp-cfg-tag">只在点开时读</span>
      </div>
      <p className="wdp-cfg-card-hint">
        docker ps 这一次读的原文（已脱敏）。点开才读一次，配置页加载期零读，展开/收起不重复读。
      </p>
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
        {open ? '收起原始输出' : '查看原始输出'}
      </button>
      {open && text !== null ? (
        <pre className="wdp-pre" data-testid="config-raw-output-body">
          {text}
        </pre>
      ) : null}
      {note === '' ? null : <p className="wdp-cfg-hint">{note}</p>}
    </article>
  );
}

export function WriteChannelSection(props: WriteChannelSectionProps): ReactElement {
  const { write, loadRawOutput } = props;
  return (
    <section className="wdp-cfg-group" data-testid="config-write-channel">
      <h4 className="wdp-cfg-group-title">写通道</h4>
      <div className="wdp-cfg-cards">
        {/* 卡片一：预演本体。两句话合成一段（分两段会空出一条像漏了一段的间距，主人 2026-10-27） */}
        <article className="wdp-cfg-card" data-testid="config-write-preview">
          <div className="wdp-cfg-head">
            <span className="wdp-cfg-card-title">写通道预演</span>
            <span className="wdp-cfg-tag">只在确认后执行</span>
          </div>
          <p className="wdp-cfg-card-hint">
            <span data-testid="config-write-premise">
              前提：WSL 必须是 NAT 网络模式（mirrored 下规则会指向失效地址）。预演只读计划、零写入；NAT 不满足时会当场报出原因，不静默。
            </span>
            <br />
            <span data-testid="config-write-token-pointer">
              凭据不在这儿：「WSL Docker 端口」右栏页的「写通道凭据」块生成；没有凭据时预演会在本地被拦下（零请求）。
            </span>
          </p>
          <WriteChannelBlock write={write} enabled={write !== undefined} disabledReason={null} variant="field" />
        </article>
        {/* 卡片二：原始输出（子组件**下面**的兄弟卡片，主人 2026-10-27 的图二） */}
        <RawOutputCard load={loadRawOutput} />
      </div>
    </section>
  );
}
