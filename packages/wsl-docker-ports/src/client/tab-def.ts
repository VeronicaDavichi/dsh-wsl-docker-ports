/**
 * **页定义与座位注册**（015 `P4`）—— 主包常驻面里唯一必须「在 apply 期同步可用」的一小块。
 *
 * ## 为什么从 `rows.ts` 里拆出来
 *
 * `rows.ts` 是**视图装配**（行/指引/五态标签），只有 chunk 侧渲染时才用得到；页定义与两个 seat 的
 * 注册参数却必须在 `apply()` 里就有。拆之前主包为了 6 个常量把 17 KB 的模块拉进 import 图，
 * 015 又要再加**第二套**页定义（容器页）⇒ 拆成这个小文件，主包只装它。
 *
 * `rows.ts` 保留 `export … from './tab-def.ts'` 的转发（**测试与 chunk 的 import 路径一字不变**）。
 *
 * ## 两个页（015 owner 决策 ②③）
 *
 * | | 转发侧 | 容器侧 |
 * | --- | --- | --- |
 * | `kind` | `wslDockerPorts` | `wslDockerContainers` |
 * | id / 配置命名空间 | `dsh-wsl-docker-ports` | `dsh-wsl-docker-containers` |
 * | guide 位次 | 40 | 50 |
 *
 * ⚠️ `kind` 是**开放字符串**（0.1.7-rc.2 实测官方 9 个：guide/files/browser/text/changes-review/
 * terminal/scheduleTask/plan/subagentchat）⇒ 判据 = 「不与官方已用 kind 重名」，两个都 ✅。
 * `priority` 一律**不写**（= extension 档；官方 `terminal` 用 `builtin`，第三方不许蹭）。
 */

import type { SidebarRightTabDefinitionLike, SlotsServiceLike } from './host.ts';

/** 转发侧页类型 id / kind / 标题 */
export const PAGE_ID = 'wsl-ports';
export const PAGE_KIND = 'wslDockerPorts';
export const PAGE_TITLE = 'WSL Docker 端口';

/** 两个 keyed seat（contract §C10）：`key = definition.id` */
export const TAB_SLOT = 'sidebar.right.pane.tab';
export const TAB_TITLE_SLOT = 'sidebar.right.pane.tab.title';

/**
 * **guide 空态入口**（真机复验缺陷：页存在但用户在右栏空态里点不到）。
 *
 * 官方形状逐字取自离线实物 `0.1.7-rc.2`
 * `deepseek-ai-dsh-client-ui-sidebar-files-0.1.7-rc.2.tgz` → `package/lib/client.js:22-38`：
 *
 *     function filesDefinition(t) {
 *       return { id: FILES_ID, kind: FILES_KIND, priority: "builtin", title: () => t("type.label"),
 *         guide: [{ id: "workspace", commandId: "workspace.files", order: 10,
 *                   title: () => t("guide.title"), description: () => t("guide.description"),
 *                   icon: _deepseek_ai_dsh_client_ui_primitives.GuideArtworkFiles }] };
 *     }
 *
 * 官方 guide 位次**全集**（0.1.7-rc.2，逐包扫过）：`files`=10 / `terminal`=20 / `browser`=30；
 * 其余自**不带** guide 入口。故本包两个页取 **40 / 50** —— 排在官方全部入口之后
 * （`refresh()` 按 `order` 升序排）。`icon` **不写**（无 icon 时 guide 画自己的立方体占位符），
 * 于是也不必新增 `@deepseek-ai/dsh-client-ui-primitives` 运行时 import。
 */
export const GUIDE_ENTRY_ID = 'ports';
export const GUIDE_ENTRY_ORDER = 40;
export const GUIDE_ENTRY_TITLE = '端口转发';
export const GUIDE_ENTRY_DESCRIPTION = '查看容器的端口映射与 portproxy 规则，逐端口应用／移除转发（只读事实层，开页零副作用）';

/** 页定义的可变部分（两个页只在这一组字段上不同） */
export interface PaneDefinitionSpec {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly guideId: string;
  readonly guideOrder: number;
  readonly guideTitle: string;
  readonly guideDescription: string;
}

/**
 * 构建页定义。`priority` **刻意不写**（= `extension` 档）；`multiple:false` + `keepMounted:true`
 * 的理由见 README/report；`guide` 文案一律写成 thunk（官方每次使用都重读）。
 */
export function paneTabDefinition(spec: PaneDefinitionSpec): SidebarRightTabDefinitionLike {
  return {
    id: spec.id,
    kind: spec.kind,
    title: () => spec.title,
    multiple: false,
    keepMounted: true,
    guide: [
      {
        id: spec.guideId,
        order: spec.guideOrder,
        title: () => spec.guideTitle,
        description: () => spec.guideDescription,
      },
    ],
  };
}

/** 转发侧页定义 */
export function portsTabDefinition(): SidebarRightTabDefinitionLike {
  return paneTabDefinition({
    id: PAGE_ID,
    kind: PAGE_KIND,
    title: PAGE_TITLE,
    guideId: GUIDE_ENTRY_ID,
    guideOrder: GUIDE_ENTRY_ORDER,
    guideTitle: GUIDE_ENTRY_TITLE,
    guideDescription: GUIDE_ENTRY_DESCRIPTION,
  });
}

/** 两个 seat 的注册参数（`slots.register({name, key}, Component)`） */
export const TAB_SEATS: readonly { readonly slot: string; readonly key: string }[] = [
  { slot: TAB_SLOT, key: PAGE_ID },
  { slot: TAB_TITLE_SLOT, key: PAGE_ID },
];

/**
 * 注册两个 seat（返回 disposer 数组；调用方负责挂到 `ctx.effect`）。
 *
 * 第 4 个参数是 015 加的（容器页用另一个 key）；**缺省值保持 `PAGE_ID`** ⇒ 既有调用点与测试的
 * 签名/语义一字不变。
 */
export function registerTabSeats(slots: SlotsServiceLike, component: unknown, titleComponent: unknown, key: string = PAGE_ID): (() => void)[] {
  const disposers: (() => void)[] = [];
  disposers.push(slots.inject(TAB_SLOT, () => slots.register({ name: TAB_SLOT, key }, component)));
  disposers.push(slots.inject(TAB_TITLE_SLOT, () => slots.register({ name: TAB_TITLE_SLOT, key }, titleComponent)));
  return disposers;
}
