// @vitest-environment happy-dom
/**
 * #14 验收：乾坤袋装备卡——铭纹展示（纹阶着色/条件语境/addPct 量纲）、
 * 熔炼/重铸入口（器屑经济可用性门控）、按钮 → 引擎动作接线。
 * 壳零量纲特判/零题材字符串的既有纪律在此一并回归。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

const tiersOf = (rows: Array<Array<Record<string, unknown>>>) => rows;

/** 最小包：器屑经济 + 器胚 + 三条铭纹（flat/addPct/条件各一）。 */
function makePack(withEconomy = true): ContentPack {
  return {
    skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
    elements: [{ id: 'fire', name: '火' }],
    items: [
      { id: 'gear_shard', name: '器屑', icon: '屑', type: 'mat', sell: 8 },
      {
        id: 'blank',
        name: '凡铁剑胚',
        icon: '胚',
        type: 'blank',
        sell: 0,
        slot: 'weapon',
        floorRange: { min: 1, max: 5 },
        tierRange: { min: 1, max: 3 },
        preferredTags: ['offense'],
        inherentModifiers: [{ stat: 'atk', zone: 'flat', value: 4 }],
      },
      {
        id: 'insc_a',
        name: '裂石',
        icon: '锐',
        type: 'inscription',
        sell: 0,
        tiers: tiersOf([
          [{ stat: 'atk', zone: 'flat', value: 4 }],
          [{ stat: 'atk', zone: 'flat', value: 9 }],
          [{ stat: 'atk', zone: 'flat', value: 18 }],
        ]) as never,
        tags: ['offense'],
      },
      {
        id: 'insc_b',
        name: '燃血',
        icon: '燃',
        type: 'inscription',
        sell: 0,
        tiers: tiersOf([
          [{ stat: 'atk', zone: 'addPct', value: 4 }],
          [{ stat: 'atk', zone: 'addPct', value: 8 }],
          [{ stat: 'atk', zone: 'addPct', value: 15 }],
        ]) as never,
        tags: [],
      },
      {
        id: 'insc_c',
        name: '逆鳞',
        icon: '鳞',
        type: 'inscription',
        sell: 0,
        tiers: tiersOf([
          [{ stat: 'def', zone: 'flat', value: 6, condition: { element: 'fire' } }],
          [{ stat: 'def', zone: 'flat', value: 12, condition: { element: 'fire' } }],
          [{ stat: 'def', zone: 'flat', value: 24, condition: { element: 'fire' } }],
        ]) as never,
        tags: [],
      },
    ],
    recipes: [],
    enemies: [],
    gearDrops: [],
    rarities: [{ id: 'plain', name: '朴素', weight: 1, mult: 1, affix: 0, sell: 1, smelt: 2 }],
    affixPool: [],
    combatText: {},
    config: {
      slots: [{ id: 'weapon', name: '法器' }],
      ...(withEconomy ? { gear: { shardItem: 'gear_shard', reforgeCost: 2, tagWeightPerMatch: 1 } } : {}),
    },
    texts: {
      shell: {
        brand: { sigil: '道', name: '试炼', locale: 'zh-CN', bootError: '中止：{message}' },
        topbar: { statsTitle: '属', statsSigil: '斗', goldTitle: '灵石', goldSigil: '石', hpTitle: '气血', hpSigil: '血' },
        tabs: { skills: '修', combat: '斗', bag: '袋', shop: '市' },
        side: { title: '录' },
        stats: { labels: { atk: { label: '攻' }, def: { label: '防' } } },
        units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
        icons: { buff: '丹', gear: '器', unknown: '？' },
        common: { needLevel: '需 {level} 层', compareWrap: '（{compare}）', itemListSep: '、' },
        events: { gearSmelt: '熔炼【{name}】，得 {shard}×{count}', gearReforge: '重铸【{name}】，铭纹升至 T{tier}' },
        pages: {
          bag: {
            title: '袋', matGroup: '材料', consumableGroup: '丹药', priceEach: '每件 {price} 灵石',
            sellOneBtn: '卖一', sellAllBtn: '全卖', gearWorn: '佩戴中', gearLoose: '囊中',
            emptyWorn: '未佩戴', emptyLoose: '囊中无物', emptyAll: '空空如也', noAffix: '无属性',
            wearBtn: '佩戴', takeOffBtn: '卸下', sellBtn: '卖出',
            smeltBtn: '熔炼', reforgeBtn: '重铸', inscTier: 'T{tier}', inscCondition: '（受{element}）',
          },
        },
      },
    },
    shop: [],
  } as unknown as ContentPack;
}

function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 100,
      items: { gear_shard: 10 },
      skills: { fight: { xp: 0 } },
      activity: null,
      gear: [
        {
          uid: 1,
          itemId: 'blank',
          rarity: 'plain',
          affixes: [],
          inscriptions: [
            { id: 'insc_a', tier: 1 },
            { id: 'insc_b', tier: 2 },
            { id: 'insc_c', tier: 3 },
          ],
        },
      ],
      equips: {},
      buffs: {},
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: {},
    },
  };
}

function mount(content: ContentPack, save: SaveData): {
  root: HTMLElement;
  game: ReturnType<typeof createGame>;
  ui: ReturnType<typeof buildUi>;
} {
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

describe('#14 · 乾坤袋装备卡：铭纹展示与熔炼/重铸入口', () => {
  it('铭纹行按纹阶着色（t1/t2/t3），徽标与数值/量纲/条件语境随内容数据', () => {
    const { root } = mount(makePack(), makeSave());
    toBag(root);
    expect(root.querySelectorAll('.insc')).toHaveLength(3);
    expect(root.querySelectorAll('.insc-t1')).toHaveLength(1);
    expect(root.querySelectorAll('.insc-t2')).toHaveLength(1);
    expect(root.querySelectorAll('.insc-t3')).toHaveLength(1);
    const small = root.querySelector('.gear-name small')!.textContent ?? '';
    expect(small).toContain('T1');
    expect(small).toContain('T3');
    expect(small).toContain('攻+4'); // flat 量纲（insc_a T1）
    expect(small).toContain('攻+8%'); // addPct 带 % 后缀（insc_b T2）
    expect(small).toContain('防+24（受火）'); // 条件语境 = elements 展示名（insc_c T3）
  });

  it('器屑经济可用时渲染熔炼/重铸入口；点击接通引擎动作（器屑扣减/产出入袋）', () => {
    const { root, game, ui } = mount(makePack(), makeSave());
    toBag(root);
    expect(root.querySelectorAll('[data-act=smelt-gear]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-act=reforge]')).toHaveLength(3);

    // 重铸 index0：器屑按 reforgeCost 扣减，纹阶仍落在器胚 tierRange 域内。
    (root.querySelector('[data-act=reforge]') as HTMLElement).click();
    ui.render(); // rAF 去抖重绘在 happy-dom 不即时，手动触发同码渲染
    let st = game.snapshot().state as { items: Record<string, number>; gear: Array<{ inscriptions?: Array<{ tier: number }> }> };
    expect(st.items['gear_shard']).toBe(8); // 10 − reforgeCost 2
    expect(st.gear[0]!.inscriptions![0]!.tier).toBeGreaterThanOrEqual(1);
    expect(st.gear[0]!.inscriptions![0]!.tier).toBeLessThanOrEqual(3);

    // 熔炼：实例移除 + 器屑按稀有度 smelt=2 入袋。
    (root.querySelector('[data-act=smelt-gear]') as HTMLElement).click();
    ui.render();
    st = game.snapshot().state as typeof st;
    expect((st.gear as unknown[]).length).toBe(0);
    expect(st.items['gear_shard']).toBe(10); // 8 + smelt 2
    expect(root.querySelectorAll('.gear-card')).toHaveLength(0);
  });

  it('无 shardItem 配置 = 无器屑经济：入口不渲染（引擎 not-available 的壳面同款）', () => {
    const { root } = mount(makePack(false), makeSave());
    toBag(root);
    expect(root.querySelectorAll('[data-act=smelt-gear]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-act=reforge]')).toHaveLength(0);
    expect(root.querySelectorAll('.insc')).toHaveLength(3); // 铭纹展示不受经济开关影响
  });
});
