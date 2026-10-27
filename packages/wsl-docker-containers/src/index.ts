/**
 * `dsh-wsl-docker-containers` 公开面 —— **插件入口**（016 从转发包拆出后的形态）
 *
 * ## 宿主加载契约（绝不能少）
 *
 * 宿主（cordis loader）在**包根导出**里按名字找 `name` / `inject` / `apply`（/ `Config`）：
 * 少了 `apply` ⇒ profile 里插了 patch 也不激活；少了 `Config` ⇒ 不注册 settings 命名空间
 * （声明恒空 ⇒ 配置页写不进去）。形态与转发包逐项对齐：具名导出 + 默认对象两种都给。
 *
 * ## 与转发包的关系（016 的核心结论）
 *
 * - **同一个 `name` 字段 = 本包包名**（`dsh-wsl-docker-containers`），与 `cordis.patch.yml` 的
 *   `- id:` 逐字一致 —— 二者不一致会让 patch 行指不到东西；
 * - **没有角色分派**：015 时两行共用一个 `apply` 靠行 id 分派；016 拆包后每包只有一个角色，
 *   `src/role.ts` 已删除；
 * - 依赖方向：只消费 `dsh-wsl-shared`（001）与 `dsh-wsl-docker-core`（016 的纯库），
 *   **不 import 转发包**（`scripts/check-borders.mjs` 钉死这条）。
 */

import { Config } from './config.ts';
import { applyWslDockerContainers } from './containers/plugin.ts';
import type { ContainersContextLike, ContainersPluginConfigLike } from './containers/plugin.ts';

/** 插件名（供 profile 清单的 `id` 引用；**与包名逐字一致**） */
export const name = 'dsh-wsl-docker-containers';

/**
 * 无强依赖：缺服务一律降级 + 记 gap，不拒绝加载。
 *
 * 容器侧真正需要的两个宿主服务（`webServer` / `ctx.provide`）都用**带 gap 的软取**，
 * 因此不需要在这里声明成硬依赖（声明了反而会让「宿主没装 web 端」时整个插件不加载）。
 */
export const inject: readonly string[] = [];

/**
 * 宿主入口（cordis 调用；返回值被忽略）。
 *
 * 016 起本包**只有容器侧这一个角色** ⇒ 不再分派，直接装配（行为与 015 的容器行逐字节一致）。
 */
export function apply(ctx: ContainersContextLike, config?: ContainersPluginConfigLike | undefined): void {
  applyWslDockerContainers(ctx, config);
}

export { Config } from './config.ts';
export { applyWslDockerContainers } from './containers/plugin.ts';
export { CONTAINERS_SERVICE } from './containers/credential.ts';
export type {
  ContainersContextLike,
  ContainersGap,
  ContainersHostDeps,
  ContainersHostService,
  ContainersPluginConfigLike,
  ContainersTargetDistro,
  WslDockerContainersPluginHandle,
} from './containers/plugin.ts';
export default { name, inject, apply, Config };
