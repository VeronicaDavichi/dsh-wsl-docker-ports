/**
 * WS 相位（002 Phase 3）测试替身的**统一出口**（barrel，无实现）
 *
 * 为什么拆：单文件 ≤ 400 行是本仓 SHALL，且**含 `tests/**`**。原 `ws-fakes.ts` 574 行，按职责拆成
 * 四个文件（帧 fixture / socket 与 sink / webServer 与 ctx / SessionManager），本文件只做再导出，
 * 让各测试文件继续 `import … from '../helpers/ws-fakes.ts'` —— 边界集中在一处，改动不必散落。
 *
 * 每个替身文件的文件头都写明了「替身与被测代码必须独立实现」的理由。
 */

export * from './ws-frames-fixture.ts';
export * from './ws-socket-fakes.ts';
export * from './ws-server-fakes.ts';
export * from './ws-session-fake.ts';
