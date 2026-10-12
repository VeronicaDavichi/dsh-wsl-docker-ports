# 008 关闭轮记录：7 条未勾项逐条结清（2026-10-12）

> **本轮边界（先写死）**：**零真机**（未装 profile、未起实例、未跑任何写命令、未开浏览器）、**零新依赖**、**未跑 `pnpm`**（`pnpm run` 经 `verify-deps-before-run` 会写回 lockfile）、**零产品代码改动** —— 唯一新增是测试文件 `packages/wsl-docker-ports/tests/unit/transport-redlines.test.ts`；未碰 `desktop` / `web` / `stack-decision*.md` / `client-contract*.md` / `tests/client/pane-write.test.tsx`。
> **判据只留一份**：本文件装**判据 + 命令原文 + 实测输出**；[`tasks.md`](./tasks.md) 只留勾选与指针（体例同 [009 Phase 8 §1](../009-write-ui/tasks.md)）。
> **口径 SSoT** = [`check-size.mjs`](../../packages/wsl-shared/scripts/check-size.mjs)：行数走 `rawLines()`（`split('\n').length - (以 \n 结尾 ? 1 : 0)`；**> 400 行 = SHALL 失败**）；体积走 `codeOnly()`（去注释、去空行后的 UTF-8 字节；**40KB 是软指标**，只告警）。

## 0. 未勾项清单（开工时实测 **7** 条，口径 `^\s*-\s*\[ \]`）

| # | 行 | 条目 | 结论 |
| --- | --- | --- | --- |
| 1 | 47 | `T2.7 [REQ-6.2]` 红线单测 | ✅ 见 §1 |
| 2 | 49 | `T2.7` 子项（**008 执行层专属**判据） | ✅ 见 §1（**新增用例**；003/005 的守卫不计入） |
| 3 | 57 | `T3.2`（**已迁出**） | ✅ 见 §2（空位保留，内容在 009 T1.1–T1.3） |
| 4 | 64 | `T4.1 [NFR-2]` 体积 / 行数 / 导出门 | ✅ 见 §3 |
| 5 | 66 | `T4.2` 文档同步 | ✅ 见 §4（含 1 条跨 Spec 编号留痕） |
| 6 | 68 | `T4.3 [NFR-1]` 依赖未增 | ✅ 见 §5（**含 1 条残留**：`pnpm install --frozen-lockfile` 未执行） |
| 7 | 70 | `T4.4 [NFR-2]` `apply.ts` 余量 | ✅ 见 §6（395/400，本轮未改） |

## 1. T2.7 红线（含子项）：**新增** 008 自己的执行层红线单测

**新增** `tests/unit/transport-redlines.test.ts` = **164** 行 / **9,694** 字节（LF、`loneCR = 0`）。 🔴 **当场复算订正（旧值原文保留）**：**提交版**实测 = **175** 行（SSOT；`split('\n')` **176**）/ **10,616** 字节、去注释 **8,329** 字节、`loneCR = 0`；**164 / 9,694** 是**首版**（补负对照元断言之前）的值 ⇒ **以 175 / 10,616 为准**。**5** 条用例，断言对象 = **008 自己的执行层**（命令原文 + 真下发 argv + 集合外零动作）：

| 用例 | 判据 |
| --- | --- |
| T2.7 ① | 008 生成的**每条命令原文**（add / remove × lan / loopback，共 **11** 条）逐条断言：零 `reset`、`portproxy <动词>` 只允许 `add` / `delete` |
| T2.7 ② | 每条 `New-NetFirewallRule` 都带**具体** `-LocalPort = 本步端口`（3 条逐条），`looksLikeWildcardAllow()`（005 的 SSoT 谓词）判 false、无 `*`、规则名含端口 |
| T2.7 ③ | **集合外零动作**：空 `steps` + `planId:null`；apply ⇒ `plan-mismatch`、**零提权**（`fake.calls.length = 0`）、零审计、规则集合逐字节不变 |
| T2.7 ④ | **真下发的 argv**：零 `reset`、`-Port` 集合恰好 `[5900]`（别人的端口不出现）、`-Address` = 现读 eth0 |
| T2.7 ⑤ | 静态侧：008 自己的 `src/transport/**`（**9** 个文件）去注释后零 `reset`、零清空 / 导出动词 |

**命令与原始输出**（cwd = `packages/wsl-docker-ports`）：

```text
$ node --test --test-concurrency=1 "tests/unit/transport-redlines.test.ts"
✔ T2.7 ① 无 `portproxy reset`：008 生成的每条命令原文（add / remove / 两种作用域）逐条断言
✔ T2.7 ② 无通配符防火墙：每条 New-NetFirewallRule 都带具体 -LocalPort = 本步端口
✔ T2.7 ③ 集合外零动作：空 steps + planId:null，apply 零提权、零审计、系统逐字节不变
✔ T2.7 ④ 真下发的 argv：无 reset、动词收在 {add, delete}、端口集合恰好是本端口
✔ T2.7 ⑤ 静态侧：008 自己的 `src/transport/**` 可执行文本零 reset、零清空/导出动词
ℹ tests 5 / ℹ pass 5 / ℹ fail 0 / ℹ duration_ms 206
[exit code: 0]
```

**负对照元断言**（防「判据是死的 ⇒ 恒绿」）：`assert.throws(reset)` / `assert.throws(dump)`；`looksLikeWildcardAllow` 对 `Any` / `5000-5003` / `*` 必须判 **true**，且 `Number('Any')` 为 `NaN` ⇒ 与 `step.port` 的比较**必红**。

🔴 **为什么另立一份**（子项原话）：003 的 `redline-guards.test.ts` 扫的是 005 的 `src/write/**` + `src/elevate/**` 的**实现文本**，005 的 `elevate-script.test.ts` 断言的是**脚本模板** ⇒ 都不能替 008 记账。本文件断言的是「**008 的通道把什么交给了执行器**」：命令原文（给人看）＋ argv（真下发）＋ 集合外零动作。
⚠️ **我自己的错（如实留痕）**：首版把 `ownedRule`（返回**单条**规则）直接当 `rules` 工厂传入 ⇒ 事实面返回非数组 ⇒ 计划通道 `rules-unavailable`，①当场判红；改成 `(port) => [ownedRule(port)]` 后绿。**红的不是产品代码，是我的测试夹具。**

## 2. T3.2（已迁出）：空位保留 + 迁移落点逐条在册

- 008 侧：`tasks.md:57-58` 空位与指针保留（`T3.2（**已迁出**）…内容与验收**已迁至** 009 的 T1.1–T1.3…**编号 3.2 保留为空位**`）——**只迁位置、不删内容**。
- 009 侧落点（`Select-String` 当场）：`T1.1 [REQ-9.1]` 结果四态分色、`T1.2 [REQ-9.2]` 失败必带可读原因、`T1.3 [REQ-9.3]` 零硬编码 hex —— **三条均 `[x]`**；009 的未勾项计数 = **0**（009 已 `complete`）。
- 交叉核对：009 `tasks.md:82` 已有「008 侧空位与指针」的当场核对段（`T3.2` / `V6` 锚点逐一可达） ⇒ 两侧同源，不是单边声明。

## 3. T4.1 体积 / 行数 / 导出门（脚本当场出数）

`node packages/wsl-shared/scripts/check-size.mjs`（仓库根）与 `node ..\wsl-shared\scripts\check-size.mjs`（包内）**两次都 exit 0**：

```text
✓ check-size: 去注释代码 25.3 KB / 40.0 KB（25859 / 40960 字节 ⇒ 余 15101 字节；原始 58.8 KB，注释+空行占 57%）
✓ check-size（扩面 2026-10-12）：packages/*/{src,tests,scripts}/** 的 .ts / .tsx / .mjs ⇒ 扫到 278 个文件（terminal-profiles=94、wsl-docker-ports=161、wsl-shared=23）
  · 最大：wsl-docker-ports/tests/client/write-result.test.tsx = 396 行 / 去注释 17335 字节（判据：400 行 SHALL 失败 / 40960 字节软指标只告警）
```

⇒ **超 400 行 = 0 个**、**单文件超 40KB = 0 个**（软指标零告警）；278 里含**并行轮**的 13 个 `zz-*` 探测件。

**008 新增文件逐个报数**（基线 `5cef12a` → 工作区，`git diff --diff-filter=A`，共 **50** 个 `.ts/.tsx/.mjs`；逐文件口径 = SSoT 的 `rawLines()` + `codeOnly()`）： 🔴 **当场复算订正**：按 **HEAD** 复算 = **51** 个（**50** 是提交前工作区的数 —— 本轮新增的测试件当时还没被 git 跟踪，故不在那 50 个里）；`51/51` 全部 ≤ 400 行且 ≤ 40KB，其中本轮新测试件 `tests/unit/transport-redlines.test.ts` = **175** 行 / 去注释 **8,329** 字节。

| 文件（008 侧最大的几个） | 行（SSOT） | 去注释字节 |
| --- | --- | --- |
| `src/transport/apply.ts` | 395 | 10,318 |
| `src/transport/plan.ts` | 389 | 11,076 |
| `src/transport/routes.ts` | 370 | 9,559 |
| `src/transport/write-auth.ts` | 175 | 3,812 |
| `src/read/firewall-probe.ts` | 147 | 3,579 |
| `src/transport/audit.ts` | 155 | 4,135 |
| 50 个文件的极值 | 最大 **396**（`write-result.test.tsx`，009 面） | 最大 **17,335** |

⇒ **50/50 全部 ≤ 400 行且 ≤ 40KB**（**不拆文件、不抬阈值**）。

**导出门**：008 的 `src/transport/**` **不进包公开面**（`src/index.ts` 对 `transport` **零命中**）；本包无 `check:exports` 脚本，唯一既有导出脚本是 `wsl-shared` 的（口径 = 001 REQ-6.4）⇒ `node packages/wsl-shared/scripts/check-exports.mjs`（**exit 0**）：

```text
✓ check-exports: 运行时 8/12，类型 17，合计 25
  运行时：createExecutor, listDistros, resolveDistro, execInDistro, probeEth0, winToWsl, wslToWin, readNetworkingMode
  类型：ExecOptions, ExecResult, Executor, …（共 17 个）
```

⇒ **运行时 8/12**（预算 12，SHALL 不超）、**类型 17**、**合计 25**（软阈值 25，**不告警**）。008 侧 `src/transport/**` 自身导出面（仅备查，无预算约束）：运行时 38 / 类型 36。

## 4. T4.2 文档同步

- **链接可达**（脚本对 008 **五份** md 的本地链接逐条 `existsSync`）：**35/35 可达、0 不可达** —— 逐文件 `README.md` **7** · `tasks.md` **22** · `design.md` **1** · `requirements.md` **1** · 本文件 **4**（含本轮新增的 **2** 条指向本文件的链接：`tasks.md` 关闭块 + `README.md` 状态行 / 留痕行）；覆盖面含 README 导航、008→009 指针、`005-elevation-write-path/requirements.md`。
- **`design.md` 接口小节**：`## 10. 接口契约（Phase 0 侦察结果 · 2026-10-09 · 全部为文件:行 实证）` 在册（T0.1 的落点），另有 §11 / §13 / §14 三个接口补充节。
- **REQ-N 交叉核对**：`tasks.md` 引用 17 个 REQ 编号；**008 自身的引用 100% 存在于 [`requirements.md`](./requirements.md)**。⚠️ 两个**跨 Spec** 编号：`REQ-2.6`（2 处）/ `REQ-3.5`（1 处）是 **005 的编号**（005 `requirements.md:40` 有 `REQ-2.6` 定义；`REQ-3.5` 在 008 `tasks.md:42` 已写明「005 REQ-3.5」）⇒ **不改原文**（原文保留），以本行留痕：`REQ-2.6` 那两处未带「005」限定词，读时应按 005 的编号解。
- **`AGENTS.md` / `stack-decision*.md`**：`git diff --stat HEAD -- AGENTS.md 'stack-decision*.md'` **输出为空** ⇒ 本轮无口径 / 技术栈变更 ⇒ **无需变更**（`AGENTS.md:177` 的「拆后 008 = 356 行」是**拆分当时**的历史陈述，按留痕规矩不动历史行；现值已就地订正，见 §8）。

## 5. T4.3 依赖未增（含残留）

**基线** = `5cef12a`（`chore(008): 状态流转 planned → in-progress（CLI 写入，编码前）`）—— 008 **编码前**的最后一个提交。

```text
$ (4 个 package.json) 逐键比对 dependencies / devDependencies / peerDependencies
  package.json                            : added= removed= changed=
  packages/wsl-shared/package.json        : added= removed= changed=
  packages/terminal-profiles/package.json : added= removed= changed=
  packages/wsl-docker-ports/package.json  : added= removed= changed=
```

⇒ **新增 0 / 删除 0 / 版本变化 0**；未引 Playwright / E2E / HTTP 框架。`package.json` 唯一改动是 **003/005 轮**加的 `check:size` 脚本行（非依赖字段）：

```text
packages/wsl-docker-ports/package.json  +    "check:size": "node ../wsl-shared/scripts/check-size.mjs",
packages/terminal-profiles/package.json +    "check:size": "node ../wsl-shared/scripts/check-size.mjs"
```

**lockfile 三处逐字节相同**：`git rev-parse 5cef12a:pnpm-lock.yaml` = `git rev-parse HEAD:pnpm-lock.yaml` = `git hash-object pnpm-lock.yaml` = **`3e5453657f37de8ed342e55e493c8a1bdd2be52c`**。

⚠️ **残留（不粉饰）**：T4.3 字面第二句 `pnpm install --frozen-lockfile` exit 0 **本轮未执行** —— 本轮明令不跑 `pnpm`（`pnpm run` 会经 `verify-deps-before-run` 写回 lockfile），且并行轮正在跑测试（避免 node_modules 抢锁）。**替代取证** = 基线 / HEAD / 工作区三处 lockfile blob hash 相同 + 依赖键零变化 ⇒ 「依赖未增」在结构上成立；若主人要字面命令，可在无并行任务时补跑。

## 6. T4.4 `apply.ts` 余量

- 实测 `src/transport/apply.ts` = **395** 行（SSOT 口径）/ 400 ⇒ **余量 5**（与 `tasks.md:70` 的订正值一致；旧值 396/4 已知过期）。
- 本轮**未改**：`git rev-parse HEAD:…apply.ts` = `git hash-object …apply.ts` = **`e49f6f0ad7d41e15ea2116fd40c4032d13ff2edf`** ⇒ 「先腾出行余量」这个前置在本轮**无需触发**（没有对它加行）。
- **绑定规则（留给后续轮）**：再往 `apply.ts` 加行前，先**外移等效代码**腾余量；腾不动就按顶部行数门口径**拆 Spec / 拆文件**（400 行是 SHALL，不放宽）。

## 7. 三道门（本轮碰了 1 个测试文件 ⇒ 全跑）

| 门 | 命令（cwd = `packages/wsl-docker-ports`） | 结果 |
| --- | --- | --- |
| `tsc` | `..\..\node_modules\.bin\tsc.CMD -p tsconfig.json`（`tsc` **不在 PATH**，必须走 bin） | **exit 0** |
| `node --test` | `node --test --test-concurrency=1 "tests/unit/**/*.test.ts" "tests/contract/**/*.test.ts"` | **419 tests / 419 pass / 0 fail / exit 0**（基线 414 + 本轮 5） |
| `vitest` | `..\..\node_modules\.bin\vitest.CMD run` | **24 文件 / 125 通过 / 0 失败 / exit 0** |

⚠️ **全 glob 的假红必须说清**：`node --test "tests/**/*.test.ts"` 会连**并行轮**的 12 个 `tests/client/zz-load-*.test.ts` 一起收（它们头两行就是 `// @vitest-environment jsdom` + `import { describe, expect, it } from 'vitest'`）⇒ 该次 **431 tests / 419 pass / 12 fail**，**12 条全部是那 12 个未跟踪的探测件**，与本 Spec 无关（本轮**未提交**它们）。`vitest` 的 24 文件里同样含 13 个 `zz-*` 探测件（14 条）⇒ **扣除后 = 11 文件 / 111 条**。 🔴 **同日订正（并行轮清理后复跑，追加留痕）**：那 12 个 `zz-load-*` 探测件随后被并行轮**删除**（其提交 `4089574 test(ports): flake 定因修复 …`）⇒ 复跑：全 glob `node --test` = **419 / 419 pass / 0 fail / exit 0**，`vitest` = **11 文件 / 111 条 / exit 0**。上文 `431 / 419 / 12` 与 `24 文件 / 125 条` 是**当轮实测的历史值**（时点证据），**保留不删**。

## 8. `tasks.md` 行数自述订正 + 本轮追加后实测

`tasks.md:4` 原写「**本文件当前 374 行**、余量 **26**〔2026-10-12 关闭轮当场实测：`split('\n')` **375** / 权威口径 **374**〕」（**原文保留**）。本轮当场复算 = **381** 行（SSOT）/ `split('\n')` **382**、余量 **19** —— **旧值 374/375 是 009 关闭轮当时的实测**，其后 **7** 行证据回填未同步。
本轮追加 **9** 行（1 空行 + 8 行关闭块）后：**390** 行（SSOT）/ `split('\n')` **391**、余量 **10**（≤ 400 仍满足；**未删任何已验证结论 / 未验项 / 裁定依据 / 命令原文**）。

## 9. 未验 / 残留 / 不确定（如实）

1. **`pnpm install --frozen-lockfile` 未执行**（见 §5 残留）—— 唯一未按字面跑的判据。
2. **真机项**：本轮零真机；008 的真机证据（V1–V5）由上一轮回填（`portproxy` **19 → 20 → 19**、我方防火墙 **0 → 1 → 0**、他人规则不动、审计 **2** 条 `applied`、还原 **MAP DIFF = 0**）。仍**未验**的是 `writeToken` **未配置**时 401 fail-safe 的**真机**分支（离线有单测 `tests/unit/write-token-unset.test.ts`；真机记录随 009 的迁入记录 §5）。
3. **并行轮的干扰**是本轮唯一的环境噪声（`zz-*` 探测件让全 glob 假红、也让 `check-size` 的扩面计数 +13）。
4. **`REQ-2.6` 的跨 Spec 归属**按 005 解（§4）；若主人认为 008 也该有自己的 `REQ-2.6`，那是**新增需求**，本轮不擅自加。
