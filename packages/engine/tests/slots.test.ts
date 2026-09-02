import { describe, expect, it } from 'vitest';
import { createGame, slotsOf, type Contribution, type GameContent } from '../src/index.js';
import { makePack } from './fixtures.js';

describe('槽位数据化（config.slots 驱动）', () => {
  it('config.slots 原样给出槽位列表（顺序保持）', () => {
    const content: GameContent = {
      config: {
        slots: [
          { id: 'weapon', name: '法器', icon: '兵' },
          { id: 'body', name: '护体', icon: '甲' },
          { id: 'accessory', name: '灵饰', icon: '饰' },
        ],
      },
    };

    expect(slotsOf(content).map((slot) => slot.id)).toEqual(['weapon', 'body', 'accessory']);
    expect(slotsOf(content)[0]).toMatchObject({ id: 'weapon', name: '法器', icon: '兵' });
  });

  it('缺省安全兜底：无 config / 无 slots / slots 非数组 → 空列表', () => {
    expect(slotsOf({})).toEqual([]);
    expect(slotsOf({ config: {} })).toEqual([]);
    expect(slotsOf({ config: { slots: 'bogus' } })).toEqual([]);
  });

  it('验收：槽位列表换包生效，加/减槽引擎零改动', () => {
    const threeSlots: GameContent = {
      config: {
        slots: [
          { id: 'weapon', name: '法器' },
          { id: 'body', name: '护体' },
          { id: 'accessory', name: '灵饰' },
        ],
      },
    };
    const fourSlots: GameContent = {
      config: {
        slots: [
          { id: 'weapon', name: '法器' },
          { id: 'body', name: '护体' },
          { id: 'accessory', name: '灵饰' },
          { id: 'talisman', name: '法宝' },
        ],
      },
    };

    expect(slotsOf(threeSlots)).toHaveLength(3);
    expect(slotsOf(fourSlots)).toHaveLength(4);
    expect(slotsOf(fourSlots).at(-1)).toMatchObject({ id: 'talisman', name: '法宝' });
  });
});

describe('Game 修饰符注入点（静态全局产出方：天赋/宗门/测试）', () => {
  it('无注入时 hp 上限维持基线（管线空转，行为零变化）', () => {
    const game = createGame({ content: makePack(), clock: { now: () => 0 } });
    // combat 技能 xp=0 → 1 层 → 100 + 12×1 = 112
    expect(game.snapshot().state.hp).toBe(112);
  });

  it('注入三区 hp 修饰符 → snapshot 属性按序聚合（flat 先于加法% 先于乘法）', () => {
    const source = { id: 'sect_taixu', kind: 'sect', name: '太虚宗' };
    const game = createGame({
      content: makePack(),
      clock: { now: () => 0 },
      contributions: [
        { modifier: { stat: 'hp', zone: 'flat', value: 38 }, source },
        { modifier: { stat: 'hp', zone: 'addPct', value: 20 }, source },
        { modifier: { stat: 'hp', zone: 'mult', value: 1.5 }, source },
      ],
    });
    // (112 + 38) × 1.2 × 1.5 = 270
    expect(game.snapshot().state.hp).toBe(270);
  });

  it('从存档恢复：hp 钳到聚合后的上限内', () => {
    const source = { id: 'sect_taixu', kind: 'sect', name: '太虚宗' };
    const contributions: readonly Contribution[] = [
      { modifier: { stat: 'hp', zone: 'flat', value: 88 }, source },
    ];
    const save = {
      version: 1 as const,
      time: 0,
      savedAt: 0,
      state: { hp: 250 }, // 基线上限 112，注入后上限 200
    };
    const game = createGame({
      content: makePack(),
      save,
      clock: { now: () => 0 },
      contributions,
    });
    expect(game.snapshot().state.hp).toBe(200);
  });
});
