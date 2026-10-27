/**
 * 容器页的**运行时契约**（015 `P4`；纯类型 ⇒ 编译后完全擦除，不产生任何 import 边）
 *
 * 主包（`index.ts`）造出这个对象并塞进 chunk 的 props；chunk 侧只认这个形状。
 * 这样做的两个好处：
 *
 * 1. **主包不长肉**：HTTP 细节、渲染、日志抽屉全在 chunk 里，主包只传 4 个能力；
 * 2. **判定边界清楚**：容器页能做的事 = 这 5 个字段，没有第五条暗路。
 */

import type { FetchLike } from '../../wire.ts';
import type { SettingsPipe } from '../settings-pipe.ts';

export interface ContainersRuntime {
  /** 同源基址（默认 `''`；末尾斜杠由取数面去掉） */
  readonly baseUrl: string;
  /** 注入 fetch（测试/集成方）；缺省用全局 `fetch` */
  readonly fetchImpl?: FetchLike | undefined;
  /** 容器通道凭据（**每次现取**：页内换了凭据，下一次动作就用新的） */
  readonly token: () => string | undefined;
  /** 保存容器通道凭据（写 sessionStorage 的容器侧键；空串 = 清除） */
  readonly saveToken: (value: string) => void;
  /**
   * 容器侧命名空间的 settings 管道（**主包用同一个 `createSettingsPipe` 造的第二实例**）。
   * 缺省/未到位 ⇒ 页内刷新频次退回默认 30s，配置页显示「设置服务不可用」。
   */
  readonly settings: () => SettingsPipe | undefined;
}
