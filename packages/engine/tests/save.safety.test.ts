import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  cloneState,
  createGame,
  decodeSave,
  initialState,
  localStorageSaveAdapter,
  restoreState,
  saveRejection,
  SAVE_VERSION,
  type GameState,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #69 存档数据安全批（engine 侧）：票面列的同域「静默降级」缺陷收口。
 *
 * 分工（读侧门禁 → 写侧保槽 → 恢复消毒 → 快照隔离）：
 * - `SAVE_VERSION` 写侧标记与读侧门禁同源，异型档显式拒绝（项 1）；
 * - `decodeSave` + `onProblem`：坏档/异型档/写失败不再是「null 且零线索」（项 3）；
 * - 保槽只针对**自证是异格式的真档**：拒绝加载还把它覆掉 = 白拒；而不成形的碎片
 *   不值得为它永久断掉存档能力（saveRejection.holdSlot 记着这条分界）；
 * - 字段表 map 行统一自有键域 + 污染键黑名单（项 4）；
 * - `cloneState` 透传键深拷，壳层改写快照不再写穿引擎态（项 5）。
 */

const content = makeCombatPack();

/** 存档字面量（version 可变，故走 unknown 通道——门禁是运行时的事）。 */
function saveOf(state: unknown, version: unknown = SAVE_VERSION): SaveData {
  return { version, time: 0, state } as unknown as SaveData;
}

describe('#69 · 存档版本门禁（项 1：有号无检）', () => {
  it('snapshot 写侧标记 = SAVE_VERSION（写读同源，不再有号无检）', () => {
    const game = createGame({ content, clock: new ManualClock() });
    expect(game.snapshot().version).toBe(SAVE_VERSION);
  });

  it('高版本档（未来引擎写的 v2）在 restoreState 入口显式拒绝', () => {
    expect(() => restoreState(content, saveOf({ gold: 1 }, 2), 1)).toThrow(/version 2/);
  });

  it('缺 version / 非对象档同律拒绝（异型档不止「版本不符」一种形态）', () => {
    // 缺字段用真字面量造（saveOf 的默认参数会把 undefined 补成合法版本）。
    expect(() =>
      restoreState(content, { time: 0, state: { gold: 1 } } as unknown as SaveData, 1),
    ).toThrow(/no version/);
    expect(() => restoreState(content, 'not-a-save' as unknown as SaveData, 1)).toThrow(
      /not a save object/,
    );
    expect(() => restoreState(content, saveOf({ gold: 1 }, null), 1)).toThrow(/version null/);
    expect(() => restoreState(content, saveOf({ gold: 1 }, '1'), 1)).toThrow(/version "1"/);
  });

  it('createGame 全链同律：异型档不产出半新半旧的运行态', () => {
    expect(() => createGame({ content, clock: new ManualClock(), save: saveOf({ gold: 1 }, 2) })).toThrow(
      /version 2/,
    );
    // 合法档不回归。
    const game = createGame({ content, clock: new ManualClock(), save: saveOf({ gold: 42 }) });
    expect(game.snapshot().state.gold).toBe(42);
  });

  it('saveRejection 是纯判定：合法档 undefined，异型档给原因 + 保槽位', () => {
    expect(saveRejection({ version: SAVE_VERSION, time: 0, state: {} })).toBeUndefined();
    expect(saveRejection({ version: 999, time: 0 })).toMatchObject({
      message: expect.stringMatching(/version 999/),
      holdSlot: true,
    });
    // 非档/缺版本：拒绝加载，但那字节不自证是存档 → 不保槽（不得永久断存档能力）。
    expect(saveRejection(null)).toMatchObject({ holdSlot: false });
    expect(saveRejection([])).toMatchObject({ message: /not a save object/, holdSlot: false });
    expect(saveRejection({ time: 0 })).toMatchObject({ message: /no version/, holdSlot: false });
  });
});

describe('#69 · decodeSave 读侧门禁与保槽判定（项 3 的判定核）', () => {
  it('真·无档（null/undefined/空串）：null 且零诊断、不保槽', () => {
    const problems: string[] = [];
    for (const raw of [null, undefined, '']) {
      const decoded = decodeSave(raw, (m) => problems.push(m));
      expect(decoded.save).toBeNull();
      expect(decoded.holdSlot).toBe(false);
    }
    expect(problems).toEqual([]);
  });

  it('碎片与异型档分两律：坏 JSON 只出诊断，异型档另加保槽', () => {
    const problems: string[] = [];
    const broken = decodeSave('{broken json', (m) => problems.push(m));
    expect(broken.save).toBeNull();
    expect(broken.holdSlot).toBe(false); // 半写/截断的碎片不证明自己有保住的价值
    expect(problems.join('\n')).toMatch(/parse/);

    const mismatched = decodeSave(JSON.stringify({ version: 2, time: 0, state: {} }), (m) =>
      problems.push(m),
    );
    expect(mismatched.save).toBeNull();
    expect(mismatched.holdSlot).toBe(true); // 自证是别处的真存档
    expect(problems.at(-1)).toMatch(/version 2/);
  });

  it('合法档：交出 SaveData、零诊断、不保槽；不传诊断回调时结论一致（默认行为不变）', () => {
    const payload = JSON.stringify({ version: SAVE_VERSION, time: 7, state: { gold: 3 } });
    const problems: string[] = [];
    const decoded = decodeSave(payload, (m) => problems.push(m));
    expect(decoded.save).toEqual(JSON.parse(payload));
    expect(decoded.holdSlot).toBe(false);
    expect(problems).toEqual([]);
    expect(decodeSave(payload).holdSlot).toBe(false);
    expect(decodeSave('{broken').holdSlot).toBe(false);
  });
});

/** localStorage 桩：可注入读/写故障，store 供断言「槽位字节是否被动过」。 */
function stubStorage(harness: {
  store?: Map<string, string>;
  getItemThrows?: unknown;
  setItemThrows?: unknown;
} = {}): Map<string, string> {
  const store = harness.store ?? new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      if (harness.getItemThrows !== undefined) throw harness.getItemThrows;
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (harness.setItemThrows !== undefined) throw harness.setItemThrows;
      store.set(key, value);
    },
  });
  return store;
}

const KEY = 'wendao_save_test';

describe('#69 · localStorageSaveAdapter 诊断面 + 异型档保槽', () => {
  it('正常档往返不回归，零诊断', () => {
    const store = stubStorage();
    const problems: string[] = [];
    const adapter = localStorageSaveAdapter(KEY, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull(); // 缺档 = 静默无档（旧语义保留）
    const data = saveOf({ gold: 3 });
    adapter.save(data);
    expect(adapter.load()).toEqual(data);
    expect(store.get(KEY)).toBe(JSON.stringify(data));
    expect(problems).toEqual([]);
  });

  it('坏档（碎片）：load 仍 null + 说出原因，且照常可写——旧行为不回归', () => {
    const store = stubStorage({ store: new Map([[KEY, '{broken']]) });
    const problems: string[] = [];
    const adapter = localStorageSaveAdapter(KEY, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();
    expect(problems.join('\n')).toMatch(/parse/);
    adapter.save(saveOf({ gold: 99 }));
    expect(store.get(KEY)).not.toBe('{broken'); // 碎片不值得为它永久断掉存档能力
    expect(problems.some((m) => /refus/i.test(m))).toBe(false);
  });

  it('异型档（v2）保槽：拒绝加载 ≠ 允许抹掉，且只报一次不刷屏', () => {
    const v2 = JSON.stringify({ version: 2, time: 0, state: { gold: 7 } });
    const store = stubStorage({ store: new Map([[KEY, v2]]) });
    const problems: string[] = [];
    const adapter = localStorageSaveAdapter(KEY, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();

    adapter.save(saveOf({ gold: 0 }));
    expect(store.get(KEY)).toBe(v2); // 那份真档原样留存
    expect(problems.filter((m) => /refus/i.test(m))).toHaveLength(1);
    adapter.save(saveOf({ gold: 1 })); // 后续周期自动保存同样被拒，但不再重复报
    expect(store.get(KEY)).toBe(v2);
    expect(problems.filter((m) => /refus/i.test(m))).toHaveLength(1);
  });

  it('保槽非单向棘轮：槽位换成合法档后读写恢复（换回旧引擎即自愈）', () => {
    const store = stubStorage({ store: new Map([[KEY, JSON.stringify({ version: 2, time: 0 })]]) });
    const adapter = localStorageSaveAdapter(KEY, { onProblem: () => {} });
    expect(adapter.load()).toBeNull();
    adapter.save(saveOf({ gold: 1 }));
    expect(store.get(KEY)).toMatch(/version":2/); // 仍在保
    store.set(KEY, JSON.stringify({ version: SAVE_VERSION, time: 0, state: { gold: 5 } }));
    expect(adapter.load()?.version).toBe(SAVE_VERSION);
    adapter.save(saveOf({ gold: 6 }));
    expect(store.get(KEY)).toBe(JSON.stringify(saveOf({ gold: 6 }))); // 写回来了
  });

  it('无诊断回调时不炸（异型档仍保槽）', () => {
    const store = stubStorage({
      store: new Map([[KEY, JSON.stringify({ version: 99, time: 0, state: {} })]]),
    });
    const adapter = localStorageSaveAdapter(KEY);
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save(saveOf({ gold: 1 }))).not.toThrow();
    expect(store.get(KEY)).toMatch(/version":99/);
  });

  it('写失败（隐私模式/配额满）：不抛错、游戏继续（旧语义），但不再无声（项 3 的第二处静默）', () => {
    stubStorage({ setItemThrows: new Error('QuotaExceededError') });
    const problems: string[] = [];
    const adapter = localStorageSaveAdapter(KEY, { onProblem: (m) => problems.push(m) });
    expect(() => adapter.save(saveOf({ gold: 1 }))).not.toThrow();
    expect(problems.join('\n')).toMatch(/QuotaExceededError/);
  });

  it('不传 onProblem 时写失败照旧静默、不崩（壳层未接线也不破）', () => {
    stubStorage({ setItemThrows: new Error('QuotaExceededError') });
    const adapter = localStorageSaveAdapter(KEY);
    expect(() => adapter.save(saveOf({ gold: 1 }))).not.toThrow();
  });

  it('读通道故障（getItem 抛错）：出诊断但不碰保槽态——既没证明有货也没证明没货', () => {
    stubStorage({ getItemThrows: new Error('SecurityError') });
    const problems: string[] = [];
    const adapter = localStorageSaveAdapter(KEY, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();
    expect(problems.join('\n')).toMatch(/SecurityError/);
    adapter.save(saveOf({ gold: 1 })); // 写路径未被钉住
    expect(problems.some((m) => /refus/i.test(m))).toBe(false);
  });
});

describe('#69 · 存档 map 字段的原型污染面（项 4）', () => {
  // JSON.parse 造 own property 形态的 __proto__（与真实坏档同构，非对象字面量语义）。
  it('skills 行：__proto__ 不再换掉技能表原型，constructor 不再成技能键', () => {
    const raw = JSON.parse(
      '{"skills":{"__proto__":{"xp":7},"constructor":{"xp":1},"hasOwnProperty":{"xp":2},"herb":{"xp":5}}}',
    ) as Record<string, unknown>;
    const state = restoreState(content, saveOf(raw), 1);
    expect(Object.getPrototypeOf(state.skills)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(state.skills)).not.toContain('constructor');
    expect(Object.getOwnPropertyNames(state.skills)).not.toContain('hasOwnProperty');
    expect((state.skills as unknown as Record<string, unknown>).xp).toBeUndefined();
    expect(state.skills.herb).toEqual({ xp: 5 }); // 合法键照常收编
  });

  it('skills 行：内容包没有的技能键不收编（自有键域，原型链命中不算）', () => {
    const raw = JSON.parse('{"skills":{"noSuchSkill":{"xp":9},"fight":{"xp":12}}}') as Record<
      string,
      unknown
    >;
    const state = restoreState(content, saveOf(raw), 1);
    expect(Object.hasOwn(state.skills, 'noSuchSkill')).toBe(false);
    expect(state.skills.fight).toEqual({ xp: 12 });
  });

  it('items 行：污染键不入袋，袋面方法不被数值键顶掉', () => {
    const raw = JSON.parse(
      '{"items":{"hasOwnProperty":5,"constructor":6,"__proto__":7,"prototype":8,"herb1":3}}',
    ) as Record<string, unknown>;
    const state = restoreState(content, saveOf(raw), 1);
    expect(Object.getOwnPropertyNames(state.items)).toEqual(['herb1']);
    expect(state.items.herb1).toBe(3);
  });

  it('equips/buffs/dungeonBest/lastEncounter 行同律：污染键不入库（值域/内容域本已挡，键域收口统一）', () => {
    const raw = JSON.parse(
      '{' +
        '"gear":[{"uid":2,"itemId":"sword1","rarity":"common","affixes":[]}],' +
        '"equips":{"__proto__":2,"constructor":2,"hasOwnProperty":2,"prototype":2,"weapon":2},' +
        '"buffs":{"__proto__":99999,"constructor":99999,"consumable_atk":99999},' +
        '"lastEncounter":{"__proto__":{"rounds":3,"won":true,"at":1},"e1":{"rounds":3,"won":true,"at":1}},' +
        '"dungeonBest":{"__proto__":4,"crypt":4}' +
        '}',
    ) as Record<string, unknown>;
    const state = restoreState(content, saveOf(raw), 1);
    for (const map of [state.equips, state.buffs, state.lastEncounter, state.dungeonBest]) {
      const names = Object.getOwnPropertyNames(map as unknown as Record<string, unknown>);
      for (const key of ['__proto__', 'constructor', 'hasOwnProperty', 'prototype']) {
        expect(names).not.toContain(key);
      }
    }
    expect(state.equips.weapon).toBe(2); // 合法键不受影响
    expect(state.lastEncounter.e1).toEqual({ rounds: 3, won: true, at: 1 });
  });

  it('顶层透传区同黑名单（复用同一键集，不再各写一份三元判断）', () => {
    const raw = JSON.parse(
      '{"gold":4,"futureFlag":true,"__proto__":{"polluted":1},"constructor":5,"prototype":6,"hasOwnProperty":7}',
    ) as Record<string, unknown>;
    const state = restoreState(content, saveOf(raw), 1);
    const names = Object.getOwnPropertyNames(state);
    for (const key of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty']) {
      expect(names).not.toContain(key);
    }
    expect((state as unknown as Record<string, unknown>).futureFlag).toBe(true);
  });
});

describe('#69 · cloneState 透传键隔离（项 5）', () => {
  /** 透传键夹具：一个 JSON 形态的未知顶层键对象。 */
  function stateWithPassthrough(): GameState {
    const raw = JSON.parse('{"futureNote":{"text":"orig"},"deep":{"list":[{"n":1}]}}') as Record<
      string,
      unknown
    >;
    return restoreState(content, saveOf({ ...raw, gold: 5 }), 1);
  }

  it('壳层改写快照的透传键不写穿引擎态', () => {
    const state = stateWithPassthrough();
    const snap = cloneState(state);
    (snap as unknown as { futureNote: { text: string } }).futureNote.text = 'written';
    expect((state as unknown as { futureNote: { text: string } }).futureNote.text).toBe('orig');
  });

  it('相邻两次快照的透传键不互别（逐帧独立）', () => {
    const state = stateWithPassthrough();
    const first = cloneState(state);
    const second = cloneState(state);
    expect(
      (first as unknown as { deep: unknown }).deep,
    ).not.toBe((second as unknown as { deep: unknown }).deep);
    expect((first as unknown as { deep: unknown }).deep).toEqual(
      (second as unknown as { deep: unknown }).deep,
    );
  });

  it('引擎侧真链：snapshot → 改快照 → 再 snapshot，第二帧干净', () => {
    const game = createGame({ content, clock: new ManualClock(), save: saveOf({ gold: 5, futureNote: { text: 'orig' } }) });
    const first = game.snapshot().state as unknown as { futureNote: { text: string } };
    first.futureNote.text = 'written';
    const second = game.snapshot().state as unknown as { futureNote: { text: string } };
    expect(second.futureNote.text).toBe('orig');
  });

  it('透传标量原样存活（不做无谓的 JSON 往返）', () => {
    const state = restoreState(content, saveOf({ futureFlag: 7, gold: 1 }), 1);
    const clone = cloneState(state);
    expect((clone as unknown as Record<string, unknown>).futureFlag).toBe(7);
  });

  it('非 JSON 形态的透传值（循环引用）不炸快照：退化为共享引用', () => {
    const cyclic: Record<string, unknown> = { tag: 'cyc' };
    cyclic.self = cyclic;
    const state = { ...initialState(content, 1), future: cyclic } as unknown as GameState;
    const clone = cloneState(state) as unknown as { future: Record<string, unknown> };
    expect(clone.future).toBe(cyclic); // 循环不可 JSON 往返 —— 保留原语义而非抛错
    expect(clone.future.tag).toBe('cyc');
  });
});
