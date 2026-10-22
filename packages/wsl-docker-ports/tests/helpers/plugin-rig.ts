/**
 * `plugin-entry.test.ts` / `plugin-write-route.test.ts` 的**公共装配台架**
 * （2026-10-12 009 收口轮 T5 拆出；拆前 `plugin-entry.test.ts` `split('\n')` = **461**，超 SHALL 400）
 *
 * 台架**原样搬出**（一个字没改口径）：假宿主 ctx（`provide` / `effect` 可选）+ 只路由外部命令的执行器
 * （真 fixture 文本，**零真进程**）。「零真实进程」不是靠自律：本台架只注入 fake 执行器。
 *
 * 🔴 本文件不含 `test()` ⇒ 不是测试文件（`node --test` 只收 `*.test.ts`）⇒ **用例数不因拆文件而变**
 *（拆前 16 → 拆后 14 + 2 = 16，逐条名字不变）。
 */

import type { PluginContextLike } from '../../src/plugin.ts';
import { createFakeExecutor, failure, fixtureBytes, ok } from './fake-executor.ts';

const WSL_LIST = '  NAME            STATE           VERSION\n* Ubuntu2204    Running         2\n  Debian        Stopped         2\n';
const ETH0_TEXT = '2: eth0    inet 172.20.201.152/20 brd 172.20.207.255 scope global eth0\\       valid_lft forever preferred_lft forever\n';
/** 008 T2.6 的防火墙规则名现读：本机已有 5900 那条（**只读探针的假应答**，不跑真 PowerShell） */
const FIREWALL_NAMES = 'dsh-wsl-docker-ports-5900\r\n';

export function readFixture(name: string): string {
  return Buffer.from(fixtureBytes(name)).toString('utf8');
}

/** 一个「什么都答得上来」的 fake 执行器：按命令行分流（**不跑任何真进程**） */
export function routingExecutor(): ReturnType<typeof createFakeExecutor> {
  return createFakeExecutor((call) => {
    const line = [call.file, ...call.argv].join(' ');
    if (line.startsWith('wsl.exe -l -v')) return ok(WSL_LIST);
    // ⚠️ 顺序要紧：防火墙探针的命令行里含 `dsh-wsl-docker-ports`（**含 `docker` 子串**）⇒ 必须先判 powershell
    if (line.startsWith('powershell.exe') && line.includes('Get-NetFirewallRule')) return ok(FIREWALL_NAMES);
    // 012：候选监听地址（真机 fixture；过滤后只剩 192.168.31.129）
    if (line.startsWith('powershell.exe') && line.includes('Get-NetIPAddress')) return ok(readFixture('get-netipaddress.raw'));
    if (line.includes('show v4tov4')) return ok(readFixture('netsh-portproxy-v4tov4.raw'));
    if (line.includes('docker')) return ok(readFixture('docker-ps.redacted.jsonl'));
    if (line.includes('addr show dev eth0')) return ok(ETH0_TEXT);
    return failure('Unexpected', { stderr: `未预期的命令：${line}` });
  });
}

export interface FakeCtx {
  readonly ctx: PluginContextLike;
  readonly provided: { name: string; value: unknown }[];
  readonly effects: (() => void)[];
}

export function fakeCtx(withProvide = true, withEffect = true): FakeCtx {
  const provided: { name: string; value: unknown }[] = [];
  const effects: (() => void)[] = [];
  const ctx: PluginContextLike = {
    ...(withProvide ? { provide: (serviceName: string, value: unknown) => { provided.push({ name: serviceName, value }); return undefined; } } : {}),
    ...(withEffect
      ? {
          effect: (callback: () => (() => void) | void) => {
            const disposer = callback();
            if (typeof disposer === 'function') effects.push(disposer);
            return undefined;
          },
        }
      : {}),
  };
  return { ctx, provided, effects };
}
