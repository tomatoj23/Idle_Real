import './style.css';
import { createGame } from '@wendao/engine';

const app = document.querySelector<HTMLDivElement>('#app');

// 引擎接缝冒烟：占位页先证明 workspace 链路与事件流可用。
// TODO(issue#2)：开局前改为加载 content 包 JSON，经 validateContent 强校验后注入。
const game = createGame({ content: {} });
game.tick(16);
const events = game.events.drain();
const first = events[0];

if (app) {
  app.innerHTML = `
    <h1>问道长生</h1>
    <p>新版引擎重建中——可玩切片将在后续版本开放。</p>
    <p class="smoke">引擎冒烟：tick 事件 ×${events.length}，type=${first?.type ?? '无'}</p>
  `;
}
