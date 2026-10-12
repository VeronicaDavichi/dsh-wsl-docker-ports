# 客户端半契约 · 增量修正（§P）

> **本文件是 [`client-contract.md`](./client-contract.md) 的拆分件**（2026-10-12；原文件 422 行 > 「单文件 ≤ 400 行」SHALL）：承接 §P（**同日第二轮回收的增量修正**，P1–P9）的**全部正文**，逐字未改。
> ⚠️ **编号有历史重号**（P3 / P4 / P5 各出现两次：P2 之后接的是旧编号 P3–P5，再接新编号 P3–P5）—— 这是原文件既有事实，**本次拆分不重排、不改号**；仓内 `§P2` / `§P3` / `§P4` / `§P5` / `§P9` 引用按上下文取用。
> §A–§F + §Z 在 [`client-contract-base.md`](./client-contract-base.md)；`## 0. 结论速览` 与「研究方式」留在主线。主线 `client-contract.md` 保留同名 `## P.` 标题 + 一行指针。

## P. 🔴 增量修正（同日第二轮回收，**覆盖 §C8 / §E14 / §D13 / §E15 与 §Z 的相应条目**）

> 证据源同前（官方 `0.1.7-rc.2` tgz 只读探针 + `E:\NodeProjects\dsh-desktop` 源码）；版本落差不变：**只对 0.1.7-rc.2 成立**（`vendor\dsh-runtime\0.1.7-rc.2\runtime.json:2` 是 0.2.0-rc.2，但 `resources\` 下除 `app.asar` 外无松散 `dsh-client-ui-*` 文件）。

### P1 官方页类型 kind = **9 个**（**推翻**「6 个」；概念名 = page/tab kind，无 `PageKind` 类型）

| # | kind | 出处（tgz :: member:line） |
| --- | --- | --- |
| 1 | `guide` | sidebar-right :: `lib/types/client/contract/seed.d.ts:26` `GUIDE_KIND = "guide"` |
| 2 | `files` | sidebar-files :: `lib/types/client/definition.d.ts:4` |
| 3 | `browser` | sidebar-browser :: 同上 |
| 4 | `text` | sidebar-documentpreview :: `definition.d.ts:13` `TEXTPREVIEW_KIND` |
| 5 | `changes-review` | deliverables :: `lib/types/client/review-definition.d.ts:13` |
| 6 | `terminal` | **sidebar-terminal** :: `lib/client.js:440` `kind: "terminal"` |
| 7 | `scheduleTask` | schedule :: `lib/types/client/definition.d.ts:15` |
| 8 | `plan` | plan :: `lib/client.js:630` 附近 |
| 9 | `subagentchat` | subagent :: `lib/client.js:808` 附近 |

- 参数表类型名：`SidebarRightTabParamsMap`（sidebar-right :: `…/contract/params.d.ts:28`）。
- `dsh-client-ui-chat` 的 `COMPACT_KIND = "compact-checkpoint"` **未出现在任何注册调用点** ⇒ 是否页类型未验证。
- **`'editor'` / `'diff'` / `'preview'` 作为 kind 全库 grep 0 命中**（不存在）。
- ⚠️ 别混：`kind: 'single'|'keyed'|'list'|'chain'` 是**槽基数**（slots :: `lib/types/index.d.ts:83` `SlotKind`），与页类型无关。
- ⇒ **判据改口**：可证的只有「**0.1.7-rc.2 有 9 个，且 `managedTerminal` 未被任何官方包占用 ⇒ 仍安全**」；「官方恰好 6 个」**无实物支撑**，该数字从规格里撤下（真机 `sidebarRightTabs.entries()` 打印后再写死）。
- ⚠️ 注意第 6 项：官方**已经有一个 `terminal` kind**（`dsh-client-ui-sidebar-terminal`）⇒ 我们选 `managedTerminal` 是对的（**不抢占**官方 kind），且应在设计里写明「与官方 `terminal` 区分」的理由。

### P8 ✅ **可复算的「清单预检」**（把官方准入逻辑搬来离线跑，2026-10-09 实测两包全过）

**做法**：把官方宿主侧 `clientExportOf` 与 `CLIENT_CHUNK` **逐字**搬进一段 node 片段，对自己包的 `package.json` 跑一遍 —— 等于**提前走一遍宿主的准入**，比「看代码猜」可靠。五个判定：

| # | 判定 | 依据 |
| --- | --- | --- |
| ① | `clientExportOf(pkg.name, pkg.exports)` 能解析出 `./lib/client.js` | §P3/P7 的官方函数（形状错会 **throw**） |
| ② | 主产物**文件名恰好 `client.js`** | §P3 `chunkUrl()` 的 `<rowId>/client.js` 断言（不匹配 **throw**） |
| ③ | `dsh.client.platform === 'web'`，`inject`/`external` 若存在则必须是 `string[]` | §P5 权威 schema |
| ④ | `dsh.bundle.patch` 是字符串**且实物存在** | §P7 清单四件套 |
| ⑤ | `lib/` 里除主产物外的 `client.*` 文件名**匹配** `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` | §P3 宿主按需路由准入正则 |

**2026-10-09 实测结果**：`dsh-terminal-profiles`（`inject: []`、`external: []`）与 `dsh-wsl-docker-ports`（`inject: ["@deepseek-ai/dsh-client-ui-sidebar-right"]`）**五项全过**；⑤ 当时两包尚未构建（`lib/` 为空），构后需复跑。
**注意**：`inject` 是**信息性**的（§P5），声明了不 require 的包**不会**被 composition 拒绝；会被拒绝的是 **`external` 里声明的非基线请求缺供给方**。

---

- 🔁 **2026-10-09 12:01 复跑（T6.7 改过 003 清单之后 + Phase 6 改过 002 bundle 之后）**：**002 = 5/5** ✓；**003 = 4/5**，红在 **①**（`exports["./client"]` 解析出 `./lib/client.js` 但**文件不存在**），**⑤** 也因此扫到 0 个产物。⚠️ **这不是缺陷、是构建中间态**：`packages/wsl-docker-ports/lib/` 在 **11:57:04** 被清理（顶层只剩 `index.js` / `plugin.js`），而该包代理此刻（**12:01:09–12:01:21**）仍在改 `src/`。⇒ **本轮结论：002 通过；003 待其收工后复跑**（这是本仓第三次因「代理在飞时测产物」得到假结论 —— 已升格为硬规矩：**产物类判据一律在代理 `inactive` 后跑**）。

- ✅ **12:02 复跑（同日，闭环）**：**两包均 5/5** —— 003 的 `lib/client.js` = **83,709 B**（T6.8 的数据通道代码入包后比 80,199 B 增 ~3.5 KB）、`lib/client.*` 扫 **1** 个（单产物、无 chunk，符合「003 不需要 chunk」的设计）。⇒ 上一条 ① 的假红**确认是构建中间态**、非缺陷；本条与「代理在飞时不测产物」的定性互为印证。

### P7 📋 **官方客户端插件的清单参照物**（2026-10-09 六次取证：`dsh-client-ui-sidebar-terminal` 的 package.json）

**证据源**：官方 `deepseek-ai-dsh-client-ui-sidebar-terminal-0.1.7-rc.2.tgz :: package/package.json`（逐字）。这是**唯一一个「官方自己写的浏览器客户端插件」清单**，可直接当我们的比对基准。

```json
{
  "name": "@deepseek-ai/dsh-client-ui-sidebar-terminal",
  "dsh": { "client": {
    "inject": ["@deepseek-ai/dsh-api-terminal-controller","@deepseek-ai/dsh-client-ui-sidebar-right",
               "@deepseek-ai/dsh-api-remotes","@deepseek-ai/dsh-client-ui-theme",
               "@deepseek-ai/dsh-client-shortcuts"],
    "platform": "web" } },
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*", "./package.json": "./package.json" },
  "main": "lib/index.js",
  "files": ["lib/index.js", "lib/client.js", "lib/client.*.js", "lib/types/**/*.d.ts"],
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" }
}
```

**可照抄的结论**
1. **`exports["./client"]` 形状** = `{ types, default: './lib/client.js' }` ✅ 与我们计划一致；主入口 `.` 同时给 `types`/`default`。
2. 🔴 **`files` 必须覆盖 chunk**：官方写 **`"lib/client.*.js"`** —— **chunk 靠这个 glob 才会进发布包**。我们走 `link:` 交付时不受影响（磁盘上就在 `lib/`），但**将来发布前必须补**（已要求两个代理补 `files`）。
3. **最小化声明**：官方 `dsh.client` **只有 `inject`（包名数组）+ `platform`** —— **没有 `external`、没有 `manifestVersion`、没有 `immediately`** ⇒ 印证「**零非基线 require**」是官方做法（能只依赖基线就不写 `external`）。
4. **`peerDependencies` 只有 cordis**（`~4.0.4`）⇒ react / 各 `@deepseek-ai/dsh-client-*` / xterm **全在 devDependencies**（§P2 的结论在此再次印证）。
5. ⚠️ **别误读**：官方这个包**没有** `dsh.bundle.patch` —— 它是「客户端半」形态；**我们两个包是宿主插件**（要注册服务/工具、要有插件行），所以 **`dsh.bundle.patch` 仍必须保留**，不能因为参照物没有就删。

**rc.1 → rc.2 的差异**（顺带留痕）：`inject` 增加了 `@deepseek-ai/dsh-client-shortcuts`、各 devDep 从 `0.1.7-rc.1` 升到 `rc.2`、版本号变化 —— 即 **`inject` = 所消费的客户端包名清单**（信息性依赖），与 §P5 的类型注释一致。

---

### P6 📊 **跨版本稳定性弱证据**（2026-10-09 五次取证：0.1.7-rc.1 ↔ 0.1.7-rc.2 逐字节对照）

**动机**：我们离线只有 `0.1.7-*` 的 tarball，而宿主基线是 **0.2.0-rc.2**（§Z6 版本差）⇒ 想知道「这套客户端契约是稳定接口，还是某个 rc 的临时形态」。做法：同包两个版本**逐字节 sha256 对照** + 关键片段双版本命中。

| 产物 | rc.1 | rc.2 | 判定 |
| --- | --- | --- | --- |
| `dsh-client-modules :: package/lib/client.js` | 40,277 B | 40,277 B | ✅ **逐字节相同**（sha256 前 12 位 `6fa57df9f122`） |
| `dsh-client-modules :: package/lib/index.js` | 41,704 B | 41,704 B | ✅ 逐字节相同（`03ea21df5562`） |
| `dsh-package-manifest :: package/lib/types/types.d.ts` | 4,169 B | 4,169 B | ✅ 逐字节相同（`8ce89a258667`） |
| `dsh-client-ui-sidebar-terminal :: package/lib/client.js` | 18,073 B | 19,887 B | ❌ 有差异（**插件实现变了**） |
| `dsh-client-ui-sidebar-terminal :: package/package.json` | 2,420 B | 2,520 B | ❌ 有差异 |

| 关键片段 | rc.1 | rc.2 |
| --- | --- | --- |
| 宿主 `CLIENT_CHUNK` 正则 | ✅ | ✅ |
| 宿主 `clientExportOf` 报错文案（`… a string or an object with a string default`） | ✅ | ✅ |
| 浏览器 `chunkUrl` 的 `!== \`${row.id}/client.js\`` 断言 | ✅ | ✅ |
| 浏览器 `chunkId(ownerId, fileName)` | ✅ | ✅ |

**解读（谨慎版）**：**插件在变、宿主契约逐字节没变** ⇒ §P3/§P4/§P5 描述的是**稳定接口**（`CLIENT_CHUNK` 命名规则、`chunkUrl` 的 `client.js` 断言、`exports['./client']` 形状校验、`DshClientManifest` 字段集），不是某个 rc 的偶然形态。
**但这不是真机验证**：① 样本只有 rc.1→rc.2 一步，**不能外推**到 `0.2.0-rc.2`；② 本机 vendor 目录**没有 0.2.0-rc.2 的 tarball**（只有 0.1.5-rc.2 / 0.1.7-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2）⇒ **§Z6 / §Z10 的真机项依然成立、依然要做**，本表只用于**排优先级**（先验「产物文件是否被服务」这类形态问题，再怀疑契约本身）。

---

### P5 📌 **权威 manifest schema**（2026-10-09 四次取证：`dsh-package-manifest` 的 `.d.ts` 逐字）

**证据源**：官方 `deepseek-ai-dsh-package-manifest-0.1.7-rc.2.tgz :: package/lib/types/types.d.ts`（**类型定义**，最高证据级）。

```ts
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /**
     * Exact module-table requests beyond the implicit client baseline, including
     * subpaths such as `<pkg>/client`; absent means baseline externals only.
     * Type-only imports are erased and create no module request.
     */
    external?: string[];
}
export interface DshManifest {
    manifestVersion?: 1;                    // 清单格式版本（与 npm/Session 版本无关）
    bundle?: DshBundleManifest;             // { patch: string | string[] } —— 相对**声明包根**
    profile?: DshProfileManifest;           // { bundles?: string[] } —— profile 目录自己的清单
    client?: DshClientManifest;
}
export interface DshPackageManifest {
    name: string; version: string; description?: string;
    icon?: string;        // SVG/PNG/JPEG/WebP，**≤ 256 KiB**，相对本清单目录且 realpath 后仍在其内
    private?: boolean; dependencies?: ...; peerDependencies?: …;
    engines?: { dsh?: string /* SemVer 区间 */, node?: string, npm?: string, [engine: string]: string | undefined };
    dsh?: DshManifest;
}
```

**🔴 两处口径纠正（此前我混为一谈）**
1. **`dsh.client.inject` = 包名列表，且注释逐字说明 *"Informational package-name dependencies, **not** Cordis service injection"*** ⇒ 它是**信息性依赖声明**（官方终端页写的正是包名：`@deepseek-ai/dsh-api-terminal-controller` / `…-client-ui-sidebar-right` / `…-api-remotes` / `…-client-ui-theme` / `dsh-client-shortcuts`）。**它不是 Cordis 服务注入** —— 与之同名但**完全不同**的是**客户端入口模块自己导出的 `inject`**（那是 Cordis 服务名数组，我们 = `['slots']`）。两个 `inject` 不要互相抄。
2. **`immediately`** = *"Boot **phase-one registration barrier**; absent means the shared application batch"* ⇒ 语义定案（原 §Z3 关闭；我们**不写**它 = 走共享批）。

**其它可用于 T0.5 安装接入的字段**：`dsh.manifestVersion = 1`（可选，声明格式版本）· `dsh.bundle.patch` 可为**字符串或有序数组**（相对声明包根）· `engines.dsh` 是 **SemVer 区间**（对 DSH 的兼容声明，读取方是否强制未定）· `private: true` 阻止发布（本仓三包都是 private ✓）。

---

### P4 📌 manifest 的**第四个字段 `dsh.client.external`** + 机制逐字确认（2026-10-09 三次取证）

**证据源**：官方 `deepseek-ai-dsh-client-modules-0.1.7-rc.2.tgz :: package/README.md`（**规范文档**，非推断）。逐字引用：

- L34 `### Declaring a client plugin`：*"A browser plugin package declares `dsh.client` in its `package.json` with `platform: 'web'`, exports a `./client` bundle, and **lists any non-baseline module requests under `dsh.client.external`**. The host half turns each declaration into a served bundle **under `/plugins`**, ordered so dynamic providers load before their consumers."*
- L46 `### Sharing modules`：*"The shell seeds a frozen module table (**`PLATFORM_MODULES`: React, Cordis, and static UI libraries**); every dynamic bundle resolves its externals against exactly that baseline. **`dsh.client.external` adds only exact non-baseline requests**, each answered by the dynamic package row it names or an exact static-table key. **Type-only imports are erased and create no request.** Composition **rejects malformed requests, missing suppliers, self-requests, and synchronous request cycles**."*
- L38：*"A source `import()` split by tsdown compiles to **`require.async("./client.<name>.js")`**; its versioned sibling script arrives only when that expression runs."*（⇒ 与 §P3 的 `client.<name>.js` 正则**互相印证**）
- L38：*"`<id>/client` and the bare id resolve to the same exports, because a plugin bundle is its package's client half."*
- L50 `### Build requirements`：*"The host serves built client bundles, so **`pnpm run build` must have produced each `lib/client.js` before launch**; a missing bundle **fails activation loudly** with one build instruction and a package/path list."*
- L68 `### Lazy-CJS model`：*"Executing a plugin bundle only registers its factory; **every module-body side effect (CSS injection included) lives in the factory closure and runs at materialization** (`factory(require)` → exports, memoized in `loadCache`)."*

**⇒ 对本项目两个客户端半的硬要求（**两个包都适用**）**
1. **manifest 至少四件**：`dsh.client = { platform:'web', inject:[…], external?:[…], immediately? }` + `exports['./client']` + `dsh.bundle.patch` + 构建产物 `lib/client.js`（缺产物 = **激活期响亮失败**）。
2. **require 面越小越好**：基线 = React / Cordis / **静态 UI 库**（官方终端页 require 了 `@deepseek-ai/dsh-client-ui-primitives` 却**没有**写 `external` ⇒ 它属基线）。**非基线的 require 必须逐条写进 `dsh.client.external`**，否则会被 composition **拒绝**（missing supplier）。
3. **不要 require `react-dom`**：我们的组件由宿主渲染进它的树，自己**不建 root** ⇒ 客户端半只需要 `react`（+ `react/jsx-runtime`）。（`react-dom` 只出现在**测试**里。）
4. **CSS 注入必须发生在 factory 闭包内**（材质化时执行），不要在模块顶层做副作用（顶层副作用不在 `loadCache` 语义内）。
5. 自检脚本应断言：**主 bundle 的 require 集合 ⊆（基线 ∪ 清单里声明的 `external`）**，且清单里声明的 `external` **每一条**都真被 require（避免幽灵声明）。

⚠️ 与 §A 的关系：§A 的清单描述**漏了 `external` 字段**，以本节为准；`inject` 与 `external` 是**两件事**（前者 = 客户端服务注入，后者 = 非基线**模块**请求）。

---

### P3 📌 chunk 的**命名与取用规则**（2026-10-09 二次取证，逐字）

**证据源**：官方 `deepseek-ai-dsh-client-modules-0.1.7-rc.2.tgz`（宿主侧 `lib/index.js`、浏览器侧 `lib/client.js`）。

宿主侧 `lib/index.js`：
- `const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;` 注释逐字 *"Published package-local client chunk names **accepted by the on-demand route**."*
- `clientExportOf(pkgName, exportsField)`：`exports["./client"]` 必须是**字符串**或**带字符串 `default` 的对象**，否则 `throw new Error('client-modules: … must be a string or an object with a string default')`。

浏览器侧 `lib/client.js`：
- `function chunkId(ownerId, fileName) { return `${ownerId}/${fileName}`; }`
- `function chunkUrl(row, fileName, rev) { const url = atRevision(row.url, rev); const resourceStart = url.indexOf("/??"); const revisionStart = url.indexOf("&rev=", resourceStart + 3); if ((resourceStart < 0 || revisionStart < 0 ? void 0 : url.slice(resourceStart + 3, revisionStart)) !== `${row.id}/client.js`) throw new Error(`client-modules: cannot resolve chunk ${JSON.stringify(fileName)} from bundle URL ${url}`); return `${url.slice(0, resourceStart)}/${row.id}/${fileName}?${url.slice(revisionStart + 1)}`; }`

**⇒ 推导出的硬要求（我们的构建必须满足，否则运行时才炸）**
1. **主 bundle 的文件名必须恰好是 `client.js`** —— `chunkUrl` 会断言 URL 的资源段等于 `<rowId>/client.js`，不匹配**直接 throw** ⇒ 我们把 `exports["./client"]` 指向 `./lib/client.js` ✅ 正确。
2. **chunk 必须与 `client.js` 同目录（兄弟文件）**，且文件名**必须匹配 `client.<name>.js`**（`<name>` 首字符须为字母/数字）⇒ `lib/client.terminal.js` ✅ 合规；叫 `terminal-chunk.js` ❌ 会被按需路由拒掉。
3. 运行时 chunk URL = **`<base>/<rowId>/<fileName>?rev=<rev>`**（宿主**按需路由**）⇒ **chunk 不出现在 `exports` 里是正常的**，不是遗漏。
4. `require.async("./client.terminal.js")` 的实参就是**兄弟文件名**（URL 由 loader 自己拼），**不要**写绝对/带目录的路径。
5. `exports["./client"]` 形状错会**抛错**（不是静默）⇒ 我们的 `{ "types": …, "default": "./lib/client.js" }` ✅ 合规（字符串形式也合规）。

**新增未验项**：**Z10** 0.2.0-rc.2 是否仍用同一套 `??` 单资源 URL + `&rev=` 结构（真机看一次实际请求即可）；**Z11** 浏览器侧注释提到 *"the runtime mirror of the **build-time bundle purity gate**"* ⇒ 宿主可能另有**构建期 bundle 纯净性门**（未找到实现），真机/构建时留意。

---

### P2 🔴 **已撤回**：原判「独立懒加载 chunk 是逆契约」—— **错**（同日二次取证推翻）

> **本节撤回原 §P2 的结论，并覆盖 §0-11 / §E14 / §Z5 的对应条目。** 下面的机制才是契约。

**为什么错（方法教训，写给未来的自己）**：我只看了 `dsh-plugin-desktop` —— 那是**一个外壳插件自己的选择**（`vite.client.config.ts:41` `codeSplitting: false`），却把它当成**宿主契约**推广；**没有去查「真正做终端页的那个官方包」**。⇒ **否定性结论必须取自「做这件事的那个官方包」，不能从别的插件反推。**

**实证（官方 `deepseek-ai-dsh-client-ui-sidebar-terminal-0.1.7-rc.2.tgz`，逐字）**

- **主 bundle** `package/lib/client.js` = **19,887 B**，其中一行：
  `const LoadedTerminalBody = (0, react.lazy)(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }))`
  其注释原文：`/** Load xterm only after a terminal body is mounted. */`
- **懒加载 chunk** `package/lib/client.terminal.js` = **685,949 B**，文件头逐字：
  `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-sidebar-terminal", chunk: "client.terminal.js", factory: (require) => { var module = { exports: {} }; … } })`
- 该 chunk 内 `@xterm/xterm` / `@xterm/addon-fit` **各命中 1 次**（`FitAddon` ×5）⇒ **xterm 内联进 chunk**，**不是**宿主 external。
- **chunk 文件不在 `exports` 里**（exports 只有 `.` / `./client` / `./src/*` / `./package.json`）⇒ 宿主按**包内相对路径**取它。

⇒ **官方契约 = 小主 bundle + `chunk:` 文件，经 `require.async("./<file>.js")` 取**。`codeSplitting: false` 只是某个插件自己的选择，**不是契约**。**我们原栈「独立懒加载 chunk」正确**，判据恢复，并具体化为上述 API。

**顺带（Phase 4 直接可用）**：官方终端页的 `devDependencies` 同时含 `@xterm/xterm`、`@xterm/addon-fit`、`react`、`react-dom`、`@types/react`、`@types/react-dom`、`@testing-library/react`、`clsx`，以及它 `require` 的**每一个** `@deepseek-ai/dsh-client-*` 包；`peerDependencies` 只有 `@deepseek-ai/cordis: ~4.0.4` ⇒ **external 的声明方式 = 全部进 devDependencies**（宿主在运行时供给），组件测试用 `@testing-library/react`（需 jsdom 环境）。

#### P2·2026-10-12 追加变更记录（**尺寸口径变更**：比例代理 → 直接判据 + 明确上限）

> 上面 §P2 的正文（撤回与实证）**一字未改**；下面是**同一坐标上的追加**记录，它取代其中「体积」这一条的实现口径。
> 触发：主人 2026-10-12 裁决（原话）「**保留已在运行的实质判据（主 bundle 不含 xterm 实现），把“×10”换成有记录的明确上限（如主 ≤ 64 KB）并在 `client-contract.md` §P2 追加变更/理由**；本仓规范：改口径 = 改契约 + 追加留痕。」

| 项 | 旧口径（**已作废**） | 新口径（生效） |
| --- | --- | --- |
| 判据 | `mainBytes * 10 < chunkBytes`（**体积比例代理**） | ① 主 bundle **不含 xterm 实现**（指纹 `@xterm/xterm` + `.xterm-viewport`）② 主 bundle **不含内联 React**（`__SECRET_INTERNALS_…` 标记）③ `mainBytes <= 65,536 B`（**64 KiB 明确上限**，含等号） |
| 标签 | 「体积比 chunk 小**两个数量级**」—— **错**：代码是 **10×**，不是 100× | 数值上限写进判据名（`主 bundle: 体积 ≤ 明确上限 64 KiB…`）；名字里**不再出现**「两个数量级」 |
| 「chunk 显著大于主 bundle」 | 当**硬判据**用 | 降为**软提示**（`measurements.sizeHint`：只记账，**不参与** `ok` / `failures`） |

**实测依据（2026-10-12，Windows 侧 `node` 直调；两次构建逐字节一致）**：`lib/client.js` = **53,014 B**、`lib/client.terminal.js` = **447,255 B** ⇒ 比值 **1 : 8.44**；旧判据（要求 > 10×）差 **21,405 B / 4.6%** ⇒ **恒定红**，且**与 xterm 无关**。xterm 指纹在主 bundle **0 命中**（`@xterm/xterm` = 0、`.xterm-viewport` = 0、`requestMode` = 0、`_core` = 0、`FitAddon` = 0；对照 chunk = 3 / 1 / 3 / 218 / 2）⇒ **同一门里的实质判据一直是绿的**。主 bundle 的成长来自**合法功能增长**（007 只读态 + 002 guide 入口进主 bundle），不是把 xterm 打进了主包。

> ⚠️ **订正一处流传的读数**：改口径前引用的主 bundle **46,866 B** 是**陈旧产物**（`lib/` 止于并行轮 15:45，而 15:56 的 `a44a98f` 改过 `src/client/**` 且**未重建**）。按 HEAD 源码逐提交重建：**43,537（`8bfb6fb`）→ 44,317（`934da46`）→ 46,866（`6191b57`）→ 53,014（`a44a98f`）** —— 前三个数与仓内已记录值**逐字吻合**，可作方法自证。

**上限 64 KiB 的推导（可复算）**：构成（esbuild metafile 的 `bytesInOutput`）= 007 配置页族 **34,530 B（65.1%）**（`config-page` 11,183 + `config-readonly` 8,501 + `config-pipe` 5,791 + `config-slot` 4,186 + `config-row-model` 2,616 + `config-row` 2,253）+ 002 标签壳 **9,984 B（18.8%）**（`tab` 5,273 + `index` 2,443 + `styles` 2,268）+ `config/row-rules.ts` **4,596 B（8.7%）** + 终端薄壳 **2,483 B（4.7%）**（`TerminalPane` 1,913 + `xterm-loader` 570）+ esbuild 包装/helper **1,421 B（2.7%）** = **53,014 B**。成长史见上；**最大单次交付增量 = +6,148 B**；已交付面（002 / 007 / 009）**无**待进主 bundle 的客户端工件 ⇒ 取 **64 KiB = 65,536 B** 后余 **12,522 B**（≈ 当前体积的 23.6%、≈ 最大单次增量的 **2.04×**）。

🔴 **这不是物理规律，只是当前证据下的合理值**：上限**不阻止**未来的合法功能把主包做大。**下列任一发生即必须改契约 + 追加留痕后重定上限**：① 002 / 007 / 009 的**新**客户端面要进主 bundle（P1 与「下一期」**不在**本 Spec 面内）；② `mainBytes` 触到上限 —— **先拆**（把配置页族改成懒加载 chunk，§E 允许）**再谈**抬上限，**不得先塞后抬**；③ 余量 < 一次「同类细化」的实测增量（当前 ≈ 6 KB）。

**同步落点（一处不漏）**：`packages/terminal-profiles/scripts/verify-client-loader.mjs`（判据实现：`MAIN_BUNDLE_LIMIT_BYTES` = 65,536 / `MAIN_SIZE_CHECK_NAME` / `xtermFingerprintHits` / `mainBundleInvariantChecks`；推导与重定条件写在 `MAIN_BUNDLE_LIMIT_RATIONALE`）· `tests/unit/client-artifacts.test.ts`（同步原 2 例 + **新增 2 条变异哨兵**：塞入 `@xterm/xterm` 标记 ⇒ 该直接判据当场变红；`上限 + 1` 的人造读数 ⇒ 上限判据变红、`= 上限` 仍绿 ⇒ **证明两者都不恒真**）· `stack-decision-changelog.md` 变更记录 **#50** · `stack-decision.md` 的 `## 变更记录` 指针行。


#### P2·适用范围订正（2026-10-12）

> 上面 §P2 的正文与「P2·2026-10-12 追加变更记录」**一字未删**；下面是**同一坐标上的追加**记录，它补齐 §P2 的**适用范围**与 `wsl-docker-ports` 的**存量欠账**登记。

**① §P2 三条判据适用于三包（一宿主批不两套标准）**：`terminal-profiles` 与 `wsl-docker-ports` 的主 bundle 都受**同一套**判据管 —— ① 不含 xterm 实现（指纹 `@xterm/xterm` + `.xterm-viewport`）② 不含**内联 React**（`__SECRET_INTERNALS_…`）③ `mainBytes <= 逐包登记上限`（**含等号**）。判据本体**只有一份** = [`packages/wsl-shared/scripts/lib/p2-main-bundle.mjs`](./packages/wsl-shared/scripts/lib/p2-main-bundle.mjs)（本仓先例：`export-surface.mjs` / `strip-comments.mjs` 都是「一份实现、多处 import」；**不许复制第二份判据**）；上限 / 性质 / 记录日 / 留痕登记在机器可读 SSoT [`packages/wsl-shared/scripts/main-bundle-budgets.mjs`](./packages/wsl-shared/scripts/main-bundle-budgets.mjs)，并与本节下面的标记块**逐字段绑定**（只改一边必红）。

**② 本包主 bundle 的越线早于 008 / 009**：`wsl-docker-ports` 的**初始 client 半**（commit `8bfb6fb`）即 **83,709 B > 64 KiB** ⇒ 越线**不是**新功能造成的；而 **65,536 B 当初只由 `terminal-profiles` 推导**（依据是它的构成与成长史，见上一节「上限 64 KiB 的推导」），**从来不是**「三包通行的推导值」。

**③ 故本包登记为存量欠账**：上限 **144,149 B**、`nature: 'debt'`、记录日 2026-10-12、留痕 `#52`；**棘轮只许降**（抬上限必须「机器表 + 本节标记块」两边同改 **且** 新增 changelog 留痕，门会**自己数行**核对编号真存在）。🔴 **144,149 B 是欠账值，不是认可值** —— 相对 §P2 的推导口径（65,536 B）本包**已越线 78,613 B（2.20×）**；「门绿」只表示「**没有再涨**」，**不表示达标**；🔴 **不得为过门而删功能**。

**④ 收敛路径 = 拆懒加载 chunk**：只切**渲染面**（`src/client/**` 的渲染与配置面料）**不够** —— 按本轮构成推算，切后主包仍 ≈ **70,246 B** > 65,536 B，**仍超 4,710 B** ✗ ⇒ 须**连带**拆**写路径内核**（`src/client/write/**` 等），预期主包 ≈ **49 KB** ✓。该拆包动作**须单独立项**（不在本轮、也不在本 Spec 面内）。

**⑤ 前置阻塞** = **0.2.0-rc.2 的 `require.async` 语义未验**（契约 §Z5 残留）：拆 chunk 的**运行时前提**（宿主是否真按 `require.async("./<file>.js")` 取兄弟文件）在真机确认前不敢定稿。

**逐包上限表（机器可读；核对脚本只解析下面两个标记之间的行，勿改格式）**：

<!-- main-bundle-budgets:SSoT -->
| 包 | 上限（字节） | 性质 | 记录日 | 留痕 |
| --- | --- | --- | --- | --- |
| `dsh-terminal-profiles` | 65536 | hard | 2026-10-12 | #50 |
| `dsh-wsl-docker-ports` | 144149 | debt | 2026-10-12 | #52 |
<!-- main-bundle-budgets:SSoT:end -->

> **判定落点**：机器表 ↔ 本节标记块的**逐字段相等**、棘轮方向、留痕号可追，三件事都由 [`packages/wsl-docker-ports/scripts/verify-client-loader.mjs`](./packages/wsl-docker-ports/scripts/verify-client-loader.mjs) 的 §7 判（`terminal-profiles` 的门**不新增判据** ⇒ 该包读数仍锁在 **60/60**）；§P2 三条判据本体由**两个包的门共用**。

### P3 第三条客户端→宿主通道：`ctx.remote.<service>.<method>()` + `ctx.remote.$on(event, fn)`

- `dsh-desktop-next\src\client\computer-use.tsx:28` `context.remote.pluginManager.listPlugins()`；`:41` `context.remote.pluginManager.setPluginEnabled(row.entryId, enabled)`；`:20-21` `context.remote.$on('plugin-manager/changed', reload)` + `context.on('connection/reset', reload)`
- 5 仓里 `typert` / `ctx.api` / `ctx.client` 字面量 **0** 命中 ⇒ 名字就是 **`ctx.remote.<service>.<method>()`**。
- 另：community-market 宿主侧路由**全是 `kind: 'exact'`**（`dsh-community-market\src\host\routes.ts:698`），依赖声明 `src\index.ts:18` `export const inject = ['webServer']` ⇒ 与我们「HTTP 用 `prefix`」不矛盾（两种都支持），但**官方范例偏 `exact`**。
- ⇒ 002 的通道优先级更新为：**① `remote.settings`（配置读写）→ ② 自建 exact HTTP/WS 路由（终端流与动作）→ ③ `ctx.remote.*`（若 0.2.0 提供且更省事，作为备选）**。

### P4 样式作用域的**真手段**是构建期 `@scope`（手写 CSS 字符串只是命名前缀）

- `dsh-plugin-desktop\vite.client.config.ts:21-22`：`const css = \`@scope (:root:has(.dshDesktopOnboardingContent)) { ${source} }\`` → 再 `document.createElement('style')` 注入。
- ⇒ 我们若走**手写 CSS 字符串**（community-market / whale-pet 路线），作用域**只靠类名前缀**（可接受，REQ-5.2 的「不写全局样式表」应改述为「不引入**未加前缀**的全局选择器」）；要真作用域需在**构建期**包 `@scope`。
- 另确认：`ctx.slots.register` 签名 = **`(options, Component)` 两个位置参数**，`name` 在 `options` 内（slots :: `lib/types/index.d.ts:597-613, 789-791`）—— 002 若按 `(name, id, Component, options)` 写会**编译不过**。
- 另更正：`dsh-community-market\tests\client-api.spec.ts` **不是** slots 的活文档（11 个 `it` 全测它自己的 HTTP 客户端）；真回归门是 `dsh-community-market\tests\client-index.spec.ts:75-79`（把三个 slot 注入钉死：`['settings.plugins.tab','sidebar.footer.action','shell.overlay']`）。

### P5 §Z 更新

| # | 状态 | 说明 |
| --- | --- | --- |
| Z4 | **已关闭（改）** | 0.1.7-rc.2 = **9 个** kind（见 P1）；**0.2.0-rc.2 的数量仍未验证** |
| Z5 | **改判** | 不再问「怎么做懒加载 chunk」，改问「**宿主是否提供 `@xterm/xterm` 作 external**」（否则 xterm 必须进 bundle） |
| Z9 | **新增** | `context.remote` 在 **0.2.0-rc.2** 的名字与形状（只有 0.1.7 系的三方用法，**无官方 d.ts**） |
| Z1/Z2/Z3/Z6/Z7/Z8 | 不变 | 见 §Z 原表 |

### P9 📌 003 的宿主↔客户端**数据通道**（2026-10-09 两轮：源码直读 + **真机装载实测**）

- **传输 = 自建 `ctx.webServer` 具名路由、HTTP-only**：`register({ kind: 'prefix', path, handler })`（真机证实宿主就是这个对象式签名），**不用** `registerUpgrade`。独占前缀 + 快照端点 + `GET`。**不蹭 002 的 `/dsh-managed-terminal/`**。
- 🔴 **宿主路由匹配规则（2026-10-09 真机 + 源码双证：`dsh-host-webserver/lib/index.js:328`）**：`if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;` ⇒ **前缀常量必须【不带尾斜杠】**。我们曾写成 `'/dsh-wsl-docker-ports/'`：宿主实际要求 `startsWith('…//')` ⇒ `/…/snapshot` **永不命中**，被宿主兜底 404 吃掉（**无 Content-Type、无 body、零日志**）。⇒ 既定口径：`PORTS_HTTP_PREFIX = '/dsh-wsl-docker-ports'`（**无尾斜杠**），拼接一律 `prefix + '/snapshot'`；**对外端点 URL 不变**。真机旁证：`GET /dsh-wsl-docker-ports/`（正好等于旧前缀）**能**打到我们的 handler。
- 🔴 **注册时机（真机实测，静默失败）**：`+68ms` 时 `ctx.get('webServer') === undefined`，`+755ms` 本包 `inject(['webServer'])` 才 FIRED ⇒ **在 `apply` 里同步取服务来决定是否注册 = 必然不注册**（插件面板照旧显示「运行中」、**零报错**）。⇒ 注册必须挂在 `ctx.inject(['webServer'], …)`（或等价的宿主可用时机）；「服务缺失 ⇒ 记 gap 且不注册」的语义**保留**。
- **判定顺序**：已知路径 + 非 GET ⇒ **405**；未知路径 ⇒ **404**。⚠️ 真机实证反例：handler 先判路径后判方法时 **405 永不达**（`POST /…/` 得到 JSON 404）。
- 👍 **`HttpResponseLike` 假设【真机成立】**：`response.statusCode = …` + `setHeader('Content-Type'|'Content-Length'|'Cache-Control')` + `end(body)` 在真宿主正确落地（实测 200 + `application/json; charset=utf-8` + 字节准确 `Content-Length` + `no-store`）。`Content-Length` **按 UTF-8 字节**算（中文按字符算会短 ⇒ 长连接串包）。
- **响应形状**：`{ ok: true; snapshot } | { ok: false; error: { code, message } }`；🔴 **路由级错误共四条** —— `not-found` **404** / `method-not-allowed` **405** / `rules-unavailable` **503**（读不到 netsh 规则 ⇒ 事实不可信，整体失败）/ `internal` **500**（未预期抛出）。**订正**：本节 2026-10-09 早先版本写「路由级错误只有两条」，**是错的**（当时只读到 `fail()` 的一部分），以本条为准。
- **其余降级全部走 200 + 快照内字段**（`docker.ok:false` + `reason:'timeout'` / `diff.ok:false` + `reason:'eth0-unknown'` / `distroError`）⇒ 页面照样渲染可读降级态。**真机实证**：冷启动首次 `docker.ok:false, reason:'timeout'`（10s 硬超时砍掉），5 s 后重试 `ok:true`、6 个容器、1.17 s ⇒「超时 + 重试、不把空输出当『没有容器』」成立。
- **查询参数是「声明」不是「事实」**：`managedPorts` / `scope` / `distro` / `elevationPolicy` / `allowColdStart`；作用域分隔符 `':'`；`ELEVATION_POLICIES = ['none','ask','passby']`、缺省 `'none'`。🔴 **非法值一律落到最保守默认、不返回 400**（客户端自己拼参数，回 400 只会让右栏页白屏）。
- **客户端取用点**：`src/client/route-source.ts` 把响应映射成 `PortsSource`；HTTP 失败 ⇒ `error.code`（或兜底 `http-<status>`）+ 可读 message；环境无 `fetch` ⇒ `no-fetch`；**取不到源时右栏页不注册**（`ports-source-missing`，即 T6.8 存在的原因）。⚠️ **真机遗留**：客户端 bundle 加载成功（manifest 里有、200、我们的 CSS 已注入），但**右栏无页、无 snapshot 请求、控制台零 error** ⇒ 疑似同类的「先同步软取 `sidebarRight*`、之后才 inject 注册」竞态（**未证实**，修复任务在查）。
- ⚠️ **真机不可信字段（勿当真值用）**：`elevationAvailable` 现为 `async () => false` 的**占位**（本机 gsudo 2.6.1 已装 ⇒ 真值应为 true）；`iphlpsvcRunning` 恒 `null`（未实现探测）；冷启动那份快照内部不自洽（`diff` 已取到 eth0，而 `distro.state` 仍 `"Stopped"`，竞态）。
- ⚠️ **状态**：离线门禁已收口（T6.8 勾选，上列四码 / `Content-Length` / `no-store` 均出自源码直读）；**真机路由 200 尚未取得** —— 被上述两条真机缺陷挡住（A 时序 / B 尾斜杠），修复在制品。真机装载全程 `desktop` profile 零改动、`--dump-config` 前后 sha256 相同。

