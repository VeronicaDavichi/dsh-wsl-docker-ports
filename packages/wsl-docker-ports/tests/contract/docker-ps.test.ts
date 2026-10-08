/**
 * 真机 fixture 冒烟（003 T0.1 验收）
 *
 * 这份 fixture 是**脱敏**后的真机输出（6 个容器；容器名/镜像/挂载/标签已替换，
 * 但 `Ports` 列**原样保留** —— 它才是解析器要吃的字段）。
 * 见 `fixtures/README.md` 的脱敏策略与泄漏扫描记录。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DockerParseError, parseDockerPorts, parseDockerPsJsonl } from '../../src/read/docker.ts';

const text = readFileSync(new URL('./fixtures/docker-ps.redacted.jsonl', import.meta.url), 'utf8');

test('T0.1 真机 fixture：解析出 6 个容器且必备字段齐全', () => {
  const containers = parseDockerPsJsonl(text);
  assert.equal(containers.length, 6);
  for (const container of containers) {
    assert.ok(container.id.length > 0, 'id 非空');
    assert.ok(container.names.length > 0, 'names 非空');
    assert.ok(container.image.length > 0, 'image 非空');
    assert.ok(container.state.length > 0, 'state 非空');
    assert.ok(container.status.length > 0, 'status 非空');
  }
});

test('T0.1 真机形态：IPv4 + IPv6 双份映射（同容器同端口）', () => {
  const containers = parseDockerPsJsonl(text);
  const redis = containers.find((container) =>
    container.ports.some((port) => port.containerPort === 6379),
  );
  if (redis === undefined) {
    throw new Error('fixture 里应有映射 6379 的容器');
  }

  const on6379 = redis.ports.filter((port) => port.containerPort === 6379);
  assert.equal(on6379.length, 2, 'IPv4(`0.0.0.0`) 与 IPv6(`[::]`) 各一条');
  assert.deepEqual(
    on6379.map((port) => [port.hostIp, port.hostPort, port.protocol]),
    [
      ['0.0.0.0', 6379, 'tcp'],
      ['[::]', 6379, 'tcp'],
    ],
  );
});

test('T0.1 真机形态：端口区间 `5002-5003->5002-5003/tcp`', () => {
  const containers = parseDockerPsJsonl(text);
  const ranged = containers
    .flatMap((container) => container.ports)
    .filter((port) => port.hostPortEnd !== null);
  assert.equal(ranged.length, 2, 'IPv4 + IPv6 各一条区间映射');
  for (const port of ranged) {
    assert.deepEqual(
      [port.hostPort, port.hostPortEnd, port.containerPort, port.containerPortEnd],
      [5002, 5003, 5002, 5003],
    );
  }
});

test('T0.1 真机形态：多段映射（一个容器 4 条）与「未发布端口」两种边界', () => {
  const containers = parseDockerPsJsonl(text);

  const multi = containers.find((container) =>
    container.ports.some((port) => port.containerPort === 50051),
  );
  if (multi === undefined) {
    throw new Error('fixture 里应有映射 50051 的容器');
  }
  assert.equal(multi.ports.length, 4, '8080 + 50051 各 IPv4/IPv6 两条');

  const none = containers.filter((container) => container.ports.length === 0);
  assert.equal(none.length, 1, '恰有 1 个容器未发布任何端口（`Ports` 为空串）');
});

test('T0.1 单元：未发布端口的写法 `8080/tcp` → hostIp/hostPort 为 null', () => {
  assert.deepEqual(parseDockerPorts('8080/tcp'), [
    {
      hostIp: null,
      hostPort: null,
      hostPortEnd: null,
      containerPort: 8080,
      containerPortEnd: null,
      protocol: 'tcp',
    },
  ]);
  assert.deepEqual(parseDockerPorts(''), []);
});

test('T0.1 异常：脏输入必须抛错（不静默跳过，否则 UI 会少显示容器却毫无提示）', () => {
  assert.throws(() => parseDockerPsJsonl('{不是 JSON}\n'), DockerParseError);
  assert.throws(() => parseDockerPsJsonl('{"ID":"a"}\n'), DockerParseError);
  assert.throws(() => parseDockerPorts('0.0.0.0:8080->80'), DockerParseError);
  assert.throws(() => parseDockerPorts('0.0.0.0:70000->80/tcp'), DockerParseError);
  assert.throws(() => parseDockerPorts('0.0.0.0:5003-5002->5003/tcp'), DockerParseError);
});
