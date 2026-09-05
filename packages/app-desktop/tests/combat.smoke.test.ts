// @vitest-environment happy-dom
/**
 * UI 渲染烟测（issue #4 验收）：斗法页挑战敌人 → 战斗日志 → 胜利 →
 * 装备卡佩戴 → 属性面板反映。UI 只消费 events + snapshot，测的正是
 * 这条接缝（事件→战斗日志接线与生产共用 buildUi 内的同一套路径）。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

const MAX_FLOG = 60;

describe('UI 烟测（issue #4 战斗切片）', () => {
  it('斗法：挑战青鬃狼 → 战斗中视图 → 挂机胜利 → 战斗日志受控', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    const game = createGame({ content, clock, seed: 11 });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();

    // 斗法 tab：敌人卡列表（含门控信息）
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    expect(root.textContent).toContain('青鬃狼');

    // 点挑战 → 进入战斗
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    ui.render();
    expect(root.querySelector('.enemy-card.fighting')).not.toBeNull();
    expect(root.querySelector('#flog')).not.toBeNull();
    expect(root.querySelector('[data-act="flee"]')).not.toBeNull();

    // 挂机至首场胜利（假时钟大步长；胜利即停，避免后续连场败北离场）
    let won = false;
    for (let i = 0; i < 60 && !won; i++) {
      clock.advance(5000);
      game.tick(5000);
      won = game.events.drain().some((event) => event.type === 'victory');
    }
    expect(won).toBe(true);
    ui.render();

    // 胜利叙事 + 摘要画像落日志
    expect(root.textContent).toContain('轰然倒地');
    // 战斗日志容量受控（回归：日志容量受控）
    const flog = root.querySelector<HTMLElement>('#flog')!;
    expect(flog.children.length).toBeGreaterThan(0);
    expect(flog.children.length).toBeLessThanOrEqual(MAX_FLOG);
    // 日志滚动跟随到底（旧版踩坑回归；happy-dom 支持 scrollTop 记账）
    expect(flog.scrollTop).toBe(flog.scrollHeight);
  });

  it('乾坤袋：装备卡佩戴/卸下 → 顶栏属性反映倍率+词条', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    // 构造带装备实例的存档（罕见青锋剑：atk round(6×1.3)=8 + 锐锋 3 → 11）
    const base = createGame({ content, clock, seed: 3 }).snapshot();
    const save = {
      ...base,
      state: {
        ...(base.state as Record<string, unknown>),
        skills: { combat: { xp: 0 } },
        gear: [
          {
            uid: 1,
            itemId: 'sword1',
            rarity: 'rare',
            affixes: [
              { name: '锐锋', stat: 'atk', val: 3 },
              { name: '通明', stat: 'crit', val: 4 },
            ],
          },
        ],
        equips: {},
      },
    } as SaveData;
    const game = createGame({ content, clock, save });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();

    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    ui.render();
    // 稀有度着色的装备卡（罕见·青锋剑）
    expect(root.querySelector('.gear-card.r-rare')).not.toBeNull();
    expect(root.textContent).toContain('罕见·青锋剑');
    // 佩戴前属性：atk 11 / def 3 / crit 5%
    expect(root.querySelector('#res-stats')!.textContent).toBe('11/3/5%');

    // 点击佩戴（真实点击路径 → dispatch → equip:wear 事件回流）
    root.querySelector<HTMLButtonElement>('[data-act="wear"][data-uid="1"]')!.click();
    ui.render();
    expect(root.querySelector('[data-act="take-off"]')).not.toBeNull();
    // 佩戴后：atk 11+11=22、crit 5+4=9（经修饰符管线聚合）
    expect(root.querySelector('#res-stats')!.textContent).toBe('22/3/9%');

    // 卸下恢复
    root.querySelector<HTMLButtonElement>('[data-act="take-off"]')!.click();
    ui.render();
    expect(root.querySelector('[data-act="wear"][data-uid="1"]')).not.toBeNull();
    expect(root.querySelector('#res-stats')!.textContent).toBe('11/3/5%');
  });

  it('战斗页丹药快捷栏：嗑丹回血', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    const base = createGame({ content, clock, seed: 3 }).snapshot();
    const save = {
      ...base,
      state: {
        ...(base.state as Record<string, unknown>),
        items: { pill_heal: 1 },
        hp: 50,
      },
    } as SaveData;
    const game = createGame({ content, clock, save });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();

    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    const pillBtn = root.querySelector<HTMLButtonElement>('[data-act="eat"][data-item="pill_heal"]');
    expect(pillBtn).not.toBeNull();
    pillBtn!.click();
    ui.render();
    // 回气丹恢复 30% 上限：50 + 34 = 84
    expect(root.querySelector('#res-hp-text')!.textContent).toContain('84/');
    expect(game.snapshot().state.items['pill_heal']).toBeUndefined();
  });
});
