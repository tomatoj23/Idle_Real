// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { validateContentPack } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { confirmDirtyLoad, DIRTY_LOAD_MESSAGE, createStore, HISTORY_LIMIT } from '../src/core/state.js';
import { xiuxianStore } from './helpers.js';

/** 最小合法包：单点破坏用底座（copy 后改）。 */
function brokenPack(mutate: (pack: Record<string, unknown>) => void): unknown {
  const copy = structuredClone(xiuxianPackJson) as Record<string, unknown>;
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
    const store = xiuxianStore();
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
    const store = xiuxianStore();
    store.setSection('enemies');
    expect(store.state.section).toBe('enemies');
    expect(store.state.dirty).toBe(false);
  });

  it('subscribe：退订后不再通知', () => {
    const store = xiuxianStore();
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
    const store = xiuxianStore();
    const confirmFn = vi.fn(() => false);
    expect(confirmDirtyLoad(store, confirmFn)).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('dirty + confirm=false → 守卫拒绝：调用点不 loadPack，包不被替换、脏标记保留', () => {
    const store = xiuxianStore();
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
    const store = xiuxianStore();
    store.update(() => {});
    expect(store.state.dirty).toBe(true);
    expect(confirmDirtyLoad(store, () => true)).toBe(true);
    const before = store.state.pack;
    const result = store.loadPack(xiuxianPackJson);
    expect(result.ok).toBe(true);
    expect(store.state.pack).not.toBe(before);
    expect(store.state.dirty).toBe(false);
  });

  it('main.ts 同款 window.confirm 接线：lambda 方法调用 + vi.spyOn stub', () => {
    const store = xiuxianStore();
    store.update(() => {});
    // happy-dom 20 已不实现 confirm（裸 Window 无此属性）；vitest 环境层落的
    // 自有访问器 getter 返回 undefined，spyOn 要求现值是函数仍拒绝——
    // 先垫函数再 spy。hadOwn 恒真、finally 不删除：垫入留存本测试文件，无碍。
    const holder = window as unknown as { confirm?: (message: string) => boolean };
    const hadOwn = Object.getOwnPropertyNames(holder).includes('confirm');
    holder.confirm = holder.confirm ?? (() => true);
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

/**
 * #73 undo/redo + update 异常语义（store 层，快照栈裁决）。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * 变异集 scripts/mutation-sets/editor-undo-73.mjs，与本文件 + app-assembly.test.ts
 * 配套；钉的是 state.ts 快照栈三面——undo/redo 双栈回填、上限 50 挤出、
 * loadPack 整树替换截断历史、update 先快照后执行抛错整树回滚（rollback 事件 +
 * 异常传播）、以及「新提交清空重做栈」。
 */
describe('#73 · undo/redo 快照栈（store 层）', () => {
  const enemyCount = (store: ReturnType<typeof createStore>): number =>
    (store.state.pack['enemies'] as unknown[]).length;

  it('update 后可撤销：undo 回到前值、history 事件、包引用换新', () => {
    const store = xiuxianStore();
    const before = enemyCount(store);
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((pack) => {
      (pack['enemies'] as unknown[]).pop(); // 模拟误删条目
    });
    expect(enemyCount(store)).toBe(before - 1);
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);

    listener.mockClear();
    expect(store.undo()).toBe(true);
    expect(enemyCount(store)).toBe(before);
    expect(listener).toHaveBeenCalledWith(store.state, 'history');
    // 回滚进来的树是新对象（渲染树活引用须重绑的契约面）。
    expect(store.state.pack).not.toBe(xiuxianPackJson);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it('redo 复原被撤销的改动后重做栈归零', () => {
    const store = xiuxianStore();
    const before = enemyCount(store);
    store.update((pack) => {
      (pack['enemies'] as unknown[]).pop();
    });
    store.undo();

    expect(store.redo()).toBe(true);
    expect(enemyCount(store)).toBe(before - 1);
    expect(store.canRedo()).toBe(false);
    expect(store.canUndo()).toBe(true);
  });

  it('undo 后的新提交清空重做栈（分叉历史即弃）', () => {
    const store = xiuxianStore();
    const hpOf = (): unknown => (store.state.pack['enemies'] as { hp: number }[])[0]!.hp;
    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 1;
    });
    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 2;
    });
    expect(store.undo()).toBe(true);
    expect(hpOf()).toBe(1);

    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 3;
    });
    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.undo()).toBe(true);
    expect(hpOf()).toBe(1); // hp=2 的旧线已不可达
  });

  it('误切 oneOf 分支（replace 形结构写）同样可撤销', () => {
    const store = xiuxianStore();
    const before = JSON.stringify((store.state.pack['enemies'] as unknown[])[0]);
    store.update((pack) => {
      (pack['enemies'] as unknown[])[0] = { id: 'swapped', type: 'claw' }; // 模拟误切分支整条替换
    });
    expect(JSON.stringify((store.state.pack['enemies'] as unknown[])[0])).not.toBe(before);

    expect(store.undo()).toBe(true);
    expect(JSON.stringify((store.state.pack['enemies'] as unknown[])[0])).toBe(before);
  });

  it(`快照栈上限 ${HISTORY_LIMIT}：最早的版本被挤出，撤满 ${HISTORY_LIMIT} 次后停在第 1 版`, () => {
    const store = xiuxianStore();
    const hpOf = (): number => (store.state.pack['enemies'] as { hp: number }[])[0]!.hp;
    for (let i = 1; i <= HISTORY_LIMIT + 1; i += 1) {
      store.update((pack) => {
        (pack['enemies'] as { hp: number }[])[0]!.hp = i;
      });
    }
    expect(hpOf()).toBe(HISTORY_LIMIT + 1);
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      expect(store.undo()).toBe(true);
    }
    expect(store.canUndo()).toBe(false);
    expect(hpOf()).toBe(1); // 载入基底（hp 初值）已越界被挤出
    expect(store.redo()).toBe(true);
    expect(hpOf()).toBe(2);
  });

  it('loadPack 整树替换截断历史（双向栈清空 + 清脏）', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      (pack['enemies'] as unknown[]).pop();
    });
    expect(store.canUndo()).toBe(true);

    const result = store.loadPack(xiuxianPackJson);
    expect(result.ok).toBe(true);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.state.dirty).toBe(false);
  });

  it('无包/无历史时 undo/redo 返回 false 不抛', () => {
    const empty = createStore();
    expect(empty.undo()).toBe(false);
    expect(empty.redo()).toBe(false);
    expect(empty.canUndo()).toBe(false);
    expect(empty.canRedo()).toBe(false);
  });

  it('setSection 是 UI 态不进历史；undo/redo 不动当前节', () => {
    const store = xiuxianStore();
    store.setSection('enemies');
    expect(store.canUndo()).toBe(false);

    store.update((pack) => {
      (pack['enemies'] as unknown[]).pop();
    });
    expect(store.undo()).toBe(true);
    expect(store.state.section).toBe('enemies');
  });

  it('undo/redo 一律标脏（保守语义：退回原值也不自动熄「未导出改动」）', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 999;
    });
    expect(store.state.dirty).toBe(true);
    store.undo();
    expect(store.state.dirty).toBe(true);
    store.redo();
    expect(store.state.dirty).toBe(true);
  });
});

describe('#73 · update(fn) 异常语义：先快照后执行，抛错整树回滚', () => {
  it('fn 半途抛错：包回到 fn 前值、异常向调用方传播、发 rollback 事件', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 100; // 先立一个干净基线
    });
    const baseline = JSON.stringify(store.state.pack);
    const baselineRef = store.state.pack;
    const listener = vi.fn();
    store.subscribe(listener);

    const boom = new Error('boom');
    expect(() =>
      store.update((pack) => {
        (pack['enemies'] as { hp: number }[])[0]!.hp = 1; // 半途写入
        (pack['enemies'] as unknown[]).pop(); // 再来一处——两处都必须被回滚
        throw boom;
      }),
    ).toThrow(boom);

    expect(JSON.stringify(store.state.pack)).toBe(baseline);
    // 包引用已换（DOM 活引用重绑契约）；dirty 与抛错前一致。
    expect(store.state.pack).not.toBe(baselineRef);
    expect(store.state.dirty).toBe(true);
    expect(listener).toHaveBeenCalledWith(store.state, 'rollback');
  });

  it('干净包上首笔更新就抛错：包回到原值且不脏', () => {
    const store = xiuxianStore();
    const baseline = JSON.stringify(store.state.pack);
    expect(() =>
      store.update(() => {
        throw new Error('first-write boom');
      }),
    ).toThrow('first-write boom');
    expect(JSON.stringify(store.state.pack)).toBe(baseline);
    expect(store.state.dirty).toBe(false);
  });

  it('抛错不进历史栈：canUndo/canRedo 与抛错前一致，undo 仍回到上次成功提交', () => {
    const store = xiuxianStore();
    const hpOf = (): number => (store.state.pack['enemies'] as { hp: number }[])[0]!.hp;
    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 100;
    });
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);

    expect(() =>
      store.update((pack) => {
        (pack['enemies'] as { hp: number }[])[0]!.hp = 1;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);

    expect(store.undo()).toBe(true);
    expect(hpOf()).toBe((xiuxianPackJson as { enemies: { hp: number }[] }).enemies[0]!.hp);
  });

  it('回滚后 store 可正常继续编辑（无残留半途态）', () => {
    const store = xiuxianStore();
    const hpOf = (): number => (store.state.pack['enemies'] as { hp: number }[])[0]!.hp;
    expect(() =>
      store.update((pack) => {
        (pack['enemies'] as { hp: number }[])[0]!.hp = 1;
        throw new Error('boom');
      }),
    ).toThrow('boom');

    store.update((pack) => {
      (pack['enemies'] as { hp: number }[])[0]!.hp = 777;
    });
    expect(hpOf()).toBe(777);
    expect(store.state.dirty).toBe(true);
    expect(store.undo()).toBe(true);
    expect(hpOf()).toBe((xiuxianPackJson as { enemies: { hp: number }[] }).enemies[0]!.hp);
  });
});
