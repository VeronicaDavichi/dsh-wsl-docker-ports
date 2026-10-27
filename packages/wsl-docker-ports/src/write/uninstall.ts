/**
 * 卸载钩子与显式清理入口（005 T3.3 / REQ-5.1 ~ REQ-5.4）
 *
 * ## 本文件最重要的一件事：dispose 与 runExplicitCleanup 的**分界**
 *
 * - `dispose()` = **卸载**语义（REQ-5.1 + REQ-5.3）：只清**临时文件**，对写通道（执行器）
 *   **零调用**。规则是用户可感知的系统状态，卸载时一删就可能静默断掉用户的服务（A-2 定案）。
 * - `runExplicitCleanup()` = **用户显式清理**语义（REQ-5.4，需提权）：走注入的写通道，
 *   且只删 `isDeletableRule` 认下的规则（复用 REQ-1.2，与清单同源）。
 *
 * ⚠️ 这两件事**永不互相挂载**：`dispose()` 里出现任何一次写调用 = 直接违反 REQ-5.1。
 * 想「顺手帮用户清掉」的改动，请改 REQ-5.1 而不是改这里。
 *
 * ## 崩溃残留的扫描口径
 *
 * 只删**与 `elevate/script.ts` 命名口径逐字一致**的两类产物（`<TEMP_PREFIX>-<rand>.ps1` /
 * `<TEMP_PREFIX>-<rand>-out.json`）—— runner 的成功 / 失败 / 超时三条路径没来得及删的正是这两类，
 * 也是「崩溃残留」的全部形态。同前缀但形状不符的文件**只报告不删**（宁可留一个垃圾文件，
 * 也不误删用户的同名文件）。`remaining` 用**二次扫描**得出，不靠本地账自证。
 *
 * 依赖一律注入（规则事实 / 写通道 / 临时目录 / 文件操作），**总是**返回结果对象、不抛异常
 * —— 与 `elevate/runner.ts` 的既有风格一致。
 */

import { readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ManagedPorts } from '../diff/managed-ports.ts';
import { TEMP_PREFIX } from '../elevate/script.ts';
import type { PortproxyRule } from 'dsh-wsl-docker-core';
import { buildCleanupManifest, buildCleanupSteps, type CleanupManifest } from './cleanup.ts';
import type { WriteStep } from './types.ts';

export interface UninstallFacts {
  readonly rules: readonly PortproxyRule[];
  readonly managedPorts: ManagedPorts;
  readonly expectedConnectAddress: string | null;
}

/** 文件操作注入面（生产默认 = `node:fs/promises`） */
export interface CleanupFs {
  readonly listDir: (dir: string) => Promise<readonly string[]>;
  readonly removeFile: (path: string) => Promise<void>;
}

/** 写通道 = 本模块眼中的**执行器**（生产上接提权 runner）：`dispose()` 永不调用它 */
export type WriteChannel = (steps: readonly WriteStep[]) => Promise<EnforceOutcome>;

export interface EnforceOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export interface TempFileReport {
  readonly dir: string;
  /** 首扫看到的目录项数（不是产物数） */
  readonly scanned: number;
  readonly removed: readonly string[];
  readonly removedCount: number;
  readonly failed: readonly string[];
  /** 同前缀但形状不符：只报告不删 */
  readonly skipped: readonly string[];
  /** 二次扫描后的产物残留数（REQ-5.3 的「归零」判据） */
  readonly remaining: number;
  readonly dirError: string | null;
}

export interface UninstallReport {
  readonly cleanup: TempFileReport;
  readonly manifest: CleanupManifest;
  /** 恒为 `false`：REQ-5.1 的机器可判形态（类型层就写死，不是运行时才知道） */
  readonly systemStateTouched: false;
  readonly message: string;
}

export type ExplicitCleanupStatus = 'enforced' | 'enforce-failed' | 'nothing-to-do';

export interface ExplicitCleanupReport {
  readonly status: ExplicitCleanupStatus;
  readonly steps: readonly WriteStep[];
  readonly message: string;
  readonly outcome: EnforceOutcome | null;
}

export interface UninstallHook {
  /** UI 展示用：只读清单（不发任何写调用） */
  readonly describeManifest: () => Promise<CleanupManifest>;
  readonly dispose: () => Promise<UninstallReport>;
  readonly runExplicitCleanup: () => Promise<ExplicitCleanupReport>;
}

export interface UninstallDeps {
  /** 规则事实（读侧给）。抛错**不**向上传播：降级成空清单 + 说明，临时文件照清 */
  readonly facts: () => Promise<UninstallFacts> | UninstallFacts;
  readonly writeChannel: WriteChannel;
  readonly tempDir?: string | undefined;
  readonly cleanupFs?: CleanupFs | undefined;
}

/** 与 `elevate/script.ts` 的 `assertTempPaths` 逐字同源的形状（脚本产物 / 输出产物） */
const SCRIPT_ARTIFACT = new RegExp(`^${TEMP_PREFIX}-[0-9a-f]{8,}\\.ps1$`, 'i');
const OUT_ARTIFACT = new RegExp(`^${TEMP_PREFIX}-[0-9a-f]{8,}-out\\.json$`, 'i');
const PREFIX_ONLY = new RegExp(`^${TEMP_PREFIX}-`, 'i');

const NODE_FS: CleanupFs = {
  listDir: (dir) => readdir(dir),
  removeFile: async (path) => {
    await unlink(path);
  },
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isArtifact(name: string): boolean {
  return SCRIPT_ARTIFACT.test(name) || OUT_ARTIFACT.test(name);
}

/** REQ-5.3：扫临时目录 → 删本插件产物 → **二次扫描**证明残留为 0。任何一步失败都不抛 */
async function cleanTempFiles(fsOps: CleanupFs, dir: string): Promise<TempFileReport> {
  let names: readonly string[];
  try {
    names = await fsOps.listDir(dir);
  } catch (error) {
    return {
      dir,
      scanned: 0,
      removed: [],
      removedCount: 0,
      failed: [],
      skipped: [],
      remaining: 0,
      dirError: messageOf(error),
    };
  }
  const targets = names.filter(isArtifact);
  const skipped = names.filter((name) => !isArtifact(name) && PREFIX_ONLY.test(name));
  const removed: string[] = [];
  const failed: string[] = [];
  for (const name of targets) {
    const path = join(dir, name);
    try {
      await fsOps.removeFile(path);
      removed.push(path);
    } catch {
      failed.push(path);
    }
  }
  // 二次扫描：残留数不靠「删了几个」推算，而是重新看一眼目录（删失败/并发新增都能抓到）
  let remaining = targets.length - removed.length;
  try {
    remaining = (await fsOps.listDir(dir)).filter(isArtifact).length;
  } catch {
    // 二次扫描失败 ⇒ 保留上面的本地账，并在 failed 里不追加（dirError 已表达过目录读不了）
  }
  return {
    dir,
    scanned: names.length,
    removed,
    removedCount: removed.length,
    failed,
    skipped,
    remaining,
    dirError: null,
  };
}

export function createUninstallHook(deps: UninstallDeps): UninstallHook {
  const tempDir = deps.tempDir ?? tmpdir();
  const fsOps = deps.cleanupFs ?? NODE_FS;

  async function manifestOf(): Promise<CleanupManifest> {
    let facts: UninstallFacts;
    try {
      facts = await deps.facts();
    } catch (error) {
      return buildCleanupManifest({
        rules: [],
        managedPorts: [],
        expectedConnectAddress: null,
        emptyReason: `读取规则事实失败（${messageOf(error)}）：清单为空，请人工核对系统规则后再清理`,
      });
    }
    return buildCleanupManifest({
      rules: facts.rules,
      managedPorts: facts.managedPorts,
      expectedConnectAddress: facts.expectedConnectAddress,
    });
  }

  return {
    describeManifest: manifestOf,

    /** REQ-5.1 + REQ-5.3：零写调用 + 临时文件归零。可重复调用（幂等：第二次删 0 个） */
    async dispose(): Promise<UninstallReport> {
      const manifest = await manifestOf();
      const cleanup = await cleanTempFiles(fsOps, tempDir);
      return {
        cleanup,
        manifest,
        systemStateTouched: false,
        message:
          `卸载：未改动任何系统规则（REQ-5.1，写调用 0 次）；临时文件删除 ${String(cleanup.removedCount)} 个 / ` +
          `残留 ${String(cleanup.remaining)} 个（REQ-5.3）；本插件维护的规则 ${String(manifest.items.length)} 条已列入清单（REQ-5.2）`,
      };
    },

    /** REQ-5.4：用户显式清理（需提权）。**只**删 REQ-1.2 认下的规则 */
    async runExplicitCleanup(): Promise<ExplicitCleanupReport> {
      let steps: readonly WriteStep[];
      try {
        const facts = await deps.facts();
        steps = buildCleanupSteps({
          rules: facts.rules,
          managedPorts: facts.managedPorts,
          expectedConnectAddress: facts.expectedConnectAddress,
        });
      } catch (error) {
        return {
          status: 'enforce-failed',
          steps: [],
          message: `读取规则事实失败（${messageOf(error)}）：一个动作都不产生（宁可不做，也不误删）`,
          outcome: null,
        };
      }
      if (steps.length === 0) {
        return {
          status: 'nothing-to-do',
          steps: [],
          message: '没有本插件维护的规则（REQ-1.2 谓词无命中）：零动作，他人的规则一条都不碰',
          outcome: null,
        };
      }
      try {
        const outcome = await deps.writeChannel(steps);
        return {
          status: outcome.ok ? 'enforced' : 'enforce-failed',
          steps,
          message: outcome.message,
          outcome,
        };
      } catch (error) {
        return {
          status: 'enforce-failed',
          steps,
          message: `清理执行过程中出现意外错误：${messageOf(error)}；请人工核对系统规则`,
          outcome: null,
        };
      }
    },
  };
}
