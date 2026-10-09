/**
 * T1.1 配置模型与逐条容错（REQ-1.1 / REQ-1.2 / REQ-1.3）
 *
 * 每个 `it` 的名字都带 REQ 号：验收方法是「有效项、缺 command、类型错、重名、空数组、全无效；
 * 断言无效项**未**影响其余项」，下面逐条对应（正常 / 边界 / 异常三类都有）。
 */

import { describe, expect, it } from 'vitest';

import { ROOT_INDEX, isStartable, isWslProfile, parseProfiles } from '../../src/config/profiles.ts';
import type { ProfileFieldKey } from '../../src/config/schema.ts';

/** 逐字段的「错误类型」样本：`Record<ProfileFieldKey, …>` ⇒ 少一个字段就编译不过（防漏测） */
const WRONG_TYPE: Readonly<Record<ProfileFieldKey, unknown>> = {
  name: 42,
  command: {},
  args: 'ls -la',
  env: ['A=1'],
  cwd: 7,
  cwdLinux: true,
};

describe('T1.1 parseProfiles —— 正常路径（REQ-1.1）', () => {
  it('REQ-1.1 完整条目逐字段保留，且保持输入顺序', () => {
    const result = parseProfiles([
      {
        name: 'dev',
        command: 'pwsh.exe',
        args: ['-NoLogo'],
        env: { TERM: 'xterm-256color' },
        cwd: 'E:\\proj',
        cwdLinux: '/mnt/e/proj',
      },
      { name: 'ops', command: 'pwsh.exe' },
    ]);

    expect(result.diagnostics).toStrictEqual([]);
    expect(result.profiles.map((p) => p.name)).toStrictEqual(['dev', 'ops']);
    expect(result.profiles[0]).toStrictEqual({
      name: 'dev',
      command: 'pwsh.exe',
      args: ['-NoLogo'],
      env: { TERM: 'xterm-256color' },
      cwd: 'E:\\proj',
      cwdLinux: '/mnt/e/proj',
    });
  });

  it('REQ-1.1 只填必填项 ⇒ args 缺省 []、env 缺省 {}、无 needsFix', () => {
    const result = parseProfiles([{ name: 'ops', command: 'pwsh.exe' }]);
    // toStrictEqual：`undefined` 属性也算差异 ⇒ 顺带钉死「不伪造可选字段」
    expect(result.profiles[0]).toStrictEqual({ name: 'ops', command: 'pwsh.exe', args: [], env: {} });
    expect(result.profiles[0]?.needsFix).toBeUndefined();
  });

  it('REQ-1.1 name/command 首尾空白被 trim；args 与 env 的值原样保留（不进 shell 切词、不 trim）', () => {
    const result = parseProfiles([
      { name: '  dev  ', command: ' pwsh.exe ', args: ['  -NoLogo  '], env: { '  K  ': '  V  ' } },
    ]);
    expect(result.profiles[0]).toStrictEqual({
      name: 'dev',
      command: 'pwsh.exe',
      args: ['  -NoLogo  '],
      env: { '  K  ': '  V  ' },
    });
  });
});

describe('T1.1 parseProfiles —— 逐条容错（REQ-1.2）', () => {
  it('REQ-1.2 一条无效 ⇒ 只跳过它自己，其余项**未**受影响', () => {
    const result = parseProfiles([
      { name: 'a', command: 'pwsh.exe' },
      { name: 'bad' },
      { name: 'c', command: 'pwsh.exe' },
    ]);

    expect(result.profiles.map((p) => p.name)).toStrictEqual(['a', 'c']);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      index: 1,
      kind: 'MissingField',
      field: 'command',
      skipped: true,
    });
  });

  it('REQ-1.2 边界：空数组 ⇒ 0 条 profile + 0 条诊断（不报错）', () => {
    expect(parseProfiles([])).toStrictEqual({ profiles: [], diagnostics: [] });
  });

  it('REQ-1.2 边界：profiles 整键缺失（undefined）⇒ 等同空配置，且**不**当作类型错', () => {
    expect(parseProfiles(undefined)).toStrictEqual({ profiles: [], diagnostics: [] });
  });

  it('REQ-1.2 异常：缺 command ⇒ MissingField（field=command、skipped=true）', () => {
    const result = parseProfiles([{ name: 'a' }]);
    expect(result.profiles).toStrictEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ kind: 'MissingField', field: 'command', skipped: true });
  });

  it('REQ-1.2 异常：name 为空白串 ⇒ 等同缺失（MissingField，而不是 TypeMismatch）', () => {
    const result = parseProfiles([{ name: '   ', command: 'pwsh.exe' }]);
    expect(result.diagnostics[0]).toMatchObject({ kind: 'MissingField', field: 'name', skipped: true });
  });

  it('REQ-1.2 异常：条目不是对象（null / 数字 / 字符串 / 数组 / 布尔）⇒ 一律 TypeMismatch', () => {
    for (const bad of [null, 42, 'x', [], true]) {
      const result = parseProfiles([bad]);
      expect(result.profiles).toStrictEqual([]);
      expect(result.diagnostics[0]).toMatchObject({ kind: 'TypeMismatch', skipped: true });
      expect(result.diagnostics[0]?.field).toBeUndefined();
    }
  });

  it('REQ-1.2 异常：profiles 本身不是数组 ⇒ 根诊断（index=ROOT_INDEX），不抛错', () => {
    const result = parseProfiles({ name: 'a' });
    expect(result.profiles).toStrictEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      index: ROOT_INDEX,
      kind: 'TypeMismatch',
      field: 'profiles',
      skipped: true,
    });
  });

  it('REQ-1.2 异常：忘了 .get()（volatile 解析结果是带 .get() 的对象）⇒ 根诊断带 .get() 提示', () => {
    const volatileLike = { get: () => [{ name: 'a', command: 'pwsh.exe' }] };
    const result = parseProfiles(volatileLike);
    expect(result.diagnostics[0]?.kind).toBe('TypeMismatch');
    expect(result.diagnostics[0]?.message).toContain('.get()');
    // null 不是「忘了 .get()」，不该带该提示
    expect(parseProfiles(null).diagnostics[0]?.message).not.toContain('.get()');
  });
});

describe('T1.1 parseProfiles —— 类型错（REQ-1.1）', () => {
  it('REQ-1.1 异常：逐字段类型错都报 TypeMismatch，且 field 指向该字段（6 个字段无遗漏）', () => {
    for (const [field, bad] of Object.entries(WRONG_TYPE)) {
      const result = parseProfiles([{ name: 'ok', command: 'pwsh.exe', [field]: bad }]);
      expect(result.profiles).toStrictEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ kind: 'TypeMismatch', field, skipped: true });
    }
  });

  it('REQ-1.1 异常：env 传数组 / args 传对象都不算「空」⇒ TypeMismatch（不静默取默认值）', () => {
    expect(parseProfiles([{ name: 'a', command: 'c', env: [] }]).diagnostics[0]).toMatchObject({
      kind: 'TypeMismatch',
      field: 'env',
    });
    expect(parseProfiles([{ name: 'a', command: 'c', args: {} }]).diagnostics[0]).toMatchObject({
      kind: 'TypeMismatch',
      field: 'args',
    });
  });

  it('REQ-1.1 异常：args 元素 / env 值类型错 ⇒ 消息定位到具体下标与键', () => {
    const badArgs = parseProfiles([{ name: 'a', command: 'c', args: ['ok', 5] }]);
    expect(badArgs.diagnostics[0]).toMatchObject({ kind: 'TypeMismatch', field: 'args' });
    expect(badArgs.diagnostics[0]?.message).toContain('args[1]');

    const badEnv = parseProfiles([{ name: 'a', command: 'c', env: { A: 1 } }]);
    expect(badEnv.diagnostics[0]).toMatchObject({ kind: 'TypeMismatch', field: 'env' });
    expect(badEnv.diagnostics[0]?.message).toContain('env.A');
  });

  it('REQ-1.1 边界：可选字段显式 undefined / 纯空白 ⇒ 视为未填（不落进结果）', () => {
    const result = parseProfiles([{ name: 'a', command: 'c', cwd: undefined, cwdLinux: '   ' }]);
    expect(result.profiles[0]).toStrictEqual({ name: 'a', command: 'c', args: [], env: {} });
  });

  it('REQ-1.1 边界：未知字段被忽略（不拒绝整条、也不带进结果）', () => {
    const result = parseProfiles([{ name: 'a', command: 'c', bogus: 1 }]);
    expect(result.diagnostics).toStrictEqual([]);
    expect(Object.keys(result.profiles[0] ?? {})).toStrictEqual(['name', 'command', 'args', 'env']);
  });

  it('REQ-1.3 边界：回显进消息的用户输入被「可见化 + 限长」（ESC 不注入、超长不撑爆 UI）', () => {
    // 名字里塞 ANSI 转义 + 超长内容：走重名路径（该路径会把 name 回显进 message）
    const dirty = `\u001b[31m${'x'.repeat(200)}`;
    const result = parseProfiles([
      { name: dirty, command: 'c1' },
      { name: dirty, command: 'c2' },
    ]);
    const message = result.diagnostics[0]?.message ?? '';
    expect(message).not.toContain('\u001b');
    expect(message).toContain('\\u001b');
    expect(message).toContain(`共 ${dirty.length} 字符`);
    expect(message.length).toBeLessThan(200);
  });
});

describe('T1.1 parseProfiles —— 重名拒绝（REQ-1.3）', () => {
  it('REQ-1.3 异常：重名 ⇒ 拒绝后者、conflictWith 指向先出现者，先出现者**不**被静默覆盖', () => {
    const result = parseProfiles([
      { name: 'dev', command: 'pwsh.exe', cwd: 'E:\\a' },
      { name: 'dev', command: 'wsl.exe', cwd: 'E:\\b' },
    ]);

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toStrictEqual({
      name: 'dev',
      command: 'pwsh.exe',
      args: [],
      env: {},
      cwd: 'E:\\a',
    });
    expect(result.diagnostics).toStrictEqual([
      {
        index: 1,
        kind: 'DuplicateName',
        message: expect.stringContaining('与第 1 条重名'),
        field: 'name',
        skipped: true,
        conflictWith: 0,
      },
    ]);
  });

  it('REQ-1.3 边界：三条同名 ⇒ 只保留第一条，后两条各带一条诊断', () => {
    const result = parseProfiles([
      { name: 'x', command: 'c1' },
      { name: 'x', command: 'c2' },
      { name: 'x', command: 'c3' },
    ]);
    expect(result.profiles.map((p) => p.command)).toStrictEqual(['c1']);
    expect(result.diagnostics.map((d) => d.conflictWith)).toStrictEqual([0, 0]);
    expect(result.diagnostics.every((d) => d.index > 0)).toBe(true);
  });

  it('REQ-1.3 边界：trim 后同名也算重名（name 已归一化）', () => {
    const result = parseProfiles([
      { name: 'dev', command: 'c1' },
      { name: '  dev  ', command: 'c2' },
    ]);
    expect(result.profiles).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ kind: 'DuplicateName', skipped: true });
  });
});

describe('T1.2 isWslProfile —— WSL profile 判定（REQ-3.2 的「command 为 wsl.exe」）', () => {
  it('wsl.exe / WSL.EXE / wsl / 带路径 都算 WSL profile', () => {
    expect(isWslProfile('wsl.exe')).toBe(true);
    expect(isWslProfile('WSL.EXE')).toBe(true);
    expect(isWslProfile('wsl')).toBe(true);
    expect(isWslProfile('C:\\Windows\\System32\\wsl.exe')).toBe(true);
  });

  it('边界：pwsh.exe / wslconfig.exe / mywsl.exe / 空串 都不算（不做前缀或子串匹配）', () => {
    expect(isWslProfile('pwsh.exe')).toBe(false);
    expect(isWslProfile('wslconfig.exe')).toBe(false);
    expect(isWslProfile('mywsl.exe')).toBe(false);
    expect(isWslProfile('')).toBe(false);
  });
});

describe('T1.1 isStartable —— 可启动判定（REQ-1.4 的消费者）', () => {
  it('无 needsFix ⇒ 可启动', () => {
    const result = parseProfiles([{ name: 'a', command: 'pwsh.exe' }]);
    expect(result.profiles.map(isStartable)).toStrictEqual([true]);
  });
});
