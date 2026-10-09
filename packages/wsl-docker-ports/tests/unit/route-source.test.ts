/**
 * T6.8 客户端**路由来源**（`node --test`，零真机、零真实网络）
 *
 * 判据：
 * ① **URL 字面量**：`GET /dsh-wsl-docker-ports/snapshot?…`，且声明经 `wire.ts` 的编码器拼出
 *    （与宿主的解码器同源 ⇒ 不可能两侧漂移）；
 * ② **成功路径**：`{ok:true,snapshot}` ⇒ 原样交出快照（不加工、不丢字段）；
 * ③ **失败路径**：`{ok:false,error}` ⇒ **抛**带码错误（**不伪造空快照**）；
 * ④ **零写操作 + 构造期零请求**：造来源时不发请求；`readDeclaration` 只在 `load()` 里被调用。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouteSource, EMPTY_DECLARATION, buildSnapshotUrl, parseSnapshotResponse } from '../../src/client/route-source.ts';
import type { FetchLike, PortsSnapshot } from '../../src/wire.ts';
import type { SnapshotDeclaration } from '../../src/wire.ts';
import { snapshot } from './client-fixtures.ts';

interface Call {
  readonly url: string;
  readonly init: { readonly method?: string; readonly cache?: string; readonly headers?: Readonly<Record<string, string>> } | undefined;
}

function fakeFetch(responses: { status: number; payload: unknown }[]): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)] ?? { status: 500, payload: null };
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () => Promise.resolve(next.payload),
    });
  };
  return { fetchImpl, calls };
}

const DECLARATION: SnapshotDeclaration = { managedPorts: ['3306', '8080'], scopes: { 3306: 'lan' }, elevationPolicy: 'ask' };

test('T6.8 ① URL 字面量：路径 + 查询串都来自传输契约', () => {
  const url = buildSnapshotUrl('', DECLARATION, false);
  assert.equal(url, '/dsh-wsl-docker-ports/snapshot?managedPorts=3306&managedPorts=8080&scope=3306%3Alan&elevationPolicy=ask');
  assert.equal(buildSnapshotUrl('', EMPTY_DECLARATION, false), '/dsh-wsl-docker-ports/snapshot', '全默认 ⇒ 不带查询串');
  assert.equal(buildSnapshotUrl('', EMPTY_DECLARATION, true), '/dsh-wsl-docker-ports/snapshot?allowColdStart=1');
  assert.equal(buildSnapshotUrl('/prefix', EMPTY_DECLARATION, true), '/prefix/dsh-wsl-docker-ports/snapshot?allowColdStart=1', '基址可注入（同源缺省 = 空串）');
  console.log(`  · 扫了 4 个 URL：${url}`);
});

test('T6.8 ④ 构造期零请求：`load()` 之前一个请求都不发，`readDeclaration` 也不调', async () => {
  const fake = fakeFetch([{ status: 200, payload: { ok: true, snapshot: snapshot({}) } }]);
  let declared = 0;
  const source = createRouteSource({
    fetchImpl: fake.fetchImpl,
    readDeclaration: () => {
      declared += 1;
      return Promise.resolve(EMPTY_DECLARATION);
    },
  });
  assert.equal(fake.calls.length, 0, '构造期不得发请求');
  assert.equal(declared, 0, '构造期不得读配置');
  await source.load();
  assert.equal(fake.calls.length, 1);
  assert.equal(declared, 1);
  console.log(`  · 构造扫了 ${String(fake.calls.length)} 个请求 / ${String(declared)} 次配置读（要求 0）；load 后 1/1`);
});

test('T6.8 ② 成功路径：快照原样交出（含 `diff` 失败态与外部规则）', async () => {
  const expected = snapshot({});
  const fake = fakeFetch([{ status: 200, payload: { ok: true, snapshot: expected } }]);
  const source = createRouteSource({ fetchImpl: fake.fetchImpl, readDeclaration: () => Promise.resolve(DECLARATION) });
  const loaded = await source.load();
  assert.deepEqual(loaded, expected, '不得加工/丢字段（快照就是渲染输入）');
  assert.equal(fake.calls[0]?.init?.method, 'GET');
  assert.equal(fake.calls[0]?.init?.cache, 'no-store', '快照必须现读（不许缓存住上一次的事实）');
  assert.equal(fake.calls[0]?.url.includes('managedPorts=3306'), true, '声明必须进查询串（宿主侧没有 settings 存储）');
  console.log(`  · 扫了 1 个请求：${String(fake.calls[0]?.url)}（method=${String(fake.calls[0]?.init?.method)} cache=${String(fake.calls[0]?.init?.cache)}）`);
});

test('T6.8 ③ 失败路径：路由级错误 ⇒ 抛带码错误，绝不伪造空快照', async () => {
  const cases = [
    { status: 503, payload: { ok: false, error: { code: 'rules-unavailable', message: '读不到 portproxy 规则' } }, expect: 'rules-unavailable' },
    { status: 500, payload: { ok: false, error: { code: 'internal', message: '炸了' } }, expect: 'internal' },
    { status: 404, payload: { ok: false, error: { code: 'not-found', message: '未知路径' } }, expect: 'not-found' },
    { status: 502, payload: '<html>网关</html>', expect: 'http-502' },
  ];
  let scanned = 0;
  for (const item of cases) {
    const fake = fakeFetch([{ status: item.status, payload: item.payload }]);
    const source = createRouteSource({ fetchImpl: fake.fetchImpl });
    await assert.rejects(
      () => source.load(),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.startsWith(`${item.expect}:`), true, `期望以 \`${item.expect}:\` 开头，实际 ${JSON.stringify(message)}`);
        return true;
      },
    );
    scanned += 1;
  }
  console.log(`  · 扫了 ${String(scanned)} 个失败响应（503/500/404/非 JSON 502），全部抛错且带码`);
});

test('T6.8 ③ `parseSnapshotResponse` 直接判据：正常态返回快照，畸形体抛错', () => {
  const expected = snapshot({});
  assert.deepEqual(parseSnapshotResponse(200, { ok: true, snapshot: expected }), expected);
  assert.throws(() => parseSnapshotResponse(200, null), /http-200/u);
  assert.throws(() => parseSnapshotResponse(200, { ok: true }), /http-200/u, '`ok:true` 但没有 snapshot ⇒ 不能当成成功');
  assert.throws(() => parseSnapshotResponse(503, { ok: false, error: { code: 'rules-unavailable', message: 'x' } }), /rules-unavailable: x/u);
  console.log('  · 扫了 4 个响应体（2 正常 / 2 畸形），口径 = 「成功必须带 snapshot，失败必须带 error」');
});

test('T6.8 ④ 端点不可达（fetch 拒绝）时如实抛错，绝不静默返回空快照', async () => {
  const boom: FetchLike = () => Promise.reject(new Error('Failed to fetch'));
  const source = createRouteSource({ fetchImpl: boom });
  await assert.rejects(() => source.load(), /Failed to fetch/u);
  const missing = createRouteSource({ fetchImpl: undefined });
  // 本环境有全局 fetch ⇒ 相对 URL 会被运行时报 `Failed to parse URL`；关键是**必须抛**，而不是给出假快照
  await assert.rejects(() => missing.load(), (error: unknown) => error instanceof Error);
  console.log('  · 扫了 2 种不可达（注入拒绝 + 无端点），两条路径都抛错、都不返回空快照');
});

test('T6.8 注入面最小：`PortsSource` 只要求 `load()`（NFR-2：不引入任何写动作）', () => {
  const source = createRouteSource({ fetchImpl: fakeFetch([]).fetchImpl });
  assert.deepEqual(Object.keys(source), ['load'], '来源只能有 load（多一个方法就多一处写风险）');
  console.log(`  · 扫了来源的 ${String(Object.keys(source).length)} 个成员：${JSON.stringify(Object.keys(source))}`);
});

/** 类型面：客户端来源必须满足宿主侧 `PortsSource` 的形状（两边都从 `wire.ts` 取 `PortsSnapshot`） */
const _typeCheck: (options?: { readonly allowColdStart?: boolean }) => Promise<PortsSnapshot> = createRouteSource({ fetchImpl: fakeFetch([]).fetchImpl }).load;
void _typeCheck;
