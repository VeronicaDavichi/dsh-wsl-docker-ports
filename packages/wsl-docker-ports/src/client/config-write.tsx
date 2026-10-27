/**
 * 配置页里的**写通道预演**区（017 三订，主人 2026-10-27：「写通道预演也放到配置页里面去」）。
 *
 * ## 为什么单独一个文件
 *
 * `config-page.tsx` 贴着 400 行 SHALL（加这一段就到了 404 行）⇒ 把这一段连同它那句前提
 * 拆出来。拆的边界是**职责**：这一段只负责「把写通道整包接进配置页 + 交代 NAT 前提」，
 * 不碰配置草稿（草稿在 `config-model.ts`，保存逻辑在 `config-page.tsx`）。
 *
 * ## 🔴 NAT 前提为什么不做置灰
 *
 * 右栏页能置灰是因为它手里有 `view.nat`（快照里带来的）。配置页只有 `settings` 管道，
 * 要判 NAT 就得**额外读一次快照**（`docker ps`，冷启实测 2–5 秒）—— 为一行提示让整个配置页
 * 慢这么多不划算。主人同日拍板：**不置灰**，改成「写一句前提 + 让服务端如实回原因」。
 * 这不算静默降级：`/write/plan` 读的是真所有权声明，NAT 不满足时它会带着原因失败，
 * 页面原样显示那条原因（`WriteChannelBlock` 的既有失败路径）。
 *
 * ## 凭据块为什么不在这儿
 *
 * 「写通道凭据」管的是 sessionStorage 里那个 token（生成 / 检查 / 清除），不是预演本身；
 * 主人这轮只点名「预演」。凭据块**留在右栏页**（`WriteTokenBlock`）。
 */

import type { ReactElement } from 'react';

import type { WriteWiring } from './write-channel.ts';
import { WriteChannelBlock } from './write-panel.tsx';

export interface WriteChannelSectionProps {
  /** 写通道整包；`undefined` = 未接线 ⇒ 预演控件置灰 + 写明原因 */
  readonly write: WriteWiring | undefined;
}

export function WriteChannelSection(props: WriteChannelSectionProps): ReactElement {
  const { write } = props;
  return (
    <section className="wdp-cfg-field" data-testid="config-write-channel">
      <div className="wdp-cfg-head">
        <span className="wdp-cfg-label">写通道预演</span>
        <span className="wdp-cfg-tag">只在确认后执行</span>
      </div>
      {/* 两句话合成一段：分成两段时中间会空出一条「没内容的间距」，看起来像漏了一段（主人 2026-10-27 的 ui 反馈） */}
      <p className="wdp-cfg-sublabel">
        <span data-testid="config-write-premise">
          前提：WSL 必须是 NAT 网络模式（mirrored 下规则会指向失效地址）。预演只读计划、零写入；NAT 不满足时会当场报出原因，不静默。
        </span>
        <br />
        <span data-testid="config-write-token-pointer">
          凭据不在这儿：「WSL Docker 端口」右栏页的「写通道凭据」块生成；没有凭据时预演会在本地被拦下（零请求）。
        </span>
      </p>
      <WriteChannelBlock write={write} enabled={write !== undefined} disabledReason={null} variant="field" />
    </section>
  );
}
