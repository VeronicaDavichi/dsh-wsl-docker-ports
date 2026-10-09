/**
 * T4.2 客户端**构建产物**装载自检（`scripts/verify-client-loader.mjs` 的用例化复用）
 *
 * 为什么还要在 vitest 里再跑一遍：`check:client` 是**独立脚本**（可能没人跑），而这条把同一套判据
 * 拉进 `pnpm test` 的**必经路径**；同时反向钉住「自检脚本本身没有变成空转」——
 * 判据条数、反控条数、名字唯一性、度量值（字节数 / require 面 / 折叠路径 / effect 次数）逐项断言。
 *
 * ⚠️ 产物需要先 `pnpm build`；没有产物时用 `it.runIf` **跳过并显示原因**（不是静默通过）。
 */

import { describe, expect, it } from 'vitest';

import {
  BASELINE_MODULES,
  CHUNK_FILE,
  CHUNK_REQUEST,
  MAIN_BUNDLE_FILE,
  PLUGIN_ID,
  verifyClientLoader,
} from '../../scripts/verify-client-loader.mjs';

const report = verifyClientLoader();
const built = typeof report.reason !== 'string';
const measurements = report.measurements;

describe('T4.2 客户端产物装载自检', () => {
  it.runIf(!built)('产物缺失 ⇒ 明确报出原因（不静默通过）', () => {
    expect(typeof report.reason).toBe('string');
    expect(String(report.reason)).toContain('build');
  });

  it.runIf(built)('全部判据通过，且判据条数 / 反控条数达标（防「门瞎了还报绿」）', () => {
    expect(report.failures.map((failure) => `${failure.name} :: ${failure.detail}`)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkCount).toBe(report.checks.length);
    expect(report.checkCount).toBeGreaterThanOrEqual(50);
    const canaries = report.checks.filter((check) => check.name.startsWith('canary:'));
    expect(canaries).toHaveLength(4);
    expect(canaries.every((check) => check.ok)).toBe(true);
  });

  it.runIf(built)('判据名字唯一（重复名会让「哪条红了」失去意义）', () => {
    const names = report.checks.map((check) => check.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.runIf(built)('产物文件名与体量：主产物 client.js、chunk 大两个数量级', () => {
    expect(MAIN_BUNDLE_FILE).toBe('client.js');
    expect(CHUNK_FILE).toBe('client.terminal.js');
    expect(measurements.mainBytes).toBeGreaterThan(2000);
    expect(measurements.chunkBytes).toBeGreaterThan(100_000);
    expect(measurements.mainBytes * 10).toBeLessThan(measurements.chunkBytes);
  });

  it.runIf(built)('require 面 = 官方基线（react 家族），零 react-dom、零幽灵声明', () => {
    expect(measurements.mainRequires).toEqual(['react', 'react/jsx-runtime']);
    expect(measurements.chunkRequires).toEqual(['react', 'react/jsx-runtime']);
    expect(measurements.declaredExternal).toEqual([]);
    for (const specifier of [...(measurements.mainRequires ?? []), ...(measurements.chunkRequires ?? [])]) {
      expect([...BASELINE_MODULES]).toContain(specifier);
    }
  });

  it.runIf(built)('取块实参走常量折叠，解析值 = 兄弟文件名（§P3）', () => {
    expect(measurements.mainAsyncRequests).toEqual([`CHUNK_REQUEST → ${JSON.stringify(CHUNK_REQUEST)}`]);
  });

  it.runIf(built)('行为面度量：材质化零 async 调用 / 零 DOM 访问；apply 后 5 次 effect + 3 个 seat', () => {
    expect(measurements.asyncCallsDuringMaterialization).toBe(0);
    /**
     * 两个数分开断言（不是放宽断言）：材质化期间必须是 **0**（判据）；
     * `apply` 期间 4 次是**预期内**的 DOM 访问 —— `resolveDocument` + `querySelector` + `createElement`
     * + `head.append`，逐一对得上「注入样式」这一个动作；计数是累计的，所以两个数都要有名字。
     *
     * ⚠️ 2026-10-09 Phase 6（T6.1）起 `apply` 多一次 `ctx.effect`（配置页）与一个 `plugins.row.config` 槽位
     * ⇒ effect 4 → 5、seat 2 → 3；**不是放松断言**，而是把新动作也钉住（配置页那次挂在 effect 上，
     * 卸载时必须跟着撤）。
     */
    expect(measurements.documentAccessesDuringMaterialization).toBe(0);
    expect(measurements.documentAccessesAfterApply).toBe(4);
    expect(measurements.effectsDuringApply).toBe(5);
    expect(measurements.seatsRegistered).toBe(3);
  });

  it.runIf(built)('插件 id 与包名一致（宿主按行 id 找产物）', () => {
    expect(PLUGIN_ID).toBe('dsh-terminal-profiles');
  });
});
