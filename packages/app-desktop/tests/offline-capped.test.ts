// @vitest-environment happy-dom
/**
 * 离线上限钳制文案（#60）：offlineCap 钳制发生时引擎双报（awaySeconds/seconds），
 * 壳层切 offlineCapped* 模板区分"离开时长"与"结算时长"——防结算时长冒充
 * 离开时长误导（挂机 20h 只显示"离线修行 1 时"事故）。走真修仙包全链。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction } from '@wendao/engine';
import { buildUi } from '../src/ui';

describe('离线上限钳制文案', () => {
  it('钳制发生：修行录行含"上限"与两个时长；未钳制：维持单时长口径', () => {
    const content = loadXiuxianPack();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const cappedGame = createGame({
      content,
      clock: new ManualClock(),
      seed: 11,
      contributions: [
        {
          modifier: { stat: 'offlineCap', zone: 'flat', value: 6000 },
          source: { id: 'guixi', kind: 'test', name: '龟息' },
        },
      ],
    });
    const ui = buildUi(root, content, () => cappedGame.snapshot(), cappedGame.events);
    ui.bindActions((action: GameAction) => cappedGame.dispatch(action));
    ui.render();
    cappedGame.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    cappedGame.settleOffline(60000); // 离开 60s，上限 6s
    cappedGame.events.drain();
    ui.render();
    const text = root.textContent ?? '';
    expect(text).toContain('上限'); // offlineCappedLog 模板词
    expect(text).toContain('离线修行'); // 模板主语保留
    expect(text).not.toContain('离线修行 6'); // 不再拿结算时长冒充离开时长（60s→"1 时 0 分"）

    // 未钳制路径回归：无 contributions 时维持 offlineLog 单时长口径
    const plainGame = createGame({ content, clock: new ManualClock(), seed: 11 });
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const ui2 = buildUi(root2, content, () => plainGame.snapshot(), plainGame.events);
    ui2.bindActions((action: GameAction) => plainGame.dispatch(action));
    ui2.render();
    plainGame.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    plainGame.settleOffline(60000);
    plainGame.events.drain();
    ui2.render();
    const plain = root2.textContent ?? '';
    expect(plain).toContain('离线修行');
    expect(plain).not.toContain('上限');
  });
});
