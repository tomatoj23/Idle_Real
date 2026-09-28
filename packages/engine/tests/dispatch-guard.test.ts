import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, type GameAction, type GameContent } from '../src/index.js';

/**
 * dispatch 坏载荷防线（#75 复审回归）：载荷动作缺载荷/载荷 null 派发必须
 * 一律 reject bad-payload 且**不抛错**——载荷收型（readItemPayload 等）不得
 * 把旧 `p?.` 兜底换成直读（undefined 载荷曾可静默 TypeError 穿出 dispatch）。
 * 每动作独立开档，互不污染。
 */

/**
 * 全部带载荷的 GameAction type——**Record 穷尽锚**（#37 复核收口）：漏收任一
 * 载荷动作 = 编译红（缺 key 即类型错）。原 `satisfies readonly GameAction['type'][]`
 * 只验成员合法、不验穷尽，「漏收即编译红」是假腿——#37 四个载荷动作与
 * craft:auto/enemy:auto 曾长期漏收静默。载荷面经 Extract 排除无 payload 成员。
 */
type PayloadActions = Extract<GameAction, { payload: unknown }>;

const PAYLOAD_ACTIONS: Record<PayloadActions['type'], true> = {
  'activity:start': true,
  'bag:sell': true,
  'shop:buy': true,
  'combat:start': true,
  'visit:begin': true,
  'visit:end': true,
  'dungeon:enter': true,
  'consumable:eat': true,
  'gear:equip': true,
  'gear:unequip': true,
  'gear:sell': true,
  'gear:smelt': true,
  'gear:lock': true,
  'gear:unlock': true,
  'gear:sell-all': true,
  'gear:smelt-all': true,
  'gear:reforge': true,
  'talent:buy': true,
  'craft:auto': true,
  'enemy:auto': true,
};

/** talent:buy 判定序首关是 rebirth 节存在性（not-available），备空节占位过首关。 */
const content = { rebirth: {} } as unknown as GameContent;

function rejectOf(game: ReturnType<typeof createGame>): unknown[] {
  return game.events
    .drain()
    .filter((e) => e.type === 'reject')
    .map((e) => (e.data as { action: string; reason: string }).reason);
}

describe('dispatch 坏载荷防线（#75 复审回归）', () => {
  for (const type of Object.keys(PAYLOAD_ACTIONS) as PayloadActions['type'][]) {
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
