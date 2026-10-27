/**
 * 容器侧的**配置读取与凭据**（015 `P2`）
 *
 * ## 三条口径
 *
 * 1. **同一个字段名、另一个命名空间**：容器行也用 `Config` 的 `distro` / `writeToken` /
 *    `refreshIntervalSec`，但命名空间是 `dsh-wsl-docker-containers` ⇒ 值**独立**。
 *    （owner 决策 ①：统一 schema；row namespace 里字段同名、值各算各的。）
 * 2. **只读它真正消费的三个字段**：容器侧不转发、不判决所有权 ⇒ `managedPorts` / `scopes` /
 *    `listenAddresses` / `elevationPolicy` 一个都不读（读了就是替转发侧做决定）。
 * 3. **凭据独立**：`createContainersAuthenticator` 把容器侧自己的提示文案传进共享实现 ⇒
 *    未配置时告诉用户去改**哪一行**；转发侧的令牌打不通容器侧（015 A3 的判据）。
 *
 * ## 为什么 `writeToken` 不在这里 `trim` 第二次
 *
 * `shared/config-read.ts` 的 `readConfigToken` 已经 trim 并做了「空白 = 未配置」的归一化；
 * 共享凭据实现每次请求现读它。本文件只在**构造**时把「读取函数」交出去，不在注册期拍值。
 */

import {
  createWriteAuthenticator as createSharedAuthenticator,
  type WriteAuthenticator,
} from 'dsh-wsl-docker-core';
import { createConfigFieldReader, readConfigToken, unwrapConfigRefreshInterval, unwrapConfigString, type ConfigValueSource } from 'dsh-wsl-docker-core';

/** 容器侧的行 id（与 `cordis.patch.yml` 的 `- id` 一致；也是配置命名空间） */
export const CONTAINERS_ROW_ID = 'wsl-containers';

/** 容器侧服务名（`ctx.provide` 的键；与转发侧的 `wslDockerPorts` 并列，互不覆盖） */
export const CONTAINERS_SERVICE = 'wslDockerContainers';

/**
 * 容器侧的配置提示：**必须写对行 id**。
 *
 * 写错行 = 用户改了转发侧那一行、容器侧仍 401，症状是「配了还是不生效」—— 比直接 401 更难查。
 */
export const CONTAINERS_CREDENTIAL_HINT =
  '配置方法：① 本包配置页的「容器」一节里点「生成并保存容器通道凭据」（写进 settings 命名空间 ' +
  '`dsh-wsl-docker-containers` 的 `writeToken` 字段，推荐）；或 ② profile 的 cordis.patch.yml 里给 ' +
  '`- id: dsh-wsl-docker-containers` 条目加一项 `config: { writeToken: "<随机长串>" }`。' +
  '⚠️ 这两个值属于**两条不同的行**：转发侧 `dsh-wsl-docker-ports` 的凭据对容器通道无效（反之亦然）。' +
  '字段是 volatile ⇒ 保存后即时生效，不需要重载插件。之后以 `Authorization: Bearer <令牌>` 或 ' +
  '`?token=<令牌>` 调用本通道。';

/** 容器侧消费的三个配置字段（每次现读） */
export interface ContainersConfigReaders {
  /** `distro`：留空/非串 ⇒ `undefined`（001 的四级优先级解析接管，与转发侧同一套） */
  distro(): string | undefined;
  /** `writeToken`：已 trim；`undefined` = 未配置（fail-safe：动作/日志 401） */
  writeToken(): string | undefined;
  /** `refreshIntervalSec`：缺省/非法 ⇒ `0`（关闭）；页面用它做自动刷新 */
  refreshIntervalSec(): number;
}

/** 造容器侧的活体读取面（`config` 可以是活体包装 / 平凡对象 / 零参取值函数 / `undefined`） */
export function createContainersConfigReaders(config?: ConfigValueSource): ContainersConfigReaders {
  const field = createConfigFieldReader(config);
  return {
    distro: () => unwrapConfigString(field('distro')),
    writeToken: () => readConfigToken(field('writeToken')),
    refreshIntervalSec: () => unwrapConfigRefreshInterval(field('refreshIntervalSec')),
  };
}

/** 容器侧鉴权器：共享实现 + 容器侧提示（凭据值来自容器侧命名空间） */
export function createContainersAuthenticator(config?: ConfigValueSource): WriteAuthenticator {
  const readers = createContainersConfigReaders(config);
  // 🔴 传的是**零参取值函数**（不是 config 对象）：共享实现的 `source` 语义是「凭据本体」，
  // 每次请求现读 ⇒ 命名空间里的 `writeToken` 轮换后马上生效（volatile 不重挂载）。
  return createSharedAuthenticator(() => readers.writeToken(), CONTAINERS_CREDENTIAL_HINT);
}
