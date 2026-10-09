/**
 * 008 写入通道的对外常量（T1.1）
 *
 * ## 前缀为什么不带尾斜杠（🔴 本项目已踩过一次的静默缺陷）
 *
 * 宿主的分派判据是 `pathname !== prefix && !pathname.startsWith(`${prefix}/`)` ⇒ **带尾斜杠时
 * 路由注册成功但永不被分派**（真机实证 2026-10-09：宿主兜底 404、零报错、插件面板还显示「运行中」）。
 * `tests/unit/transport-routes.test.ts` 用字面量断言 + 宿主判据的逐字复刻把这条钉死。
 *
 * ## 为什么嵌在 003 的前缀之下
 *
 * 宿主匹配顺序是 **exact → 最长 prefix → fallback** ⇒ 更长的前缀优先命中本通道，003 的
 * `/dsh-wsl-docker-ports/snapshot` 处理器**看不到**本通道的路径 ⇒ 零改 003 代码（design §2）。
 */

/** 写入通道的独占前缀（**不带尾斜杠**） */
export const WRITE_HTTP_PREFIX = '/dsh-wsl-docker-ports/write';

/** `POST`：只读地算动作计划（零副作用，REQ-2） */
export const WRITE_PLAN_PATH = `${WRITE_HTTP_PREFIX}/plan`;
/** `POST`：执行（需 `planId` + `confirmed`，REQ-3/4） */
export const WRITE_APPLY_PATH = `${WRITE_HTTP_PREFIX}/apply`;
/** `GET`：审计尾部（只读，REQ-5） */
export const WRITE_AUDIT_PATH = `${WRITE_HTTP_PREFIX}/audit`;

export const WRITE_PLAN_METHOD = 'POST';
export const WRITE_APPLY_METHOD = 'POST';
export const WRITE_AUDIT_METHOD = 'GET';

/** 请求体上限（字节）：写请求只带声明式目标，超过即视为畸形（T2.2） */
export const WRITE_BODY_MAX_BYTES = 64 * 1024;

/** 确认票据 TTL（ms）：一次性 + 绑定 `planId`（T2.1） */
export const WRITE_CONFIRM_TTL_MS = 120_000;
