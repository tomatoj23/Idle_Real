// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { validateContentPack } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { confirmDirtyLoad, DIRTY_LOAD_MESSAGE, createStore } from '../src/core/state.js';

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

describe('confirmDirtyLoad：载入新包的脏确认守卫（审计修复①）', () => {
  it('包干净 → 直接放行，不触发 confirm', () => {
    const store = createStore(xiuxianPackJson);
    const confirmFn = vi.fn(() => false);
    expect(confirmDirtyLoad(store, confirmFn)).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('dirty + confirm=false → 守卫拒绝：调用点不 loadPack，包不被替换、脏标记保留', () => {
    const store = createStore(xiuxianPackJson);
    store.update(() => {}); // 模拟一次未导出的编辑
    const before = store.state.pack;
    const confirmFn = vi.fn(() => false);
    const confirmed = confirmDirtyLoad(store, confirmFn);
    // 调用点约定：守卫拒绝即 return（不 loadPack）——包引用与脏标记不变。
    if (confirmed) store.loadPack({ version: '9.9.9' });
    expect(confirmed).toBe(false);
    expect(confirmFn).toHaveBeenCalledWith(DIRTY_LOAD_MESSAGE);
    expect(store.state.pack).toBe(before);
    expect(store.state.dirty).toBe(true);
  });

  it('dirty + confirm=true → 放行：loadPack 整树替换并清脏', () => {
    const store = createStore(xiuxianPackJson);
    store.update(() => {});
    expect(store.state.dirty).toBe(true);
    expect(confirmDirtyLoad(store, () => true)).toBe(true);
    const before = store.state.pack;
    const result = store.loadPack(JSON.parse(JSON.stringify(xiuxianPackJson)));
    expect(result.ok).toBe(true);
    expect(store.state.pack).not.toBe(before);
    expect(store.state.dirty).toBe(false);
  });

  it('main.ts 同款 window.confirm 接线：lambda 方法调用 + vi.spyOn stub', () => {
    const store = createStore(xiuxianPackJson);
    store.update(() => {});
    // happy-dom 20 里 confirm 虽是自有访问器属性，getter 却返回 undefined，
    // spyOn（要求现值是函数）仍拒绝——先赋值落成自有数据属性再 spy；结束删除还原。
    const holder = window as unknown as { confirm?: (message: string) => boolean };
    const hadOwn = Object.getOwnPropertyNames(holder).includes('confirm');
    holder.confirm = holder.confirm ?? ((message: string) => true);
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      expect(confirmDirtyLoad(store, (message) => window.confirm(message))).toBe(false);
      expect(spy).toHaveBeenCalledWith(DIRTY_LOAD_MESSAGE);
    } finally {
      spy.mockRestore();
      if (!hadOwn) delete holder.confirm;
    }
  });
});
