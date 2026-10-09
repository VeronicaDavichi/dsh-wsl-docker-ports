/**
 * 常见服务端口 presets（003 T3.5 / REQ-16.4）
 *
 * ## 这是**声明数据**，不是逻辑
 *
 * REQ-16.4：首批 **13 项**，且「清单 SHALL 可配置扩展，**SHALL NOT 硬编码进逻辑分支**」。
 * 所以这里只有「一张表 + 一个纯查表函数」：要加一项就加一行数据，**任何 `if (name === 'mysql')`
 * 形态的分支都不许出现**（那正是把数据写进逻辑，加一项就得改代码 + 补测试）。
 *
 * ## 为什么这里一行 import、一句副作用都没有
 *
 * presets 只是「勾一下就把端口写进 `managedPorts`」的**候选值**：REQ-16.4 明文
 * 「勾选 SHALL NOT 触发写操作或提权」—— 不许联网、不许提权、不许碰文件系统。
 * 最省事的守法方式是让它**结构上做不到**：本文件无 import、无顶层调用、无 `process` / `fetch`。
 * 这条不是靠自觉，`tests/unit/managed-ports-parse.test.ts` 有一条静态用例扫源码钉死它。
 *
 * ## 与 `managedPorts` 的关系
 *
 * presets **不是另一套存储**（REQ-16.4「结果直接写入 `managedPorts`，不另建存储」）：
 * 勾选 = 把 `port` 追加进声明数组，之后走 `parseManagedPorts`（同一套区间语义），
 * 故「区间与 presets 声明同一组端口语义」天然成立。
 */

/** 一项 preset：`name` 是机器可判的稳定 id（配置/测试用），`label` 是给人看的中文名 */
export interface PortPreset {
  readonly name: string;
  readonly label: string;
  readonly port: number;
}

/**
 * 首批 13 项（REQ-16.4 逐条对应，顺序即 UI 推荐顺序）。
 *
 * ⚠️ **不含** SQL Server `1433` —— 主人未选（REQ-16.4 明文）；改这张表 = 改需求，不是改代码。
 * 后两项（Vite `5173` / Flask `5000`）是**框架默认端口**，与中间件的默认端口同列。
 */
export const PORT_PRESETS: readonly PortPreset[] = [
  { name: 'mysql', label: 'MySQL 数据库', port: 3306 },
  { name: 'oracle', label: 'Oracle 数据库', port: 1521 },
  { name: 'spring-boot', label: 'Spring Boot 应用', port: 8080 },
  { name: 'postgresql', label: 'PostgreSQL 数据库', port: 5432 },
  { name: 'redis', label: 'Redis 缓存', port: 6379 },
  { name: 'mongodb', label: 'MongoDB 数据库', port: 27017 },
  { name: 'rabbitmq', label: 'RabbitMQ 消息队列', port: 5672 },
  { name: 'kafka', label: 'Kafka 消息队列', port: 9092 },
  { name: 'elasticsearch', label: 'Elasticsearch 搜索引擎', port: 9200 },
  { name: 'nacos', label: 'Nacos 注册配置中心', port: 8848 },
  { name: 'minio', label: 'MinIO 对象存储', port: 9000 },
  { name: 'vite', label: 'Vite 开发服务器', port: 5173 },
  { name: 'flask', label: 'Flask 开发服务器', port: 5000 },
];

/**
 * `name` → 端口（纯查表，无副作用）。
 *
 * 精确匹配 `name`（机器 id，不是界面上的 `label`）：大小写与别名不属于数据层的事，
 * UI 要做模糊匹配就在 UI 层做，别让「查得到的键」变成一处需要猜的口径。
 * 未收录 ⇒ `undefined`（调用方自己决定怎么提示，这里不抛错 —— 查表函数不该有失败态）。
 */
export function portOf(name: string): number | undefined {
  return PORT_PRESETS.find((preset) => preset.name === name)?.port;
}
