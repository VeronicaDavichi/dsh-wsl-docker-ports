/**
 * 011 `T2.4`（`REQ-BS-5`）：异步取块失败 ⇒ **可解释降级**（原因分类 + 原文 + 可重试 + Console 明确错误）。
 *
 * 🔴 为什么住**主包**：失败的那一半**正是 chunk** ⇒ 降级面放进 chunk 就是「一起失败」。
 * 于是这里的每个字节都吃主包预算（产物不压缩、注释也计字节）⇒ 深水区理由写在
 * `tests/client/chunk-degrade.test.tsx` 与 `specs/011-client-bundle-split/design.md`。
 */
import { createElement, useEffect, useState, type ComponentType, type ReactElement } from 'react';

export type ChunkFailureReason = 'offline' | 'not-deployed' | 'unreachable' | 'init-failed' | 'unknown';

export interface ChunkFailure {
  readonly reason: ChunkFailureReason;
  readonly label: string;
  readonly hint: string;
  readonly detail: string;
}

/** chunk 侧导出的**最小**契约（真正的 props 契约在 `pane.tsx`） */
export interface ChunkSeatModule {
  readonly PortsPane: ComponentType<Record<string, unknown>>;
}

export const CHUNK_DEGRADE_TESTID = {
  panel: 'chunk-degrade-panel',
  label: 'chunk-degrade-label',
  hint: 'chunk-degrade-hint',
  detail: 'chunk-degrade-detail',
  retry: 'btn-chunk-degrade-retry',
} as const;

const LABEL: Record<ChunkFailureReason, string> = {
  offline: '离线：界面资源无法下载',
  'not-deployed': '界面资源不存在（404）',
  unreachable: '界面资源下载失败（网络 / 代理）',
  'init-failed': '界面资源已下载但初始化失败',
  unknown: '界面资源取块失败（未归类）',
};

const HINT: Record<ChunkFailureReason, string> = {
  offline: '当前处于离线状态。恢复网络后点「重试」即可（不需要重载插件行）。',
  'not-deployed': '界面资源没部署到宿主能服务的位置（构建 / 安装不完整）⇒ 点「重试」重发请求；仍失败请重装本插件。',
  unreachable: '请求没到达宿主（网络中断 / 代理拦截 / 跨域）⇒ 点「重试」重发一次。',
  'init-failed': '资源已下载但执行期抛错（版本不匹配或内部错误）；原文见详情与 Console。这是本插件缺陷，请连详情一并上报。',
  unknown: '未归类的取块失败（原文见详情与 Console）⇒ 点「重试」重发一次。',
};

/** 本包名（= `/plugins/` 路由里那一段；与 `index.ts` 的 `name` 同值） */
const PACKAGE_NAME = 'dsh-wsl-docker-ports';

/**
 * chunk URL = 主包 URL 同目录换名（保 `?rev=`）；**批次 URL**（宿主把多个主包合成一条脚本 URL，
 * 真机实测形态 `…/plugins/??a/client.js,b/client.js&rev=X`）⇒ 用本包那一段拼成独立路径
 * `…/plugins/<pkg>/<chunk>?rev=X`（rev 取批次那条，只作**回落**探测）。
 */
export function deriveChunkUrl(mainUrl: string, chunkName: string): string {
  const batch = mainUrl.indexOf('/??');
  if (batch >= 0) {
    const rev = mainUrl.indexOf('rev=');
    return `${mainUrl.slice(0, batch + 1)}${PACKAGE_NAME}/${chunkName}${rev < 0 ? '' : `?${mainUrl.slice(rev)}`}`;
  }
  const q = mainUrl.indexOf('?');
  const path = q < 0 ? mainUrl : mainUrl.slice(0, q);
  const cut = path.lastIndexOf('/');
  return (cut < 0 ? '' : path.slice(0, cut + 1)) + chunkName + (q < 0 ? '' : mainUrl.slice(q));
}

/**
 * 主包 URL：**只认本包那条** —— 真机实测页面里有多条 `client.js` 批次 URL，取第一条会拿到
 * **别的包**（例 `dsh-client-modules`）⇒ 派生出的 chunk URL 畸形、探测状态与真实 chunk 不符。
 */
export function findMainBundleUrl(): string | undefined {
  const srcs = Array.from(document.getElementsByTagName('script'), (el) => el.src);
  return srcs.find((src) => src.includes(PACKAGE_NAME)) ?? srcs.find((src) => src.includes('/client.js'));
}

/** 宿主原文里它**真正请求**的那个 chunk URL（最准：带真实 `?rev=`）；抠不到则回落推导 */
export function chunkUrlFromError(error: unknown, chunkName: string): string | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const at = text.indexOf(chunkName);
  if (at < 0) return undefined;
  const head = /[^\s"']*$/.exec(text.slice(0, at))?.[0] ?? '';
  const tail = /^[^\s"']*/.exec(text.slice(at))?.[0] ?? '';
  return new URL(head + tail, document.baseURI).href;
}

/** 分类（优先级：离线 > 宿主明说「已加载却没注册」⇒ init-failed > 404 > 脚本没到 > 未归类） */
export function classifyChunkFailure(
  error: unknown,
  facts: { readonly online: boolean; readonly status: number | null },
): ChunkFailure {
  const detail = error instanceof Error ? error.message : String(error);
  const reason: ChunkFailureReason = !facts.online
    ? 'offline'
    // 🔴 真机教训：探测可能打偏 ⇒ 宿主明说「已加载却没注册」时不让 404 抢答
    : (facts.status === 404 || facts.status === 410) && !detail.includes('loaded without registering')
      ? 'not-deployed'
      : detail.includes('loaded without registering')
        ? 'init-failed'
        : detail.includes('failed to load')
          ? 'unreachable'
          : 'unknown';
  return { reason, label: LABEL[reason], hint: HINT[reason], detail };
}

/** 探一次 chunk URL 的真实状态码（把「404 没部署」与「网络不通」分开；探不通 = null） */
export async function probeChunkStatus(url: string): Promise<number | null> {
  try {
    return (await fetch(url, { method: 'GET', cache: 'no-store' })).status;
  } catch {
    return null;
  }
}

export interface ChunkBootProps {
  readonly spec: string;
  readonly title: string;
  readonly load: (spec: string) => Promise<ChunkSeatModule>;
  readonly paneProps: Record<string, unknown>;
  /**
   * 组件导出名（缺省 `'PortsPane'`）。015 `P4` 加了第二个 chunk（容器页）⇒ 同一个 `ChunkBoot`
   * 要能取不同名字的组件；缺省值保证转发侧调用点与既有测试**一字不变**。
   */
  readonly exportName?: string;
  /** 测试缝（生产缺省 = 真 `navigator.onLine` / 真 `fetch` / 真 DOM 自省） */
  readonly online?: () => boolean;
  readonly probe?: (url: string) => Promise<number | null>;
  readonly mainUrl?: () => string | undefined;
}

type BootState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly Pane: ComponentType<Record<string, unknown>> }
  | { readonly phase: 'failed'; readonly failure: ChunkFailure };

/**
 * 取块壳：`loading → ready | failed`（failed 带原因分类 + 原文 + 「重试」）。
 *
 * 🔴 重试**真能重发**：宿主 `importChunk` 的 `pendingArrival` 在 `.finally()` 里清、`loadCache`
 * 只记**已材质化**的模块 ⇒ 失败不入缓存，同 URL 再取一次会重新发请求（不再用 `react.lazy`：
 * 它会把失败的 promise 记忆住 ⇒ 重试变成空转）。
 */
export function ChunkBoot(props: ChunkBootProps): ReactElement {
  const { spec, title, load, paneProps, exportName = 'PortsPane', online, probe, mainUrl } = props;
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    void load(spec)
      .then((mod) => {
        if (!alive) return;
        const picked = (mod as unknown as Record<string, ComponentType<Record<string, unknown>> | undefined>)[exportName];
        if (picked === undefined) {
          setState({
            phase: 'failed',
            failure: {
              reason: 'init-failed',
              label: '页面组件加载失败',
              hint: 'chunk 已取回但没有导出约定的组件名：多半是产物过期或导出名对不上，重建客户端产物后再刷新。',
              detail: `${spec} 缺少导出 ${exportName}`,
            },
          });
          return;
        }
        setState({ phase: 'ready', Pane: picked });
      })
      .catch(async (error: unknown) => {
        const isOnline = (online ?? ((): boolean => navigator.onLine))();
        const base = (mainUrl ?? findMainBundleUrl)();
        const chunkUrl = chunkUrlFromError(error, spec.slice(2)) ?? (base === undefined ? undefined : deriveChunkUrl(base, spec.slice(2)));
        // 离线时不发这次注定失败的探测；在线且拿得到 URL 才探（分类要它把 404 与网络不通分开）
        const status = !isOnline || chunkUrl === undefined ? null : await (probe ?? probeChunkStatus)(chunkUrl);
        const failure = classifyChunkFailure(error, { online: isOnline, status });
        console.error(
          `[dsh-wsl-docker-ports] 取块失败（${failure.reason}）：${spec}${chunkUrl === undefined ? '' : ` → ${chunkUrl}`}`,
          failure.detail,
        );
        if (alive) setState({ phase: 'failed', failure });
      });
    return () => {
      alive = false;
    };
  }, [attempt, spec, load, online, probe, mainUrl]);

  if (state.phase === 'ready') return createElement(state.Pane, paneProps);
  if (state.phase === 'loading') return createElement('div', { className: 'wdp-loading' }, `${title}：正在加载界面资源…`);

  const { failure } = state;
  return createElement(
    'div',
    { className: 'wdp-card', role: 'alert', 'data-testid': CHUNK_DEGRADE_TESTID.panel },
    createElement('h3', null, `${title}：界面资源加载失败`),
    createElement('p', { 'data-testid': CHUNK_DEGRADE_TESTID.label }, failure.label),
    createElement('p', { className: 'wdp-muted', 'data-testid': CHUNK_DEGRADE_TESTID.hint }, failure.hint),
    createElement('pre', { className: 'wdp-pre', 'data-testid': CHUNK_DEGRADE_TESTID.detail }, failure.detail),
    createElement(
      'button',
      {
        type: 'button',
        className: 'wdp-btn wdp-btn-primary',
        'data-testid': CHUNK_DEGRADE_TESTID.retry,
        onClick: () => setAttempt((n) => n + 1),
      },
      '重试',
    ),
  );
}
