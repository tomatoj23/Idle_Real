import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  attachAutoSave,
  createGame,
  localStorageSaveAdapter,
  memorySaveAdapter,
} from '../src/index.js';
import { makePack } from './fixtures.js';

describe('SaveAdapter（issue #3）', () => {
  it('memory 适配器存取往返', () => {
    const adapter = memorySaveAdapter();
    expect(adapter.load()).toBeNull();

    const data = { version: 1 as const, time: 5, state: { gp: 7 } };
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
      const adapter = localStorageSaveAdapter('wendao_v2');
      expect(adapter.load()).toBeNull();

      const data = { version: 1 as const, time: 9, state: { gp: 3 } };
      adapter.save(data);
      expect(adapter.load()).toEqual(data);

      store.set('wendao_v2', '{broken json');
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
