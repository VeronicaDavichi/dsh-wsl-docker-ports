/**
 * 017 六订·十二：**容器行配置页**的版本样式（与转发侧配置页同一套类名与尺寸）。
 *
 * 为什么单独一个文件、而不是塞进主包的 `styles.ts`：主包有棘轮地板
 * （`main-bundle-budgets.mjs` 的 `dsh-wsl-docker-containers` = **31,324 B**，只降不升），
 * 这 16 条规则实测 +2,878 B 会顶穿地板；配置页本体本来就在 chunk 里
 * （`lib/client.containers.js`）⇒ 样式跟着它走，挂载时注入、卸载时移除。
 *
 * 值逐条抄转发侧 `CONFIG_CSS`（宿主 token 真名 + 同尺寸），**零 hex**。
 */

export const CONFIG_STYLE_ID = 'dsh-wsl-docker-containers/row-config';

export const CONFIG_CSS = `/* ── 017 六订·十二：本行配置页与转发侧配置页**同一套版式**（主人：「剩下的东西保持css和其他的一致」）
   field/label/input/btn/hint 逐条抄转发侧 CONFIG_CSS 的值（宿主 token 真名 + 同尺寸），**零 hex**）。 */
.wdp-cfg { display: flex; flex-direction: column; color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 1.5; }
.wdp-cfg-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.wdp-cfg-field + .wdp-cfg-field { border-top: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-cfg-label { font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.wdp-cfg-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); overflow-wrap: anywhere; }
.wdp-cfg-notice { margin: 0; padding: 6px 10px; border: 0.5px solid var(--dsw-alias-state-error-primary, currentColor); border-radius: var(--dsw-radius-sm, 6px); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary, inherit); overflow-wrap: anywhere; }
.wdp-cfg-input { appearance: none; box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l4, currentColor); border-radius: var(--dsw-radius-md, 8px); background-color: var(--dsw-alias-bg-layer-3, transparent); font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
select.wdp-cfg-input { padding-right: 32px; background-image: linear-gradient(45deg, transparent 50%, var(--dsw-alias-label-tertiary, currentColor) 50%), linear-gradient(135deg, var(--dsw-alias-label-tertiary, currentColor) 50%, transparent 50%); background-position: calc(100% - 17px) 15px, calc(100% - 12px) 15px; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.wdp-cfg-field-actions { display: flex; align-items: center; gap: 8px; }
.wdp-cfg-btn { appearance: none; align-self: flex-start; box-sizing: border-box; height: 34px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l4, currentColor); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-3, transparent); font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); cursor: pointer; }
.wdp-cfg-btn:hover:not([disabled]) { border-color: var(--dsw-alias-border-l2, currentColor); }
.wdp-cfg-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, currentColor)); outline-offset: 1px; }
.wdp-cfg-btn[disabled] { opacity: 0.4; cursor: default; }`;

/** 挂载时注入、返回移除器；同一个 id 的旧节点先摘掉（重复挂载不产生第二份） */
export function installConfigStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const selector = `style[data-plugin="${CONFIG_STYLE_ID}"]`;
  document.querySelector(selector)?.remove();
  const style = document.createElement('style');
  style.dataset['plugin'] = CONFIG_STYLE_ID;
  style.textContent = CONFIG_CSS;
  document.head.append(style);
  let removed2 = false;
  return () => {
    if (removed2) return;
    removed2 = true;
    style.remove();
  };
}
