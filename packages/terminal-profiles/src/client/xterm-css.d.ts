/**
 * 无类型声明的 CSS 文本 import（`@xterm/xterm/css/xterm.css`）。
 *
 * 这个文件**故意不是模块**（没有 import/export）⇒ 其中的 `declare module` 是**全局环境声明**，
 * 而不是「模块增强」（后者要求目标模块已存在，对 CSS 路径会报 *Invalid module name in augmentation*）。
 *
 * 打包侧配套：`scripts/build-client.mjs` 对 chunk 设 `loader: { '.css': 'text' }` ⇒ CSS 以**字符串**
 * 内联进 chunk（官方终端页的 chunk 里就是 `.xterm{…}` 字符串 + `createElement("style")`，见
 * `client-contract.md` §P2 的逐字证据）。
 */
declare module '@xterm/xterm/css/xterm.css' {
  const css: string;
  export default css;
}
