/**
 * 三包零交叉门（本包入口）—— **实现只有一份**，在 `packages/wsl-docker-core/scripts/check-borders.mjs`
 *
 * 016 之前本包（`wsl-docker-ports`）自带一份 015 语义的 `check-borders.mjs`（R1 容器侧黑名单 / R2 反向 /
 * R3 共享层白名单 / R4 公开面 / R5 模块级可变状态）—— 那时「容器侧」是**同包里的一个目录**。
 * 拆分后容器侧变成了**另一个包**，那五条判据的对象整个消失了（`src/containers/**` 已不存在），
 * 继续留着只会变成「扫 0 个文件恒真」的空门 ⇒ 016 把判据**提升**成三包级别（R1–R6，见 SSoT 文件头），
 * 本文件只做转发。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(pkgRoot, '../wsl-docker-core/scripts/check-borders.mjs');

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit', cwd: pkgRoot });
process.exit(result.status ?? 1);
