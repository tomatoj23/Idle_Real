import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  attachAutoSave,
  localStorageSaveAdapter,
  memorySaveAdapter,
  playerMaxHp,
  restoreState,
  type GameContent,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack, makePack } from './fixtures.js';

describe('SaveAdapter（issue #3）', () => {
  it('memory 适配器存取往返', () => {
    const adapter = memorySaveAdapter();
    expect(adapter.load()).toBeNull();

    const data = { version: 1 as const, time: 5, state: { gold: 7 } };
    adapter.save(data);
    expect(adapter.load()).toEqual(data);
  });

  it('localStorage 适配器往返，坏档静默降级为 null', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    try {
      const adapter = localStorageSaveAdapter('wendao_test_key');
      expect(adapter.load()).toBeNull();

      const data = { version: 1 as const, time: 9, state: { gold: 3 } };
      adapter.save(data);
      expect(adapter.load()).toEqual(data);

      store.set('wendao_test_key', '{broken json');
      expect(adapter.load()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('attachAutoSave 周期保存，stop 后停止', () => {
    vi.useFakeTimers();
    try {
      const game = createGame({ content: makePack(), clock: new ManualClock() });
      const adapter = memorySaveAdapter();
      const handle = attachAutoSave(game, adapter, 15000);
      expect(adapter.load()).toBeNull();

      vi.advanceTimersByTime(15000);
      expect(adapter.load()).not.toBeNull();
      const first = adapter.load();

      handle.stop();
      vi.advanceTimersByTime(30000);
      expect(adapter.load()).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('restoreState 恢复守卫契约（#42 字段表复审收口）', () => {
  it('畸形档缺 time：buffs 一律不收编（与字段表前 NaN 比较语义一致）', () => {
    const save = { version: 1 as const, state: { buffs: { consumable_atk: 5000 } } } as unknown as SaveData;
    const state = restoreState(makeCombatPack(), save, 1);
    expect(state.buffs).toEqual({});
  });

  it('畸形档缺 time：其余字段不受影响（gold 按守卫缺省收编）', () => {
    const save = { version: 1 as const, state: { gold: 33.7, buffs: {} } } as unknown as SaveData;
    const state = restoreState(makeCombatPack(), save, 1);
    expect(state.gold).toBe(33);
  });
});

describe('restoreState 气血钳制顺序（#41）', () => {
  /** 高斗法修为存档：xp 20000 → clv21，cap = 352（引擎基线曲线）远超 clv1 的 112。 */
  const highXp = { fight: { xp: 20000 } };
  const capOf = (): number => playerMaxHp(makeCombatPack(), highXp);

  it('高修为存档（hp>112）恢复后不被零修为基线压回 112：cap 按收编后的 skills 推算', () => {
    const save = {
      version: 1 as const,
      time: 0,
      state: { skills: highXp, hp: capOf() },
    } as unknown as SaveData;
    const state = restoreState(makeCombatPack(), save, 1);
    expect(state.hp).toBe(capOf());
    expect(state.hp).toBeGreaterThan(112);
  });

  it('未写 hp 的存档按恢复后修为满血（缺省值 = 收编后的 cap）', () => {
    const save = { version: 1 as const, time: 0, state: { skills: highXp } } as unknown as SaveData;
    const state = restoreState(makeCombatPack(), save, 1);
    expect(state.hp).toBe(capOf());
  });

  it('超顶 hp 收编原值（state.ts 只查有限/非负），createGame 按完整投影钳回', () => {
    const save = {
      version: 1 as const,
      time: 0,
      state: { skills: highXp, hp: 99999 },
    } as unknown as SaveData;
    const state = restoreState(makeCombatPack(), save, 1);
    expect(state.hp).toBe(99999); // 上限钳制不在字段表：hp 行恢复序在 gear 前、投影不可见
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), save });
    expect(game.snapshot().state.hp).toBe(capOf()); // 唯一上限钳点 = 完整投影
  });

  it('createGame 全路径同样不压顶：恢复后补钳按完整投影，只降不升', () => {
    const save = {
      version: 1 as const,
      time: 0,
      state: { skills: highXp, hp: capOf() },
    } as unknown as SaveData;
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), save });
    expect(game.snapshot().state.hp).toBe(capOf());
  });

  it('装备抬升的 hp 头寸恢复后存活，不再被修为基线钳掉（#41 残边界根治）', () => {
    // clv4 基线 cap 148；佩戴 hp+60 护甲 → 完整投影 cap 208，存档满血 208。
    const pack = {
      ...makeCombatPack(),
      items: [
        ...makeCombatPack().items,
        { id: 'lifePlate', name: '血玉护心镜', icon: '镜', type: 'equip', slot: 'armor', sell: 10, bonuses: { hp: 60 } },
      ],
    } as GameContent;
    const save = {
      version: 1 as const,
      time: 0,
      state: {
        skills: { fight: { xp: 300 } },
        hp: 208,
        gear: [{ uid: 2, itemId: 'lifePlate', rarity: 'common', affixes: [] }],
        equips: { armor: 2 },
      },
    } as unknown as SaveData;
    const state = restoreState(pack, save, 1);
    expect(state.hp).toBe(208); // 收编原值，基线不再截断
    const game = createGame({ content: pack, clock: new ManualClock(), save });
    expect(game.snapshot().state.hp).toBe(208); // 完整投影钳制：头寸存活

    // 包变更（护甲被移除）：实例被收编守卫弃置、投影回落基线 148 → 超顶压回。
    const gameAfter = createGame({ content: makeCombatPack(), clock: new ManualClock(), save });
    expect(gameAfter.snapshot().state.hp).toBe(148);
  });
});
