/**
 * 插件配置 schema 的**声明面**（REQ-1.1 字段口径 · REQ-1.2 逐条容错 · REQ-2.1 的 volatile 红线）
 *
 * ## 为什么 `z` 是**注入**的，而不是 `import Schema from 'schemastery'`
 *
 * ① 本包硬约束是**零运行时依赖**（只有 `node:` 内置 + `dsh-wsl-shared`）；
 * ② schemastery 是**宿主提供**的实现（cordis 读插件模块的静态 `Config` 导出），本机不在本 workspace
 *    的 `node_modules` 里（`stack-decision.md` 的环境事实）⇒ import 它既违反①、也**离线无法验证**。
 * 故本文件只声明**本包用到的那点结构面**；Phase 6（T6.1）的静态导出就是一行包装：
 * `export const Config = createProfilesSchema(Schema)`。
 *
 * ## 🔴 为什么条目**故意不做类型校验**（元素是 `z.any()`，不是 `z.object({ … })`）
 *
 * schemastery 是按**整个 `profiles` 数组**校验的：元素里一个类型错就会让**整数组**失败。而 REQ-1.2
 * 要的恰恰相反 —— 「单条坏 ⇒ 只跳过该条，其余照常可用，SHALL NOT 让整个 profile 启动失败」；
 * `stack-decision.md` 的冲突自检表也写着「schema 校验失败不得弄坏整个 profile 启动 ⇒ 必须有默认值
 * 与容错」。⇒ schema 层只保留**存活必需**的那件事（`profiles` 整体标 volatile），**逐条判定全部**
 * 归 `./profiles.ts` 的 `parseProfiles`：单一判定层，不会两处口径打架。
 *
 * ⚠️ **代价与待拍板项**：元素端因此拿不到 schemastery 的字段元数据。本包配置页是**自绘**的
 * （`configure({ auto: false })`，REQ-10.1）⇒ 不需要它；但将来若要走宿主**自动表单**，
 * 元素就得换回 `z.object({ … })` —— 那会**同时**牺牲 REQ-1.2 的逐条容错，除非 T0.2 证实
 * 宿主「校验失败」是非致命静默回落（届时两者可兼得）。
 *
 * ## 🔴 两条**硬边界**（宿主源码实证，见 `stack-decision.md` 的 `plugin.profileConfigLiveness`）
 *
 * ① `profiles` 必须**整数组**标 `.volatile()` —— 标进**数组元素内**会被 `validateVolatileSchema`
 *    在 parse 时拦下并抛错（volatile 只在**固定对象路径**生效）；
 * ② schema **必须**是 Schemastery —— `isSchemastery()` 判的是 `schema['~standard'].vendor`，
 *    换 Zod 之类会让 volatile **静默失效** ⇒ 每次保存都重挂载、**把正在跑的终端全杀掉**。
 */

/** schemastery schema 的最小结构面：**只列本包用到的方法**（不 import 实现，见文件头） */
export interface SchemaLike {
  /** 标 volatile 后返回同一类型的 schema（它只改 `meta.volatile`） */
  volatile(): SchemaLike;
}

/** schemastery 工厂的最小结构面（宿主注入；本包不 import 实现） */
export interface SchemaFactory {
  /** 宽松谓词：元素交给 `parseProfiles` 判定，schema 层不拦（见文件头「为什么故意不做类型校验」） */
  any(): SchemaLike;
  array(inner: SchemaLike): SchemaLike;
  object(shape: Record<string, SchemaLike>): SchemaLike;
}

/**
 * 字段清单（REQ-1.1 的 6 个字段）：**给穷尽性测试与 UI 用**，不是 schema 声明的一部分。
 * 字段口径的唯一判定者是 `parseProfiles`；`tests/unit/profiles.test.ts` 用
 * `Record<ProfileFieldKey, unknown>` 逐个喂错误类型 ⇒ 漏一个字段就编译不过（防漂移靠它，不靠 schema）。
 */
export const PROFILE_FIELD_KEYS = ['name', 'command', 'args', 'env', 'cwd', 'cwdLinux'] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/**
 * 构造本包的配置 schema（外壳：`{ profiles: Profile[] }`，整数组 volatile）。
 *
 * `name` / `command` 必填、`args` 缺省 `[]`、`env` 缺省 `{}`、`cwd` / `cwdLinux` 可选（REQ-1.1）
 * 这些**全部由 `parseProfiles` 判定与补齐**；这里只负责让配置活下来并保住 volatile 语义。
 */
export function createProfilesSchema(z: SchemaFactory): SchemaLike {
  // 🔴 `.volatile()` 只在这一处、只作用于**数组节点**（元素内标会抛 ValidationError，见文件头）
  return z.object({ profiles: z.array(z.any()).volatile() });
}
