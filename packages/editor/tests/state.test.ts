import { describe, expect, it, vi } from 'vitest';
import { validateContentPack } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { createStore } from '../src/core/state.js';

/** 最小合法包：单点破坏用底座（copy 后改）。 */
function brokenPack(mutate: (pack: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(xiuxianPackJson)) as Record<string, unknown>;
  mutate(copy);
  return copy;
}

describe('editor store', () => {
  it('loadPack：修仙真包可整包加载', () => {
    const store = createStore();
    expect(store.hasPack()).toBe(false);
    const result = store.loadPack(xiuxianPackJson);
    expect(result.ok).toBe(true);
    expect(store.hasPack()).toBe(true);
    expect(store.state.dirty).toBe(false);
  });

  it('loadPack：坏包被拒于状态之外（验收 3 的状态语义）', () => {
    const store = createStore();
    expect(store.loadPack(xiuxianPackJson).ok).toBe(true);
    const before = store.state.pack;

    const broken = brokenPack((pack) => {
      (pack['enemies'] as unknown[])[0] = { id: 'bad' }; // 缺 required 字段
    });
    const result = store.loadPack(broken);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.length).toBeGreaterThan(0);
    // 包不被应用：仍指向原对象。
    expect(store.state.pack).toBe(before);
    expect(store.hasPack()).toBe(true);
  });

  it('update：原地写回 + 标脏 + data 事件', () => {
    const store = createStore(xiuxianPackJson);
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((pack) => {
      const enemy = (pack['enemies'] as { hp: number }[])[0]!;
      enemy.hp = 999;
    });
    expect(store.state.dirty).toBe(true);
    expect(listener).toHaveBeenCalledWith(store.state, 'data');

    const check = validateContentPack(store.state.pack);
    expect(check.ok).toBe(true);
    expect(((store.state.pack['enemies'] as { hp: number }[])[0])!.hp).toBe(999);
  });

  it('setSection：改 UI 态不标脏', () => {
    const store = createStore(xiuxianPackJson);
    store.setSection('enemies');
    expect(store.state.section).toBe('enemies');
    expect(store.state.dirty).toBe(false);
  });

  it('subscribe：退订后不再通知', () => {
    const store = createStore(xiuxianPackJson);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.update(() => {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('createStore：初始包非法即抛错（防御路径）', () => {
    expect(() => createStore({ version: 'not-a-pack' })).toThrow();
  });
});
