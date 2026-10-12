/**
 * `dsh-wsl-docker-ports` 公开面 —— **插件入口**（003 T6.7⑤「公开面收敛」后的形态）。
 *
 * ## 收敛事实（2026-10-12）
 *
 * | 口径 | 收敛前 | 收敛后 |
 * | --- | --- | --- |
 * | 运行时导出（值，计入 001 REQ-6.4 的「≤ 12」） | **33** | **6** |
 * | 类型导出（`export type`，编译后擦除，不计入预算；软阈值 25） | 45 | 7 |
 *
 * 33 = Phase 0–2 的 barrel **27** + 入口 **6**。那 27 个（`decodeNetshOutput` / `diff` /
 * `parsePortproxyTable` … ）**包外消费方 = 0、包内也一律走具体模块路径**
 * （`./read/netsh.ts` / `./diff/engine.ts`，经本 barrel 的次数 = 0）⇒ 正是 001 REQ-6.4
 * 所防的「投机导出 / 杂物袋」形态 ⇒ 本轮**只摘导出、不删实现**：实现、测试、调用点一行未改。
 * 逐名字的消费方证据与判定口径写在 `scripts/check-exports.mjs` 的 `CONSUMERS` 表里（本包回归门，
 * 不在共享门里 —— 把门扩到另两个包属 001 的口径变更，见 tasks.md 的建议登记行）。
 *
 * ## 🔴 绝不能删的 4 个（宿主加载契约，(a) 类）
 *
 * 宿主（cordis loader）在**包根导出**里**按名字**找 `name` / `inject` / `apply`（/ `Config`）：
 *
 * - 少了 `apply`，profile 里插了 patch 也**不会激活** —— 宿主只会 import 到一堆普通导出；
 * - 少了 `Config`，宿主**不注册 settings 命名空间**（**2026-10-12 真机缺陷 1**：`settings/describe`
 *   的 20 个命名空间里有 002、没有本包 ⇒ 声明恒空 ⇒ 零步骤）。声明本体与全部实测证据在 `./config.ts` 文件头。
 *
 * 形态与 002 宿主半（`packages/terminal-profiles/src/index.ts`）逐项对齐：具名 `name` / `inject` /
 * `apply` / `Config` **加**默认对象 `{ name, inject, apply, Config }`（宿主官方三种形态里的两种，
 * 免疫解析差异）。本包 `package.json` 的 `exports["."]` 已切到**构建产物** `./lib/index.js`。
 *
 * ## 其余 2 个（入口面）
 *
 * - `applyWslDockerPorts`：依赖注入入口（`apply` 的薄壳），**产物级消费方** =
 *   `scripts/verify-host-entry.mjs`（真 `import('./lib/index.js')` 后调用它并断言 gaps）⇒ 摘掉它
 *   会让那道门在下次 `build` 后变红；
 * - `PORTS_SERVICE`：跨插件**服务身份**（`ctx.provide` 的服务名），是本包唯一对外的值契约。
 *
 * 写路径与提权（`src/write/` `src/elevate/`）属 **005**；客户端半是 `exports["./client"]`
 * （`lib/client.js`，另一条产物链），与本文件无关。依赖方向：**只消费** `dsh-wsl-shared`（001）
 * 的公开面，不 import 002（`dsh-terminal-profiles`）—— 与它的关系只有 Phase 5 的可选注入（REQ-10.2）。
 */
import { Config } from './config.ts';
import { apply, inject, name } from './plugin.ts';

export { Config } from './config.ts';
export { apply, applyWslDockerPorts, inject, name, PORTS_SERVICE } from './plugin.ts';
export type {
  PluginContextLike,
  PluginGap,
  PortsHostDeps,
  PortsHostService,
  PortsPluginConfigLike,
  TargetDistro,
  WslDockerPortsPluginHandle,
} from './plugin.ts';
export default { name, inject, apply, Config };
