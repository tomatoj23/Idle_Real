// @vitest-environment happy-dom
/**
 * #37 验收（壳 UI 缝）：乾坤袋视图堆叠 + 一键出售/熔炼（阈值）+ 装备锁定。
 *
 * - 堆叠 = 视图分组非数据堆叠：同质散件合并一行 ×N，任一差异（含稀有度）分开；
 * - 整堆卖/熔 → gear:sell-all / gear:smelt-all（uids 白名单，单动作）；
 * - 一键工具条：阈值选择（rarities 数组序）+ 批量按钮，锁定件跳过；
 * - 锁定件卖出/熔炼按钮禁用（D2 防手滑），锁定/解锁按钮整堆翻转。
 *
 * 夹具壳文案只配被测键，其余键名回显（防御路径与生产同码）。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 最小包：单档器胚剑 + 器屑经济 + 三档词表（数组序 = 档位序）。 */
function makePack(): ContentPack {
  return {
    skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
    items: [
      { id: 'gear_shard', name: '器屑', icon: '屑', type: 'mat', sell: 8 },
      { id: 'sword', name: '试炼剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, bonuses: { atk: 5 } },
    ],
    recipes: [],
    enemies: [],
    gearDrops: [],
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1, smelt: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2, smelt: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4, smelt: 4 },
    ],
    affixPool: [],
    combatText: {},
    config: {
      slots: [{ id: 'weapon', name: '法器' }],
      gear: { shardItem: 'gear_shard', reforgeCost: 2, tagWeightPerMatch: 1 },
    },
    texts: {
      shell: {
        brand: { sigil: '道', name: '试炼', locale: 'zh-CN', bootError: '中止：{message}' },
        topbar: { statsTitle: '属', statsSigil: '斗', goldTitle: '灵石', goldSigil: '石', hpTitle: '气血', hpSigil: '血' },
        tabs: { skills: '修', combat: '斗', bag: '袋', shop: '市' },
        stats: { labels: { atk: { label: '攻' } } },
        units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
        icons: { buff: '丹', gear: '器', unknown: '？' },
        common: { needLevel: '需 {level} 层', compareWrap: '（{compare}）', itemListSep: '、' },
        events: {
          sellAllLog: '售出 {count} 件，得 {gained} 文',
          smeltAllLog: '熔得 {shard}×{shards}（{count} 件）',
          batchLockedSkip: '（避锁 {count}）',
        },
        pages: {
          bag: {
            title: '袋', matGroup: '材料', consumableGroup: '丹药', priceEach: '每件 {price} 灵石',
            sellOneBtn: '卖一', sellAllBtn: '全卖', gearWorn: '佩戴中', gearLoose: '囊中',
            emptyWorn: '未佩戴', emptyLoose: '囊中无物', emptyAll: '空空如也', noAffix: '无属性',
            wearBtn: '佩戴', takeOffBtn: '卸下', sellBtn: '卖出', smeltBtn: '熔炼',
            sellStackBtn: '全卖', smeltStackBtn: '全熔',
            lockBtn: '锁定', unlockBtn: '解锁',
            clearCap: '≤{rarity}', clearSellBtn: '一键出售', clearSmeltBtn: '一键熔炼',
            reforgeBtn: '重铸', inscTier: 'T{tier}', inscCondition: '（受{element}）',
          },
        },
      },
    },
    shop: [],
  } as unknown as ContentPack;
}

interface GearSpec {
  uid: number;
  rarity?: string;
  locked?: boolean;
}

function makeSave(gear: GearSpec[], equips: Record<string, number> = {}, gold = 0): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold,
      hp: 100,
      items: {},
      skills: { fight: { xp: 0 } },
      activity: null,
      gear: gear.map((spec) => ({
        uid: spec.uid,
        itemId: 'sword',
        rarity: spec.rarity ?? 'common',
        affixes: [],
        ...(spec.locked ? { locked: true } : {}),
      })),
      equips,
      buffs: {},
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: {},
    },
  };
}

function mount(save: SaveData): {
  root: HTMLElement;
  game: ReturnType<typeof createGame>;
  ui: ReturnType<typeof buildUi>;
} {
  const content = makePack();
  const game = createGame({ content, clock: new ManualClock(), save });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, game, ui };
}

const toBag = (root: HTMLElement): void => {
  (root.querySelector('[data-act=tab][data-tab=bag]') as HTMLElement).click();
};

describe('#37 · 视图堆叠（同质合并 ×N，差异分开）', () => {
  it('同模板+同稀有度合并一行 ×N；稀有度不同即分开（整堆按钮带 uids 表）', () => {
    const { root } = mount(makeSave([{ uid: 1 }, { uid: 2 }, { uid: 3 }, { uid: 4, rarity: 'fine' }]));
    toBag(root);
    const cards = root.querySelectorAll('.gear-card');
    expect(cards).toHaveLength(2); // 3 件 common 并一堆 + 1 件 fine 单独
    expect(cards[0]!.textContent).toContain('×3');
    expect(cards[1]!.textContent).not.toContain('×');
    const stackSell = cards[0]!.querySelector('[data-act=sell-stack]');
    expect(stackSell?.getAttribute('data-uids')).toBe('1,2,3');
    // 单件（×1）走既有单件动作面（事件/飘字口径不变）。
    expect(cards[1]!.querySelector('[data-act=sell-gear]')?.getAttribute('data-uid')).toBe('4');
  });

  it('整堆卖 → gear:sell-all(uids) 单动作处置整堆；整堆熔按档位合计器屑', () => {
    const { root, game } = mount(makeSave([{ uid: 1 }, { uid: 2 }, { uid: 3 }]));
    toBag(root);
    (root.querySelector('[data-act=sell-stack]') as HTMLElement).click();
    expect(game.snapshot().state.gold).toBe(90); // 3×30（common sell 倍率 1）
    expect((game.snapshot().state as unknown as { gear: unknown[] }).gear).toHaveLength(0);
    expect(root.querySelectorAll('.gear-card')).toHaveLength(0);

    const again = mount(makeSave([{ uid: 1 }, { uid: 2 }]));
    toBag(again.root);
    (again.root.querySelector('[data-act=smelt-stack]') as HTMLElement).click();
    expect((again.game.snapshot().state as unknown as { items: Record<string, number> }).items['gear_shard']).toBe(2);
  });

  it('堆叠行佩戴走堆内首件（同质等价，AC4 佩戴无回归）：佩戴后堆余 ×N−1', () => {
    const { root, game, ui } = mount(makeSave([{ uid: 1 }, { uid: 2 }, { uid: 3 }]));
    toBag(root);
    const stack = root.querySelector('[data-act=sell-stack]')!.closest('.gear-card')!;
    stack.querySelector<HTMLElement>('[data-act=wear]')!.click();
    ui.render(); // rAF 去抖重绘在 happy-dom 不即时，手动触发同码渲染
    const st = game.snapshot().state as unknown as {
      equips: Record<string, number>;
      gear: Array<{ uid: number }>;
    };
    expect(st.equips['weapon']).toBe(1); // 堆内首件
    expect(st.gear.map((g) => g.uid)).toEqual([1, 2, 3]); // 实例数据形状不动
    const texts = Array.from(root.querySelectorAll('.gear-card')).map((c) => c.textContent);
    expect(texts.some((t) => t!.includes('×2'))).toBe(true); // 余堆合并展示
  });
});

describe('#37 · 一键清存量工具条（阈值）', () => {
  it('阈值选项随 rarities 数组序；一键出售按阈值处置全部散件、锁定件跳过（汇总飘字带跳过后缀）', () => {
    const { root, game } = mount(
      makeSave([{ uid: 1 }, { uid: 2 }, { uid: 3, rarity: 'fine' }, { uid: 4, rarity: 'rare' }, { uid: 5, locked: true }]),
    );
    toBag(root);
    const select = root.querySelector<HTMLSelectElement>('.bag-clear select');
    expect(Array.from(select?.options ?? []).map((o) => o.value)).toEqual(['common', 'fine', 'rare']);
    expect(Array.from(select?.options ?? []).map((o) => o.textContent)).toEqual(['≤寻常', '≤精良', '≤罕见']);

    select!.value = 'fine';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    (root.querySelector('[data-act=clear-sell]') as HTMLElement).click();
    // ≤fine：uid 1/2（common）+ uid 3（fine）= 30+30+60；uid 4（rare）门外、uid 5 锁定跳过。
    expect(game.snapshot().state.gold).toBe(120);
    const st = game.snapshot().state as unknown as { gear: Array<{ uid: number }> };
    expect(st.gear.map((g) => g.uid)).toEqual([4, 5]);
    expect(root.querySelector('#float-stack')?.textContent).toContain('售出 3 件，得 120 文');
    expect(root.querySelector('#float-stack')?.textContent).toContain('（避锁 1）');
  });

  it('阈值升到顶档可清全部散件；零可处置（全锁定）时批量按钮禁用', () => {
    const { root, game } = mount(makeSave([{ uid: 1 }, { uid: 2, locked: true }]));
    toBag(root);
    const sell = root.querySelector<HTMLButtonElement>('[data-act=clear-sell]');
    expect(sell?.disabled).toBe(false);
    (sell as HTMLElement).click();
    expect(game.snapshot().state.gold).toBe(30);
    // 只剩锁定件：重绘后一键按钮禁用（判定走引擎 planGearBatch 同源）。
    expect(root.querySelector<HTMLButtonElement>('[data-act=clear-sell]')?.disabled).toBe(true);
  });
});

describe('#37 · 装备锁定（整堆翻转 + 防手滑禁用）', () => {
  it('锁定按钮整堆置锁：卖出/熔炼按钮禁用、按钮翻为解锁；解锁原样恢复', () => {
    const { root, game } = mount(makeSave([{ uid: 1 }, { uid: 2 }]));
    toBag(root);
    const lock = root.querySelector('[data-act=lock]');
    expect(lock?.getAttribute('data-uids')).toBe('1,2');
    (lock as HTMLElement).click();
    const st = game.snapshot().state as unknown as { gear: Array<{ uid: number; locked?: boolean }> };
    expect(st.gear.every((g) => g.locked === true)).toBe(true); // 整堆置锁

    let sell = root.querySelector<HTMLButtonElement>('[data-act=sell-stack]');
    expect(sell?.disabled).toBe(true); // D2 防手滑：禁用可见
    expect(root.querySelector('[data-act=unlock]')).not.toBeNull();
    // 单件卖出同律（锁定件单件按钮禁用）。
    expect(root.querySelectorAll('.gear-card .btn[disabled]').length).toBeGreaterThan(0);

    (root.querySelector('[data-act=unlock]') as HTMLElement).click();
    sell = root.querySelector<HTMLButtonElement>('[data-act=sell-stack]');
    expect(sell?.disabled).toBe(false);
    expect(root.querySelector('[data-act=lock]')).not.toBeNull();
    expect((game.snapshot().state as unknown as { gear: Array<{ locked?: boolean }> }).gear.every((g) => g.locked !== true)).toBe(true);
  });
});
