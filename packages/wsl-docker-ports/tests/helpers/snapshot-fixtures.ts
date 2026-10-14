/**
 * T6.8 宿主快照的**离线 fixture 底座**（真 fixture 的字节 + 分流 fake 执行器）
 *
 * 与 `tests/unit/plugin-entry.test.ts` 里那份是同一套口径（真 `netsh` 19 条规则 +
 * 真 `docker ps` 6 容器 + 假 `.wslconfig`），独立成文件是为了让「装配」与「路由」两组判据
 * 共用同一批事实 —— 否则两组测试的 fixture 会各自漂移，「同一份快照」就无从对账。
 */

import { createFakeExecutor, failure, fixtureBytes, ok } from './fake-executor.ts';

export const WSL_LIST = '  NAME            STATE           VERSION\n* Ubuntu2204    Running         2\n  Debian        Stopped         2\n';
/**
 * **冷启动场景**的 `wsl -l -v`（003 缺陷修复的输入）：一次性快照把目标发行版记成 `Stopped`，
 * 而随后 `allowColdStart: true` 的发行版内读取**真的会把它冷启动起来** ⇒ 同一响应的两半矛盾。
 * `Debian` 保持 `Stopped` 用来钉「只更正有证据的那一条，不许整列一起改」。
 */
export const WSL_LIST_STOPPED = '  NAME            STATE           VERSION\n* Ubuntu2204    Stopped         2\n  Debian        Stopped         2\n';
export const ETH0_TEXT = '2: eth0    inet 172.20.201.152/20 brd 172.20.207.255 scope global eth0\n';
/** 假 `.wslconfig` 路径与内容（`localhostForwarding=true` ⇒ loopback 不需要显式规则） */
export const WSL_CONFIG = 'X:\\fake\\.wslconfig';
export const WSL_CONFIG_TEXT = '[wsl2]\nlocalhostForwarding=true\n';

/** 真 fixture 的 19 个端口（**逐个列出**，不从被测代码里取 —— 否则判据恒真） */
export const FIXTURE_PORTS = ['80', '443', '3000', '3128', '5000', '5001', '5002', '5003', '5173', '5432', '6379', '8080', '8194', '9000', '9001', '18080', '30808', '38080', '50051'] as const;

export function readFixture(name: string): string {
  return Buffer.from(fixtureBytes(name)).toString('utf8');
}

export interface FixtureFailureOverrides {
  /** `false` = 让 eth0 探测失败（构造 `diff.ok:false` 的 T5.4 分支） */
  readonly eth0?: boolean;
  readonly docker?: boolean;
  readonly netsh?: boolean;
  /**
   * `wsl -l -v` 一次性快照里目标发行版的状态（缺省 `Running`）。
   * `'Stopped'` = 造冷启动场景（见 `WSL_LIST_STOPPED`）。
   * ⚠️ 这只改**快照**：发行版内命令真被执行与否由 **001 的闸门**（`execInDistro`）决定 ——
   * 本 fake 不模拟闸门（`probeDockerPs` / `probeEth0` 内部走的是生产代码）。
   */
  readonly wslState?: 'Running' | 'Stopped';
}

/** 分流 fake：按命令行回真 fixture 的字节（**不跑任何真进程**） */
export function routingExecutor(overrides: FixtureFailureOverrides = {}): ReturnType<typeof createFakeExecutor> {
  return createFakeExecutor((call) => {
    const line = [call.file, ...call.argv].join(' ');
    if (line.startsWith('wsl.exe -l -v')) return ok(overrides.wslState === 'Stopped' ? WSL_LIST_STOPPED : WSL_LIST);
    if (line.includes('show v4tov4')) {
      return overrides.netsh === false
        ? failure('NonZeroExit', { exitCode: 1, stderr: 'password=hunter2 请求的操作需要提升' })
        : ok(readFixture('netsh-portproxy-v4tov4.raw'));
    }
    if (line.includes('docker')) {
      return overrides.docker === false
        ? failure('NonZeroExit', { exitCode: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' })
        : ok(readFixture('docker-ps.redacted.jsonl'));
    }
    if (line.includes('addr show dev eth0')) return overrides.eth0 === false ? failure('NonZeroExit', { exitCode: 1, stderr: 'eth0 未就绪' }) : ok(ETH0_TEXT);
    return failure('Unexpected', { stderr: `未预期的命令：${line}` });
  });
}
