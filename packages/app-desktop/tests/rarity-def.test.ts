// @vitest-environment happy-dom
/**
 * #018 批 1 UI 回归：稀有度展示改由内容 def 驱动（ADR-016 裁决 ①/④）
 * + N2 修复（斗法页修为读数按 combatSkillId 解析，不硬编码内容 id）。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import {
  createGame,
  levelFromXp,
  ManualClock,
  type GameAction,
  type GameEvent,
  type SaveData,
} from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 战斗技能 id ≠ 'combat' 的最小包：N2 回归夹具（与引擎 fixtures 同款改名）。 */
const FIGHT_PACK = {
  skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
  items: [],
  recipes: [],
  enemies: [],
  gearDrops: [],
  rarities: [],
  affixPool: [],
  combatText: {},
  shop: [],
} as unknown as ContentPack;

function mount(content: ContentPack, game: ReturnType<typeof createGame>): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return root;
}

describe('#018 · N2：斗法页修为读数按 combatSkillId 解析', () => {
  it('技能 id 改名（fight）后修为读数正常，不再落回 0 层', () => {
    const clock = new ManualClock();
    const save = {
      version: 1 as const,
      time: 0,
      state: { skills: { fight: { xp: 100000 } } },
    } as unknown as SaveData;
    const game = createGame({ content: FIGHT_PACK, clock, save });
    const root = mount(FIGHT_PACK, game);

    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    const level = levelFromXp(100000);
    expect(level).toBeGreaterThan(0);
    expect(root.textContent).toContain(`当前斗法 ${level} 层`);
    expect(root.textContent).not.toContain('当前斗法 0 层');
  });
});

describe('#018 · 稀有度展示 def 驱动', () => {
  it('showcase bool 驱动「天降异宝」特判（非 id 字面量）；着色类/档名/倍率查 def', () => {
    const clock = new ManualClock();
    const pack = {
      skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
      items: [
        { id: 'sword', name: '试炼剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 10, bonuses: { atk: 4 } },
      ],
      recipes: [],
      enemies: [],
      gearDrops: [],
      // 精淬（非最高档）带 showcase：特判跟随 bool 而非档位次序
      rarities: [
        { id: 'plain', name: '朴素', weight: 1, mult: 1, affix: 0, sell: 1 },
        { id: 'refined', name: '精淬', weight: 1, mult: 2, affix: 0, sell: 2, showcase: true },
      ],
      affixPool: [],
      combatText: {},
      shop: [],
    } as unknown as ContentPack;
    const game = createGame({ content: pack, clock });
    const root = mount(pack, game);

    // 合成 loot 事件直接打 UI 接缝（buildUi 的事件订阅路径与生产一致）
    game.events.emit({ type: 'loot', time: 0, data: { source: 'gear', item: 'sword', itemName: '试炼剑', rarity: 'refined', uid: 1 } });
    expect(root.querySelectorAll('.toast').length).toBe(1);
    expect(root.querySelector('.toast')?.textContent).toContain('天降异宝');

    // 无 showcase 的档位不掉特判
    game.events.emit({ type: 'loot', time: 1, data: { source: 'gear', item: 'sword', itemName: '试炼剑', rarity: 'plain', uid: 2 } });
    expect(root.querySelectorAll('.toast').length).toBe(1);

    // 存档注入精淬装备 → 着色类 r-refined（def.id 驱动，非旧白名单）
    const base = game.snapshot();
    const save = {
      ...base,
      state: {
        ...(base.state as Record<string, unknown>),
        gear: [{ uid: 1, itemId: 'sword', rarity: 'refined', affixes: [] }],
      },
    } as SaveData;
    const game2 = createGame({ content: pack, clock: new ManualClock(), save });
    const root2 = mount(pack, game2);
    root2.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    expect(root2.querySelector('.gear-card.r-refined')).not.toBeNull();
    expect(root2.textContent).toContain('精淬·试炼剑');
    // mult 展示值查 def：round(4 × 2) = 8
    expect(root2.textContent).toContain('攻+8');
  });

  it('修仙包端到端：绝世掉落 → 特判 toast → r-epic 卡 → 卖价 = max(1, round(卖价×10))', () => {
    const clock = new ManualClock();
    const pack = {
      skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
      items: [
        { id: 'scorp_tail', name: '蝎尾刺', icon: '刺', type: 'equip', slot: 'weapon', sell: 25, bonuses: { atk: 5 } },
      ],
      recipes: [],
      enemies: [
        {
          id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
          hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
          gold: { min: 4, max: 10 }, drops: [],
        },
      ],
      gearDrops: [{ enemy: 'e1', chance: 0.999, pool: ['scorp_tail'] }],
      rarities: [
        { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
        { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2 },
        { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4 },
        { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, showcase: true },
      ],
      affixPool: [
        { name: '锐锋', stat: 'atk', scale: 0.3 },
        { name: '罡气', stat: 'def', scale: 0.3 },
        { name: '浑厚', stat: 'hp', scale: 1.5 },
        { name: '通明', stat: 'crit', scale: 0.25 },
      ],
      combatText: {
        verbs: {
          sword: [{ v: '刺', limbs: ['咽喉'] }],
          fist: [{ v: '击', limbs: ['面门'] }],
          claw: [{ v: '抓', limbs: ['肩头'] }],
          magic: [{ v: '摄', limbs: ['眉心'] }],
        },
        moves: { fist: ['搏兔一击'], e1: ['饿虎扑食'] },
        openings: ['你气沉丹田'],
        critIntro: ['你气机鼓荡'],
        cons: {
          hit: {
            light: ['{defender}受创{d}点。'],
            mid: ['{defender}闷哼，受创{d}点。'],
            heavy: ['{defender}喷血，受创{d}点。'],
            deadly: ['{defender}摇摇欲坠，受创{d}点。'],
          },
          hurt: {
            light: ['你受创{d}点。'],
            mid: ['你闷哼，受创{d}点。'],
            heavy: ['你喷血，受创{d}点。'],
            deadly: ['你摇摇欲坠，受创{d}点。'],
          },
        },
        fatal: { hit: '{defender}灵光溃散，受创{d}点！', hurt: '你眼前一黑，受创{d}点。' },
      },
      shop: [],
    } as unknown as ContentPack;
    // rng 恒 0.995：掉落必中（<0.999）、稀有度必中绝世（0.995×100=99.5 → 权重段 [98,100)）
    const game = createGame({ content: pack, clock, rng: () => 0.995 });
    const root = mount(pack, game);
    const loots: GameEvent[] = [];
    game.events.subscribe((e) => {
      if (e.type === 'loot' && e.data?.source === 'gear') loots.push(e);
    });

    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    let won = false;
    for (let i = 0; i < 60 && !won; i++) {
      game.tick(5000);
      won = game.events.drain().some((e) => e.type === 'victory');
    }
    expect(won).toBe(true);
    expect(loots[0]?.data?.rarity).toBe('epic');
    expect(root.querySelector('.toast')?.textContent).toContain('天降异宝');

    // 乾坤袋：r-epic 着色 + 档名前缀 + mult 展示值（round(5×1.5)=8）
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    expect(root.querySelector('.gear-card.r-epic')).not.toBeNull();
    expect(root.textContent).toContain('绝世·蝎尾刺');
    expect(root.textContent).toContain('攻+8');

    // 卖价走 def.sell：max(1, round(25 × 10)) = 250
    root.querySelector<HTMLButtonElement>('[data-act="sell-gear"]')!.click();
    expect(root.textContent).toContain('得 250 灵石');
  });
});
