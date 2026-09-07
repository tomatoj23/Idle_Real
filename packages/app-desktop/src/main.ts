import './style.css';
import {
  attachAutoSave,
  createGame,
  fillTemplate,
  localStorageSaveAdapter,
  type GameAction,
  type SaveAdapter,
  type SaveData,
} from '@wendao/engine';
import type { ContentPack } from '@wendao/content';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { buildUi, esc } from './ui';
import { desktopBridgeOf, desktopSaveAdapter, wireAchievementReporting } from './desktop';

// #24：状态键 gp/pill/fist → gold/consumable/basic 是存档形状 breaking change。
// 旧存档不迁移（ADR-008）：v2 档留在旧键下永不读，新档从 v3 起。
const SAVE_KEY = 'wendao_changsheng_v3';
const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
const MAX_CATCHUP_MS = 5000;

const app = document.querySelector<HTMLDivElement>('#app');

/** texts.shell.brand 读取（#26）：内容包不可用（启动链早期失败）时键名回显（裁决 ④ 防御路径）。 */
function brandText(shell: unknown, key: 'name' | 'bootError'): string {
  const brand =
    shell !== null && typeof shell === 'object'
      ? (shell as { brand?: Record<string, unknown> }).brand
      : undefined;
  const value = brand?.[key];
  return typeof value === 'string' && value.length > 0 ? value : `shell.brand.${key}`;
}

let content: ContentPack | undefined;

try {
  if (!app) throw new Error('Missing #app mount point');

  // 启动强校验接缝（issue #2）：坏内容绝不进入运行时。
  // #23 起壳层显式装配题材包（修仙包）——框架不再注入缺省包。
  content = loadXiuxianPack();

  // 页面标题与文档语言随内容包（#26：壳零题材硬编码）。
  document.title = content.texts.shell.brand.name;
  document.documentElement.lang = content.texts.shell.brand.locale;

  // 桌面桥（#10）：Electron preload 注入 window.wendao 时走平台槽位适配
  //（mock=文件槽位 / steam=Steam Cloud）；纯浏览器 dev 缺桥回落 localStorage。
  const bridge = desktopBridgeOf();
  if (bridge) console.info(`[wendao] adapter=${bridge.mode} (desktop bridge)`);
  const adapter: SaveAdapter & { flushSync?(data: SaveData): void } = bridge
    ? desktopSaveAdapter(SAVE_KEY, bridge)
    : localStorageSaveAdapter(SAVE_KEY);
  const save = adapter.load() ?? undefined;
  const game = createGame({
    content,
    save,
    // 仅无档首启生效；应用层负责给一个随机味种子（引擎内三禁不放行）。
    seed: Math.floor(Math.random() * 0x7fffffff),
  });

  // 成就上报管道（#10）：挂载须早于 settleOffline——启动欠账结算即可触发解锁。
  if (bridge) wireAchievementReporting(game.events, bridge);

  const autoSave = attachAutoSave(game, adapter, AUTOSAVE_MS);
  window.addEventListener('beforeunload', () => {
    autoSave.flush();
    // 关闭即保存兜底（#10）：同步通道，退出竞态下异步 send 可能不达主进程。
    adapter.flushSync?.(game.snapshot());
  });

  // UI 只消费 events + snapshot + texts.shell（事件→日志/浮提示/重绘的接线在 buildUi 内）。
  const ui = buildUi(app, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));

  // 关闭期间的离线欠账：UI 订阅就绪后按墙钟差一次性补偿（ADR-013 观察时补偿）。
  if (save?.savedAt !== undefined) {
    const elapsed = Date.now() - save.savedAt;
    if (elapsed > 0) game.settleOffline(elapsed);
  }

  // 挂机主循环：正常间隔直接 tick；超长间隔（后台强节流/系统休眠）封顶
  // 在线步进，余量走 settleOffline 补偿——欠账不丢（ADR-013）。
  let last = Date.now();
  window.setInterval(() => {
    const now = Date.now();
    const elapsed = now - last;
    last = now;
    if (elapsed <= 0) return;
    if (elapsed <= MAX_CATCHUP_MS) {
      game.tick(elapsed);
    } else {
      game.tick(MAX_CATCHUP_MS);
      game.settleOffline(elapsed - MAX_CATCHUP_MS);
    }
  }, TICK_MS);

  ui.render();
} catch (err) {
  console.error(err);
  if (app) {
    // 此兜底捕获整个启动链（内容校验/存档恢复/平台探测），
    // 不要把所有异常都说成内容包问题（曾把 Illegal invocation 误标）。
    // 文案读 texts.shell.brand（#26）；内容包不可用时降级键名回显。
    const shell = content?.texts?.shell;
    const message = err instanceof Error ? err.message : String(err);
    app.innerHTML = `
      <h1>${esc(brandText(shell, 'name'))}</h1>
      <pre class="content-error">${esc(fillTemplate(brandText(shell, 'bootError'), { message }))}</pre>
    `;
  }
}
