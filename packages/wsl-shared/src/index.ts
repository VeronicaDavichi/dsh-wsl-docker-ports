/**
 * `dsh-wsl-shared` 公开面（**预算：≤ 12 个导出符号**，由 `scripts/check-exports.mjs` 自检）。
 *
 * 本包是**非插件包**：无 `cordis.patch.yml`、无配置页、无 PTY、不注册任何宿主能力。
 * 消费者：`dsh-terminal-profiles`（002/004）与 `dsh-wsl-docker-ports`（003/005）。
 *
 * ⚠️ 当前只有 **Phase 0（T0.1/T0.2）** 落地的发行版表解析；eth0 / 路径翻译 / NAT 判定 / 执行器
 * 按 `specs/001-wsl-shared/tasks.md` 的 T2.x 逐条补齐。
 */

export {
  decodeWslOutput,
  parseDistroList,
  WslParseError,
  type WslDistro,
  type WslDistroState,
  type WslVersion,
} from './distros.ts';
