import { describe, expect, it } from 'vitest';
import { packRecordOf, packSectionArray } from '../src/core/packSection.js';
import { applyCandidates, type Candidate } from '../src/llm/pipeline.js';
import { xiuxianStore } from './helpers.js';

/**
 * 包节安全访问器与坏形态守卫（#74 项 2）：包数据是外部输入，节形态
 * 不保证合法——节级读取一律经守卫单点，坏形态降级/跳过，禁止裸 `as`
 * 断言直取（旧码 combatText 缺失时 verbs/moves 直取即 TypeError）。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - applyCandidates 丢形态守卫（改回裸断言）→ combatText 缺失用例
 *   TypeError 红；
 * - 守卫降级丢 skipped 回填 → skipped 空数组断言红。
 */

/** 过节级 schema 的最小敌人候选（cross-ref 语义由整包校验另管）。 */
const VALID_ENEMY = {
  id: 'guard_beast', name: '守卫兽', icon: '守', level: 1, kind: 'claw',
  hp: 50, atk: 8, def: 2, attackInterval: 2400, exp: 15,
  gold: { min: 3, max: 9 }, drops: [],
};

function candidate(value: unknown): Candidate {
  return {
    value,
    label: typeof (value as { id?: unknown })?.id === 'string' ? (value as { id: string }).id : '?',
    errors: [],
    approved: true,
  };
}

describe('#74-2 · 访问器纯函数', () => {
  it('packSectionArray：数组节返回原引用；缺失/非数组返回 undefined', () => {
    const pack: Record<string, unknown> = { list: [1, 2], obj: { a: 1 } };
    expect(packSectionArray(pack, 'list')).toEqual([1, 2]);
    expect(packSectionArray(pack, 'obj')).toBeUndefined();
    expect(packSectionArray(pack, 'missing')).toBeUndefined();
  });

  it('packRecordOf：记录返回原引用；null/数组/标量返回 undefined', () => {
    expect(packRecordOf({ a: 1 })).toEqual({ a: 1 });
    expect(packRecordOf([1])).toBeUndefined();
    expect(packRecordOf(null)).toBeUndefined();
    expect(packRecordOf('x')).toBeUndefined();
    expect(packRecordOf(undefined)).toBeUndefined();
  });
});

describe('#74-2 · applyCandidates 坏形态守卫（不 TypeError，全部跳过）', () => {
  it('combatText.verbs 缺失（update 旁门写坏）：verbs 候选全跳过不炸', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      delete (pack['combatText'] as Record<string, unknown>)['verbs'];
    });
    const report = applyCandidates(store, 'verbs', [
      candidate({ key: 'fan', list: [{ v: '折扇轻摇', limbs: ['手腕'] }] }),
    ]);
    expect(report.applied).toBe(0);
    expect(report.skipped).toHaveLength(1);
  });

  it('combatText 整节缺失：enemies 照常入包不炸（旧码取 moves 时 TypeError），仅不注册招式', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      delete pack['combatText'];
    });
    const report = applyCandidates(store, 'enemies', [candidate(VALID_ENEMY)]);
    expect(report.applied).toBe(1);
    expect(report.movesRegistered).toBe(0);
  });

  it('目标节非数组：候选全跳过不炸', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      pack['enemies'] = 'oops';
    });
    const report = applyCandidates(store, 'enemies', [candidate(VALID_ENEMY)]);
    expect(report.applied).toBe(0);
    expect(report.skipped).toHaveLength(1);
  });

  it('仅 moves 缺省：敌人照常入包，只是不自动注册招式（降级不拦截）', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      delete (pack['combatText'] as Record<string, unknown>)['moves'];
    });
    const report = applyCandidates(store, 'enemies', [candidate(VALID_ENEMY)]);
    expect(report.applied).toBe(1);
    expect(report.movesRegistered).toBe(0);
    expect(report.skipped).toEqual([]);
  });
});
