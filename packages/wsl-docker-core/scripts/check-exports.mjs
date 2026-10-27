/**
 * 导出预算门（本包入口）—— **实现只有一份**
 *
 * 判定逻辑与逐包预算表都在 `packages/wsl-shared/scripts/`（`check-exports.mjs` + `export-budgets.mjs`），
 * 016 只是给每个包留一个**同名入口**，避免「从哪个目录跑」变成两套口径。
 *
 * 为什么这里不再抄一份：003 时代 `wsl-docker-ports` 抄过一份本包副本门，文件头明写「没有把门扩到别的包」，
 * 结果三处判据各自漂移。016 起统一 —— 本文件**只做转发**，任何判据改动都必须落在 SSoT 上。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(pkgRoot, '../wsl-shared/scripts/check-exports.mjs');

const result = spawnSync(process.execPath, [target], { stdio: 'inherit', cwd: pkgRoot });
process.exit(result.status ?? 1);
