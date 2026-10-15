# DSH 工作交接（2026-10-15，agent 重装前持久化）

> 这份文件是「会话记忆的落盘副本」。重装 agent 后**先读它**，再读 `specs/011-client-bundle-split/tasks.md` 与 `specs/003-wsl-docker-ports/tasks.md` 的 2026-10-15 段落。

## 1. 仓库与环境现状

- 仓库 `E:\NodeProjects\dsh-wsl-toolkit`（git，`main`），工作树干净。
- **011-client-bundle-split = `complete`**（T0–T3 全勾，未勾项 0）：主包拆分 + 可解释降级 + T3 收口（变异哨兵 / 三绿 / 文档）全部完成。
- **003**：`stateNote` 渲染**已落地**（`types.ts` + `page.ts` + `pane-tables.tsx` + `tests/client/distro-state-note.test.tsx`，提交 `ef73656`）；**真机那一幕仍未验**（见 §3.1）。
- 最近提交（新→旧）：`ef73656` stateNote 收口 · `f9df09c` 留痕 · `7cf01e5` 003 失败类证据 · `9b8fe73` stateNote 阻塞解除 · `e05a872` 011 complete · `37dcf15` T3 收口 · `8d0a805` 撤回假警报 · `fdcd3af`/`8fdcf3c` T2.4 真机 · `68e49cf` chunk-degrade 修复。

## 2. 可复算的关键数字

- 主包 `packages/wsl-docker-ports/lib/client.js` = **44,621 B**（sha256 `0445269054CE57532014DCD947E5FB0378F9252E2B65B206D0F57DDDED98C6F5`）。
- 懒加载 chunk `lib/client.ports.js` = **110,737 B**（stateNote 渲染后；渲染前 110,498）。
- §P2 硬上限 65,536 B **未抬**（余 20,915 B）；棘轮地板 `①b` = 44,621 B（`nature: debt`，trace `#56`，只降不抬）—— stateNote 渲染落在 **chunk 侧**故地板未动。
- 门（Windows 侧、直接调 node，**不用 pnpm run**）：`node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json` exit 0 · `node scripts/assert-client-split.mjs` **17/0** · `node ..\..\node_modules\vitest\vitest.mjs run` **14 files / 128 passed** · `node --test --test-concurrency=1 "tests/**/*.test.ts"`（docker-ports）exit 0 · `node --test "tests/contract/**/*.test.ts"`（wsl-shared）exit 0 · 单文件上限 400 行（实测最大 373 行）。
- 构建：`node scripts/build-client.mjs`（另需 `tsc -p tsconfig.build.json` 与 `tsc -p tsconfig.client.json`）。

## 3. 待办（按优先级）

1. **003 真机 `stateNote` 那一幕（唯一未验尾巴）**：要「快照记 `Stopped` 而实证 `Running`」的画面 —— 冷态**不用 terminate**：WSL 空闲约 10 分钟会自然回收（已实测过一次）。流程 = 记 `docker ps -q` 清单 → 起探针实例 → 命中**读端点** → 同一响应应 `distro.state === Running` **且** `stateNote` 非 null（原文完整）→ 事后 `docker start <ids>` 拉回并核对 6 running + 端口映射。
   - 两轮没找到读端点：`src/**` 的字面量只有 `/dsh-wsl-docker-ports`、`/dsh-wsl-docker-ports//`、`/dsh-wsl-docker-ports/write` ⇒ 读端点 URL 是**拼出来的**（模板串 / 前缀常量）⇒ 下一轮**直接读** `src/client/host.ts` 与 `src/transport/**` 的取数函数，**别再用正则猜**。
2. **003 失败类接入对账口径**（登记待立项）：把 `daemon-down` / 非零退出 / 超时也算「命令被 spawn 过」的证据 ⇒ 需与 001 错误码逐个耦合，且会改动已定案的「只认成功」口径。
3. **001 TOCTOU**（`specs/001-wsl-shared/design.md:179`）待主人裁定：(a) 维持现状（窗口毫秒级、有界）· (b) 执行前再读一次状态、`Stopped` 即拒执行（≈200ms 热路径）· (c) 冷启动闸门放行路径加二次确认。
4. `{{json .}}` 观测反常**未定论**：今天经 `Start-Job` 传参两次 >45 s 无输出，而 `--format json` 正常 ⇒ 疑似观测 artifact，**未经插件真路径复核，不许据此改代码**。
5. 收尾清理已做：`~/.dsh/profiles/011-probe` 已删（junction 先 `cmd /c rmdir`）、探针实例已停、43321 已释放、home 层 `~/.dsh/cordis.patch.yml` 不存在、基线 profile 未动。

## 4. 工作配方（别重新摸索）

- **真机探针**：写 `~/.dsh/profiles/011-probe/package.json`（bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `dsh-wsl-docker-ports`；`patchReload: live`；dep `link:E:/NodeProjects/dsh-wsl-toolkit/packages/wsl-docker-ports`）+ 拷 `volatile-probe\cordis.patch.yml` + `cmd /c mklink /J` junction ⇒ `Start-Process node D:\nodejs\node_modules\@deepseek-ai\dsh\lib\bin.js --profile 011-probe --host 127.0.0.1 --port 43321 --no-open`（URL+token 在**日志尾部**、延迟数十秒）。
- **一切 `wsl` / `docker` 调用必须包** `Start-Job` + `Wait-Job -Timeout`（本机热 200ms、冷 11–12s；**唤醒后首次 `docker ps` 会被硬超时砍掉** ⇒ 硬超时 + 重试、空输出绝不当「没有容器」）。
- **零副作用的失败刺激**：daemon-down 用 `-H tcp://127.0.0.1:1`；超时用 `-H tcp://10.255.255.1:2375` + `timeout 8`（都不碰 dockerd）。
- **PowerShell 陷阱**：`rd` / `rm` 是内置别名且**优先级高于自定义函数** ⇒ 曾因此误删三个源码文件（已 git 还原）。辅助函数一律用 `Get-*` / `Set-*` 命名。
- **真机浏览器**：用 `chrome-devtools-mine` MCP（另一个 `chrome-devtools` server 起不来）。右栏按钮真名「**打开侧边栏**」；本包页项文字含「端口转发」，要点**最深**匹配节点（点外层容器会错开成「开始」页）。
- **chunk 的 `?rev=` 不随 chunk 内容变** ⇒ 换产物后必须用干净浏览器上下文（`new_page` 的 `isolatedContext`）或禁缓存，否则会执行缓存里的旧尸体（曾因此误报假缺陷，已撤回，见 011 tasks.md 第四轮）。
- 探针产物目录：`C:\Users\EDY\dsh-probe-artifacts\`（`20261014-011-t24` / `20261015-003-failclass` / `20261015-003-statenote`）。

## 5. 红线（不因重装而变）

- **绝不**把插件装进 `desktop` / `web`；探针只用临时/一次性 profile。
- 仓库内**不跑** `pnpm run` / `pnpm install`；`tsc` 与两套测试**必须 Windows 侧**跑（WSL 缺 `@typescript/typescript-linux-x64`）。
- 删含 junction 的目录**只允许** `cmd /c rmdir`；**绝不**创建 home 层 `~/.dsh/cordis.patch.yml`。
- 汇报「已完成」必须附真实执行日志 + diff + exit 0；**红即整批回滚**、不夹带半成品。
- 只做要求内的改动；额外发现**只登记**，不擅自扩大范围。
- 真机实验涉及用户环境（停发行版/容器）**必须先问**；做完**必须**按记录清单全量拉回并核对。
