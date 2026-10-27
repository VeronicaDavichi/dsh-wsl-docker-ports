/**
 * **页定义与座位注册**（016：容器包自己的那一份，从转发包同名文件按容器侧收窄）
 *
 * ## 为什么这一小块必须常驻主包
 *
 * `rows.ts` 是**视图装配**（行/指引/五态标签），只有 chunk 侧渲染时才用得到；页定义与两个 seat 的
 * 注册参数却必须在 `apply()` 里就有。拆成小文件后主包只装它（KB 级以下），chunk 才装视图。
 *
 * ## 页定义（016 独立后）
 *
 * | 字段 | 值 |
 * | --- | --- |
 * | `kind` | `wslDockerContainers`（开放字符串；不与官方已用 9 个 kind 重名） |
 * | id / 配置命名空间 | `dsh-wsl-docker-containers`（与 patch 行 id、包名逐字一致） |
 * | guide 位次 | 50（排在官方 `files`=10 / `terminal`=20 / `browser`=30 之后） |
 *
 * `priority` 一律**不写**（= extension 档；官方 `terminal` 用 `builtin`，第三方不许蹭）。
 * `guide` 文案写成 thunk（官方每次使用都重读 ⇒ 换语言无需重注册）。
 */

import type { SidebarRightTabDefinitionLike, SlotsServiceLike } from './host.ts';

/** 容器侧页类型 id / kind / 标题（id 同时是配置命名空间，与行 id 逐字一致） */
export const PAGE_ID = 'dsh-wsl-docker-containers';
export const PAGE_KIND = 'wslDockerContainers';
export const PAGE_TITLE = 'WSL Docker 容器';

/** 两个 keyed seat（contract §C10）：`key = definition.id` */
export const TAB_SLOT = 'sidebar.right.pane.tab';
export const TAB_TITLE_SLOT = 'sidebar.right.pane.tab.title';

/** guide 空态入口（位次 50：独立于转发侧那个 40，用户在空态里要能**分别**进两个页） */
export const GUIDE_ENTRY_ID = 'containers';
export const GUIDE_ENTRY_ORDER = 50;
export const GUIDE_ENTRY_TITLE = '容器';
export const GUIDE_ENTRY_DESCRIPTION = '列出本发行版的容器并启动／停止／重启、查看日志（只读列表，动作需容器通道凭据）';

/** 页定义的可变部分（将来若加第三页，只在这一组字段上不同） */
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
 * 的理由见 015 的报告；`guide` 文案一律写成 thunk。
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

/** 容器侧页定义 */
export function containersTabDefinition(): SidebarRightTabDefinitionLike {
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
 * `key` 缺省 = 本包的 `PAGE_ID`（容器包只有一个页）。
 */
export function registerTabSeats(slots: SlotsServiceLike, component: unknown, titleComponent: unknown, key: string = PAGE_ID): (() => void)[] {
  const disposers: (() => void)[] = [];
  disposers.push(slots.inject(TAB_SLOT, () => slots.register({ name: TAB_SLOT, key }, component)));
  disposers.push(slots.inject(TAB_TITLE_SLOT, () => slots.register({ name: TAB_TITLE_SLOT, key }, titleComponent)));
  return disposers;
}
