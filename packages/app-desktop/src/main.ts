import './style.css';
import {
  attachAutoSave,
  createGame,
  localStorageSaveAdapter,
  type GameAction,
} from '@wendao/engine';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { buildUi } from './ui';

const SAVE_KEY = 'wendao_changsheng_v2';
const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
const MAX_CATCHUP_MS = 5000;

const app = document.querySelector<HTMLDivElement>('#app');

try {
  if (!app) throw new Error('缺少 #app 挂载点');

  // 启动强校验接缝（issue #2）：坏内容绝不进入运行时。
  // #23 起壳层显式装配题材包（修仙包）——框架不再注入缺省包。
  const content = loadXiuxianPack();

  const adapter = localStorageSaveAdapter(SAVE_KEY);
  const save = adapter.load() ?? undefined;
  const game = createGame({
    content,
    save,
    // 仅无档首启生效；应用层负责给一个随机味种子（引擎内三禁不放行）。
    seed: Math.floor(Math.random() * 0x7fffffff),
  });

  const autoSave = attachAutoSave(game, adapter, AUTOSAVE_MS);
  window.addEventListener('beforeunload', () => autoSave.flush());

  // UI 只消费 events + snapshot（事件→日志/浮提示/重绘的接线在 buildUi 内）。
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
    app.innerHTML = `
      <h1>问道长生</h1>
      <pre class="content-error">启动中止：\n${err instanceof Error ? err.message : String(err)}</pre>
    `;
  }
}
