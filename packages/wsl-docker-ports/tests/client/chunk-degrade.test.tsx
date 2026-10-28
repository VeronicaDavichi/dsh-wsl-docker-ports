// @vitest-environment jsdom
/**
 * 011 `T2.4`（`REQ-BS-5`）回归门：取块失败 ⇒ **可解释降级**（原因分类 + 原文 + 可重试 + Console 明确错误）。
 *
 * ## 为什么门要在这里（而不是只看真机截图）
 *
 * `T0.2` 的真机基线是：404 / chunk 抛错 / 断网三态**都不白屏，但也没有任何原因文案与重试**
 * （痕迹只在 Console：`client-modules: bundle script … failed to load` + `slot entry crashed in
 * 'sidebar.right.pane.tab'`）。本门把「三态各自的文案分类 / 原文可见 / 有重试 / 非空白」做成二值断言；
 * 真机三态由 011 的 `V3`/`V4` 复核。
 *
 * ## 深水区（主包字节咬死 ⇒ 理由写在这里，不占产物）
 *
 * 1. **降级面必须常驻主包**：失败的那一半**正是 chunk** ⇒ 降级 UI 进 chunk 就是「一起失败」。
 * 2. **重试必须真重发**：宿主 `dsh-client-modules/lib/client.js` 的 `importChunk` 把在途请求放进
 *    `pendingArrival` 并在 `.finally()` 里删掉，`loadCache` 只写**已材质化**的模块 ⇒ 失败不入缓存。
 *    反例 = `react.lazy`：它按 id 记忆 promise（**失败也被记住**）⇒ 重试只会拿到同一个 rejection。
 * 3. **分类靠探测**：`failed to load` 这句文案对「404」与「断网」是**同一句**，光看 error 分不开 ⇒
 *    离线读 `navigator.onLine`（且不再发注定失败的探测）；在线则探一次 chunk URL 的**真实状态码**
 *    （URL = 主包 URL 同目录换名、**保留 `?rev=`**，与宿主 `chunkUrl()` 同形）。
 * 4. **chunk 执行期抛错**有专属文案（宿主文案 `loaded without registering`）—— 它不是网络问题，
 *    报错方向完全不同（本插件缺陷 vs 环境问题）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHUNK_DEGRADE_TESTID,
  ChunkBoot,
  chunkUrlFromError,
  classifyChunkFailure,
  deriveChunkUrl,
  findMainBundleUrl,
  type ChunkSeatModule,
} from '../../src/client/chunk-degrade.ts';

const SPEC = './client.ports.js';
const MAIN = 'http://127.0.0.1:43321/plugins/dsh-wsl-docker-ports/client.js?rev=0fe0177eabc7';
const CHUNK = 'http://127.0.0.1:43321/plugins/dsh-wsl-docker-ports/client.ports.js?rev=0fe0177eabc7';
const PANE_TEXT = '渲染面已就位（chunk 侧真组件）';
const FAILED_TO_LOAD = `client-modules: bundle script ${CHUNK} failed to load`;
const NOT_REGISTERED = `client-modules: bundle ${CHUNK} loaded without registering "client.ports.js" via __ModuleLoader__.load`;

const seatModule = (): ChunkSeatModule => ({ PortsPane: () => createElement('div', null, PANE_TEXT) });

interface MountOptions {
  readonly load: (spec: string) => Promise<ChunkSeatModule>;
  readonly online?: boolean;
  readonly probe?: (url: string) => Promise<number | null>;
  readonly mainUrl?: string | undefined;
}

function mount(options: MountOptions): ReturnType<typeof render> {
  return render(
    <ChunkBoot
      spec={SPEC}
      title="WSL 端口转发"
      load={options.load}
      paneProps={{ runtime: {} }}
      online={() => options.online ?? true}
      probe={options.probe ?? (async () => 200)}
      mainUrl={() => (options.mainUrl === undefined ? MAIN : options.mainUrl)}
    />,
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  cleanup();
  errorSpy?.mockRestore();
});

describe('T2.4 纯函数：URL 推导与原因分类', () => {
  it('① chunk URL = 主包同目录换名，且**保留** ?rev=（探测打的就是宿主会打的那个 URL）', () => {
    expect(deriveChunkUrl(MAIN, 'client.ports.js')).toBe(CHUNK);
    expect(deriveChunkUrl('http://h/p/a/client.js', 'client.ports.js')).toBe('http://h/p/a/client.ports.js');
    expect(deriveChunkUrl('http://h/client.js?v=1#x', 'client.ports.js')).toBe('http://h/client.ports.js?v=1#x');
  });

  it('①b 批次 URL（真机形态）⇒ 拼成本包独立路径；主包 URL **只认本包那条**', () => {
    // 真机实测：页面里 `client.js` 批次 URL 有三条以上，取第一条会拿到 dsh-client-modules（别的包）
    const BATCH = 'http://h/plugins/??@a/client.js,@b/client.js,dsh-wsl-docker-ports/client.js&rev=68e1c0ff6961';
    expect(deriveChunkUrl(BATCH, 'client.ports.js')).toBe(
      'http://h/plugins/dsh-wsl-docker-ports/client.ports.js?rev=68e1c0ff6961',
    );
    document.head.innerHTML = [
      '<script src="http://h/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=b7"></script>',
      '<script src="http://h/plugins/??@x/client.js,@y/client.js&rev=11"></script>',
      `<script src="${BATCH}"></script>`,
    ].join('');
    expect(findMainBundleUrl()).toBe(BATCH);
    // 坏 URL ⇒ 探测打偏 ⇒ 真机上会把「初始化失败」误判成 404（这就是本条回归要钉死的东西）
    expect(deriveChunkUrl('http://h/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=b7', 'client.ports.js')).toBe(
      'http://h/plugins/dsh-wsl-docker-ports/client.ports.js?rev=b7',
    );
    document.head.innerHTML = '';
  });

  it('①c 从宿主原文抠出**它真正请求**的那个 chunk URL（带真实 ?rev=，相对/绝对两种形态）', () => {
    expect(chunkUrlFromError(new Error(NOT_REGISTERED), 'client.ports.js')).toBe(CHUNK);
    expect(
      chunkUrlFromError(
        new Error('client-modules: bundle script plugins/dsh-wsl-docker-ports/client.ports.js?rev=e0a93490a42d failed to load'),
        'client.ports.js',
      ),
    ).toBe('http://localhost:3000/plugins/dsh-wsl-docker-ports/client.ports.js?rev=e0a93490a42d');
    expect(chunkUrlFromError(new Error('别的什么错'), 'client.ports.js')).toBeUndefined();
  });

  it('② 分类优先级：离线 > 404 > chunk 抛错 > 脚本没到 > 未归类（每一类都点名过）', () => {
    const f = (error: unknown, online: boolean, status: number | null) => classifyChunkFailure(error, { online, status }).reason;
    const scriptError = new Error(FAILED_TO_LOAD);
    expect(f(scriptError, false, 404)).toBe('offline');
    expect(f(scriptError, true, 404)).toBe('not-deployed');
    expect(f(scriptError, true, 410)).toBe('not-deployed');
    expect(f(new Error(NOT_REGISTERED), true, 200)).toBe('init-failed');
    // 🔴 真机教训：探测 URL 打偏时会给 404，但宿主已明说「已加载却没注册」⇒ 不许被 404 抢答
    expect(f(new Error(NOT_REGISTERED), true, 404)).toBe('init-failed');
    expect(f(scriptError, true, 200)).toBe('unreachable');
    expect(f(scriptError, true, null)).toBe('unreachable');
    expect(f(new Error('别的什么错'), true, 200)).toBe('unknown');
    // 非 Error 也分类（不能因为 throw 了字符串就炸）
    expect(f('boom', true, 500)).toBe('unknown');
    console.log('  · 分类 8 条窗口全部按优先级落位（离线 / 404 / 410 / 抛错 / 抛错但探测 404 / 200 / null / 未归类）');
  });
});

describe('T2.4 三态降级：有文案、有原文、有重试、无空白页、Console 明确', () => {
  it('③ 404（没部署）⇒ 面板在 + 404 文案 + 原文 + 「重试」按钮；**不是**空白的 tab', async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    mount({
      load: async () => {
        throw new Error(FAILED_TO_LOAD);
      },
      probe: async (url) => {
        seen.push(url);
        return 404;
      },
    });

    const panel = await screen.findByTestId(CHUNK_DEGRADE_TESTID.panel);
    expect(panel).not.toBeNull();
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.label).textContent).toContain('界面资源不存在（404）');
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.detail).textContent).toContain('failed to load');
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.retry).textContent).toBe('重试');
    expect(screen.queryByText(PANE_TEXT)).toBeNull();
    // 探测打的是**真 URL**（保留 ?rev=）—— 打错 URL 会把 404 误判成网络问题
    expect(seen).toEqual([CHUNK]);
    // Console 有明确错误（T2.4 判据之一：不静默）
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [line, detail] = errorSpy.mock.calls[0] as [string, string];
    expect(line).toContain('取块失败（not-deployed）');
    expect(line).toContain(CHUNK);
    expect(detail).toContain('failed to load');
    console.log(`  · 404 态：面板在、「重试」在、探测 URL 正确、Console=${line.slice(0, 60)}…`);
  });

  it('④ 离线 ⇒ 离线文案；且**不**发注定失败的探测请求', async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let probed = 0;
    mount({
      load: async () => {
        throw new Error(FAILED_TO_LOAD);
      },
      online: false,
      probe: async () => {
        probed += 1;
        return null;
      },
    });

    await screen.findByTestId(CHUNK_DEGRADE_TESTID.panel);
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.label).textContent).toContain('离线');
    expect(probed).toBe(0);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('取块失败（offline）');
    console.log('  · 离线态：文案=离线、探测请求 0 次（不浪费在注定失败的请求上）');
  });

  it('⑤ chunk 执行期抛错 ⇒ 专属文案（不是网络问题）+ 原文进详情', async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount({
      load: async () => {
        throw new Error(NOT_REGISTERED);
      },
      probe: async () => 200,
    });

    await screen.findByTestId(CHUNK_DEGRADE_TESTID.panel);
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.label).textContent).toContain('已下载但初始化失败');
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.detail).textContent).toContain('loaded without registering');
    expect(errorSpy.mock.calls[0]?.[0]).toContain('取块失败（init-failed）');
    console.log('  · 抛错态：文案=「已下载但初始化失败」（与网络问题分开）、原文可见');
  });

  it('⑥ 网络不可达（脚本没到、探测也失败）⇒ 网络/代理文案', async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount({
      load: async () => {
        throw new Error(FAILED_TO_LOAD);
      },
      probe: async () => null,
    });

    await screen.findByTestId(CHUNK_DEGRADE_TESTID.panel);
    expect(screen.getByTestId(CHUNK_DEGRADE_TESTID.label).textContent).toContain('网络');
    expect(errorSpy.mock.calls[0]?.[0]).toContain('取块失败（unreachable）');
  });
});

describe('T2.4 重试：真的再取一次块（不是空转）', () => {
  it('⑦ 失败 → 点「重试」→ 第二次成功 ⇒ 渲染面出现；load 被调用 **2** 次（复现失败不入缓存）', async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    mount({
      load: async () => {
        calls += 1;
        if (calls === 1) throw new Error(FAILED_TO_LOAD);
        return seatModule();
      },
      probe: async () => 200,
    });

    await screen.findByTestId(CHUNK_DEGRADE_TESTID.panel);
    expect(calls).toBe(1);

    fireEvent.click(screen.getByTestId(CHUNK_DEGRADE_TESTID.retry));
    await waitFor(() => {
      expect(screen.getByText(PANE_TEXT)).not.toBeNull();
    });
    expect(calls).toBe(2);
    expect(screen.queryByTestId(CHUNK_DEGRADE_TESTID.panel)).toBeNull();
    console.log('  · 重试：load 1 → 2 次、面板消失、渲染面出现（⇒ 重试不是空转）');
  });

  it('⑧ 加载中先给「正在加载界面资源…」（不做空白页），失败后才换面板', async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reject!: (e: unknown) => void;
    mount({
      load: () =>
        new Promise<ChunkSeatModule>((_resolve, rej) => {
          reject = rej;
        }),
      probe: async () => 404,
    });

    expect(screen.getByText(/正在加载界面资源…/)).not.toBeNull();
    expect(screen.queryByTestId(CHUNK_DEGRADE_TESTID.panel)).toBeNull();
    reject(new Error(FAILED_TO_LOAD));
    await screen.findByTestId(CHUNK_DEGRADE_TESTID.panel);
    console.log('  · 加载态：先文案后面板（两态都非空白）');
  });
});
