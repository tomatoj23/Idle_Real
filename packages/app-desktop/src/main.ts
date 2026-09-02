import './style.css';
import { createGame } from '@wendao/engine';
import { loadDefaultContent } from '@wendao/content';

const app = document.querySelector<HTMLDivElement>('#app');

// 启动强校验接缝（issue #2）：loadDefaultContent 内部先过 validateContentPack
// 再返回，坏内容绝不进入运行时；失败时红屏列出字段级错误。
let smoke = '';
try {
  const content = loadDefaultContent();
  const game = createGame({ content });
  game.tick(16);
  const events = game.events.drain();
  smoke =
    `引擎冒烟：tick 事件 ×${events.length}；内容包：技能 ${content.skills.length}` +
    ` · 物品 ${content.items.length} · 配方 ${content.recipes.length} · 敌人 ${content.enemies.length}`;
} catch (err) {
  console.error(err);
  if (app) {
    app.innerHTML = `
      <h1>问道长生</h1>
      <pre class="content-error">内容包校验失败，启动中止：\n${err instanceof Error ? err.message : String(err)}</pre>
    `;
  }
}

if (app && smoke !== '') {
  app.innerHTML = `
    <h1>问道长生</h1>
    <p>新版引擎重建中——可玩切片将在后续版本开放。</p>
    <p class="smoke">${smoke}</p>
  `;
}
