import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  attachAutoSave,
  createGame,
  localStorageSaveAdapter,
  memorySaveAdapter,
  playerMaxHp,
  restoreState,
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

  it('超顶 hp 仍钳回当前 cap（上限防御不因顺序调整而失效）', () => {
    const save = {
      version: 1 as const,
      time: 0,
      state: { skills: highXp, hp: 99999 },
    } as unknown as SaveData;
    const state = restoreState(makeCombatPack(), save, 1);
    expect(state.hp).toBe(capOf());
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
});
