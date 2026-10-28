/**
 * 008 T2.9 写通道鉴权 —— **015 P1 起是共享层的薄壳 + 转发侧自己的配置提示**
 *
 * ## 搬迁留痕（原文结论一字未删，只是换了住址）
 *
 * 比较语义（`sha256` + `timingSafeEqual`、`?token=` → `Authorization: Bearer`、未配置 ⇒ fail-safe 401、
 * 固定拒绝文案）搬到 [`../shared/credential.ts`](../shared/credential.ts)：015 把「转发」与「容器」
 * 拆成两条行，两行各持一份凭据、各持一条通道，但**比较语义只能有一份**（否则「A 的令牌打不通 B」
 * 这条判据会退化成两套实现的巧合）。
 *
 * **留在本文件的是「转发侧的配置提示」**：那段文案写着 `- id: dsh-wsl-docker-ports`，属**业务**
 * （015 R3 白名单把 `src/shared/**` 钉成字段/行无关的底座）。容器侧有自己的一份
 * （`../containers/credential.ts`）。
 *
 * 本文件继续导出**原来的全部名字**（值与类型），因此
 * - `src/transport/routes.ts` / `src/docker/route.ts` 的 import 一行不用改；
 * - `tests/unit/transport-write-auth.test.ts` 的 import 与断言一行不用改。
 *
 * ## 与原注释一致的判据（保留原话）
 *
 * 1. **未配置 ⇒ 一律拒绝**（fail-safe）：`writeToken` 缺失或空白 ⇒ `plan` / `apply` / `audit` 全部 401。
 * 2. **配置了 ⇒ 常量时间比较**：两侧先 `sha256` 再 `timingSafeEqual` ⇒ 任何长度都走同一条代码路径。
 * 3. **绝不回显/记录凭据**：拒绝文案是**固定文本**。
 *
 * 凭据怎么带：`?token=<t>` 或 `Authorization: Bearer <t>`；优先级 = **查询参数 → 头**。
 */

import {
  createWriteAuthenticator as createSharedAuthenticator,
  type WriteAuthenticator,
} from 'dsh-wsl-docker-core';
import type { ConfigValueSource } from 'dsh-wsl-docker-core';

export {
  WRITE_AUTHORIZATION_HEADER,
  WRITE_TOKEN_QUERY_PARAM,
  readWriteCredential,
} from 'dsh-wsl-docker-core';
export type {
  CredentialRequestLike,
  WriteAuthFailure,
  WriteAuthResult,
  WriteAuthenticator,
  WriteHeaderBag,
} from 'dsh-wsl-docker-core';

/**
 * 转发侧的配置提示（**不含凭据本体**；未配置时随 401 一起给用户看）。
 *
 * ⚠️ 行 id 写在这里而不是共享层：提示里写错行，用户会去改**另一条行**的配置，而且那种错
 * 表现为「配了还是不生效」—— 比直接 401 更难查。
 */
export const WRITE_TOKEN_CONFIG_HINT =
  '配置方法：① 本包配置页的「生成并保存写通道凭据」（写进 settings 命名空间的 writeToken 字段，' +
  '推荐）；或 ② profile 的 cordis.patch.yml 里给 - id: dsh-wsl-docker-ports 条目加一项 ' +
  'config: { writeToken: "<随机长串>" }（与 elevationPolicy 同一处）。' +
  '两种写法都即时生效（字段是 volatile，宿主每次请求现读凭据，不需要重载插件）。' +
  '之后以 Authorization: Bearer <令牌> 或 ?token=<令牌> 调用本通道。';

/** 转发侧鉴权器：共享实现 + 转发侧提示（缺省参数让既有单参调用点一行不用改） */
export function createWriteAuthenticator(source: ConfigValueSource): WriteAuthenticator {
  return createSharedAuthenticator(source, WRITE_TOKEN_CONFIG_HINT);
}
