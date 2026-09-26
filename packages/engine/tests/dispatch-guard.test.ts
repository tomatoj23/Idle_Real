import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, type GameAction, type GameContent } from '../src/index.js';

/**
 * dispatch 坏载荷防线（#75 复审回归）：载荷动作缺载荷/载荷 null 派发必须
 * 一律 reject bad-payload 且**不抛错**——载荷收型（readItemPayload 等）不得
 * 把旧 `p?.` 兜底换成直读（undefined 载荷曾可静默 TypeError 穿出 dispatch）。
 * 每动作独立开档，互不污染。
 */

/** 全部带载荷的 GameAction type（手工清单；satisfies 锚定联合，改名/漏收即编译红）。 */
const PAYLOAD_ACTIONS = [
  'activity:start',
  'bag:sell',
  'shop:buy',
  'combat:start',
  'visit:begin',
  'visit:end',
  'dungeon:enter',
  'consumable:eat',
  'gear:equip',
  'gear:unequip',
  'gear:sell',
  'gear:smelt',
  'gear:reforge',
  'talent:buy',
] as const satisfies readonly GameAction['type'][];

/** talent:buy 判定序首关是 rebirth 节存在性（not-available），备空节占位过首关。 */
const content = { rebirth: {} } as unknown as GameContent;

function rejectOf(game: ReturnType<typeof createGame>): unknown[] {
  return game.events
    .drain()
    .filter((e) => e.type === 'reject')
    .map((e) => (e.data as { action: string; reason: string }).reason);
}

describe('dispatch 坏载荷防线（#75 复审回归）', () => {
  for (const type of PAYLOAD_ACTIONS) {
    it(`${type} 缺载荷派发 → bad-payload，不抛错`, () => {
      const game = createGame({ content, clock: new ManualClock() });
      expect(() => game.dispatch({ type } as unknown as GameAction)).not.toThrow();
      expect(rejectOf(game)).toEqual(['bad-payload']);
    });

    it(`${type} 载荷 null 派发 → bad-payload，不抛错`, () => {
      const game = createGame({ content, clock: new ManualClock() });
      expect(() =>
        game.dispatch({ type, payload: null } as unknown as GameAction),
      ).not.toThrow();
      expect(rejectOf(game)).toEqual(['bad-payload']);
    });
  }
});
