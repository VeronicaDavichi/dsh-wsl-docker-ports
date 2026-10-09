/**
 * T2.2 退出码映射 + 回传解析 + steps 可展示（design §4 的表）
 *
 * 验收条件：
 * - 退出码 `0/2/3/1` 四种映射逐条对上（外加 REQ-3.4 的 `999`）
 * - out 文件解析健壮：夹带其它输出、BOM、非 JSON 都要给出**可区分**的结果
 * - 失败时 steps 必须能逐条展示（UI 不许只显示「失败」两个字）
 * - **不做**「非 0 的成功」这种解释
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyExit,
  displayableSteps,
  ELEVATE_EXIT,
  parseElevatedOut,
  payloadPortMismatch,
} from '../../src/elevate/outcome.ts';
import { okPayload, partialPayload } from '../helpers/fake-elevation.ts';

test('T2.2 退出码表：0 成功 / 2 部分失败 / 3 前置不满足 / 1 异常 / 999 提权失败', () => {
  const ok = parseElevatedOut(JSON.stringify(okPayload(5000)));
  assert.equal(ok.ok, true);
  const payload = ok.ok ? ok.payload : null;

  assert.equal(classifyExit(ELEVATE_EXIT.ok, payload).status, 'ok');
  assert.equal(classifyExit(ELEVATE_EXIT.partial, payload).status, 'partial');
  assert.equal(classifyExit(ELEVATE_EXIT.precondition, payload).status, 'precondition');
  assert.equal(classifyExit(ELEVATE_EXIT.exception, payload).status, 'failure');
  assert.equal(classifyExit(ELEVATE_EXIT.elevationFailed, payload).status, 'elevation-failed');

  assert.deepEqual(ELEVATE_EXIT, { ok: 0, exception: 1, partial: 2, precondition: 3, elevationFailed: 999 });
  assert.match(classifyExit(999, null).message, /gsudo 退出码 999/);
});

test('T2.2 退出码 2 时 steps 可逐条展示，且 hint 直接点出失败步骤', () => {
  const parsed = parseElevatedOut(JSON.stringify(partialPayload(5000, 'firewall-add', 'Access is denied')));
  assert.equal(parsed.ok, true);
  const payload = parsed.ok ? parsed.payload : null;

  const steps = displayableSteps(payload);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((step) => `${step.name}:${String(step.ok)}`),
    ['portproxy-add:true', 'firewall-add:false'],
  );

  const classified = classifyExit(ELEVATE_EXIT.partial, payload);
  assert.equal(classified.status, 'partial');
  assert.match(classified.message, /1 个步骤失败/);
  assert.match(classified.hint, /firewall-add（Access is denied）/);
});

test('T2.2 退出码 0 但回传标记 ok=false ⇒ 按失败处理（不许「非 0 的成功」）', () => {
  const parsed = parseElevatedOut(JSON.stringify(partialPayload(5000, 'portproxy-add', 'boom')));
  const payload = parsed.ok ? parsed.payload : null;
  const classified = classifyExit(0, payload);

  assert.equal(classified.status, 'failure');
  assert.match(classified.message, /以回传为准按失败处理/);
  assert.match(classified.hint, /展开 steps/);
});

test('T2.2 未知退出码与 null 退出码都按失败处理，但文案必须可区分', () => {
  const unknown = classifyExit(42, null);
  const missing = classifyExit(null, null);

  assert.equal(unknown.status, 'failure');
  assert.equal(missing.status, 'failure');
  assert.match(unknown.message, /未知退出码 42/);
  assert.match(missing.message, /没有拿到退出码/);
  assert.notEqual(unknown.message, missing.message);
});

test('T2.2 out 文件「读不到」与「读到了不是 JSON」是两种事实', () => {
  const missing = parseElevatedOut(null);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok ? '' : missing.reason, 'out-file-missing');

  const garbage = parseElevatedOut('Access is denied.\r\n');
  assert.equal(garbage.ok, false);
  assert.equal(garbage.ok ? '' : garbage.reason, 'out-file-unparsable');
  assert.match(garbage.ok ? '' : garbage.raw, /Access is denied/);
});

test('T2.2 解析健壮：stdout 里夹带告警行 / BOM / 末尾空白都能捞出 JSON', () => {
  const good = JSON.stringify(okPayload(5000));
  const noisy = `\uFEFFWARNING: something\r\n${good}\r\n`;

  const parsed = parseElevatedOut(noisy);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok ? parsed.payload.port : 0, 5000);
  assert.equal(parsed.ok ? parsed.payload.ok : false, true);
});

test('T2.2 解析拒收形状不对的 JSON（缺 port / steps），不猜', () => {
  const parsed = parseElevatedOut('{"ok":true,"action":"add"}');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ok ? '' : parsed.reason, 'out-file-unparsable');
});

test('T2.2 回传声明的端口与请求不一致 ⇒ 明确报出（防陈旧 out 文件/串话）', () => {
  const parsed = parseElevatedOut(JSON.stringify(okPayload(5001)));
  const payload = parsed.ok ? parsed.payload : null;

  assert.equal(payloadPortMismatch(payload, 5000), '回传 JSON 声明的端口是 5001，与请求的 5000 不一致');
  assert.equal(payloadPortMismatch(payload, 5001), null);
  assert.equal(payloadPortMismatch(null, 5000), null);
});

test('T2.2 成功路径的 steps 也完整保留（半成品防护要能逐条看到做了哪几步）', () => {
  const parsed = parseElevatedOut(
    JSON.stringify(okPayload(5000, 'add', [
      { name: 'portproxy-clean-other-scope', ok: true },
      { name: 'portproxy-add', ok: true },
      { name: 'firewall-add', ok: true },
    ])),
  );
  const payload = parsed.ok ? parsed.payload : null;

  assert.deepEqual(
    displayableSteps(payload).map((step) => step.name),
    ['portproxy-clean-other-scope', 'portproxy-add', 'firewall-add'],
  );
  assert.equal(classifyExit(0, payload).status, 'ok');
});
