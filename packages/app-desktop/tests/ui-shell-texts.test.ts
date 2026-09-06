// @vitest-environment happy-dom
/**
 * #26 验收：壳零题材字符串、零公式复算——
 * - stat 展示标签与量纲（percent）由 texts.shell.stats.labels 声明，壳零特判；
 * - 装备倍率投影走引擎 projectGearBase（与 gearContributions 同式同源）；
 * - 坊市购买力走引擎 shopAffordOf（与 shop:buy 判定同源）；
 * - 事件文案随 texts.shell 模板走（改文案 = 纯 JSON 改动）。
 *
 * 夹具壳文案只配被测键，其余键名回显（防御路径与生产同码）。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import {
  createGame,
  ManualClock,
  projectGearBase,
  type GameAction,
  type SaveData,
} from '@wendao/engine';
import { buildUi } from '../src/ui';

interface Overrides {
  /** 稀有度倍率（铁律检验：改 JSON → 展示投影跟随）。 */
  readonly mult?: number;
  /** crit 量纲标记（缺省 = 无 percent 字段 = 点数量纲）。 */
  readonly critPercent?: boolean;
  /** atk 展示标签。 */
  readonly atkLabel?: string;
  /** 坊市售价。 */
  readonly price?: number;
  /** 卖出行文案模板。 */
  readonly sellLog?: string;
}

/** 最小包：单战斗技能 + 试炼剑（atk 5）+ 回气丹 + 单档词表。 */
function makePack(overrides: Overrides = {}): ContentPack {
  const critLabel: { label: string; percent?: boolean } = { label: '暴' };
  if (overrides.critPercent !== undefined) critLabel.percent = overrides.critPercent;
  return {
    skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
    items: [
      { id: 'sword', name: '试炼剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 10, bonuses: { atk: 5 } },
      { id: 'heal', name: '回气丹', icon: '回', type: 'consumable', sell: 18, heal: { percent: 0.3 } },
    ],
    recipes: [],
    enemies: [],
    gearDrops: [],
    rarities: [{ id: 'plain', name: '朴素', weight: 1, mult: overrides.mult ?? 1, affix: 0, sell: 1 }],
    affixPool: [],
    combatText: {},
    texts: {
      shell: {
        brand: { sigil: '道', name: '试炼', locale: 'zh-CN', bootError: '中止：{message}' },
        topbar: { statsTitle: '属', statsSigil: '斗', goldTitle: '灵石', goldSigil: '石', hpTitle: '气血', hpSigil: '血' },
        tabs: { skills: '修', combat: '斗', bag: '袋', shop: '市' },
        side: { title: '录' },
        stats: { labels: { atk: { label: overrides.atkLabel ?? '攻' }, crit: critLabel } },
        units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
        icons: { buff: '丹', gear: '器', unknown: '？' },
        common: { needLevel: '需 {level} 层', compareWrap: '（{compare}）', itemListSep: '、' },
        events: { sellLog: overrides.sellLog ?? '卖出 {name}，得 {gained} 灵石' },
        pages: {
          shop: { title: '市', subtitle: '易物', price: '{price} 灵石', owned: '持有 {count}', buyBtn: '买一' },
          bag: {
            title: '袋', matGroup: '材料', consumableGroup: '丹药', priceEach: '每件 {price} 灵石',
            sellOneBtn: '卖一', sellAllBtn: '全卖', gearWorn: '佩戴中', gearLoose: '囊中',
            emptyWorn: '未佩戴', emptyLoose: '囊中无物', emptyAll: '空空如也', noAffix: '无属性',
            wearBtn: '佩戴', takeOffBtn: '卸下', sellBtn: '卖出',
          },
        },
      },
    },
    shop: [{ item: 'heal', price: overrides.price ?? 45 }],
  } as unknown as ContentPack;
}

/** 带装备（crit 词条）与灵石的存档：装备卡 + 顶栏 stats + shop afford 三面共用。 */
function makeSave(gold: number, critAffix = false): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold,
      hp: 100,
      items: { heal: 1 },
      skills: { fight: { xp: 0 } },
      activity: null,
      gear: [
        {
          uid: 1,
          itemId: 'sword',
          rarity: 'plain',
          ...(critAffix ? { affixes: [{ name: '通明', stat: 'crit', val: 4 }] } : { affixes: [] }),
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

function mount(content: ContentPack, save?: SaveData): HTMLElement {
  const game = createGame({ content, clock: new ManualClock(), ...(save ? { save } : {}) });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return root;
}

describe('#26 · stat 标签与量纲由内容声明（壳零特判）', () => {
  it('标签随 statLabels：改 atk 标签 → 装备卡加成行跟随', () => {
    const root = mount(makePack({ atkLabel: '击', critPercent: false }), makeSave(0, true));
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    // 装备卡：标签来自内容（击），基础行无 %；crit 词条 percent 缺省 → 无 %
    expect(root.textContent).toContain('击+5');
    expect(root.textContent).toContain('暴+4');
    expect(root.textContent).not.toContain('%');
  });

  it('量纲随 percent bool：crit 声明 percent → 词条与顶栏都带 %（真包形态）', () => {
    const root = mount(makePack({ critPercent: true }), makeSave(0, true));
    // 顶栏：crit 读数带 %（数据驱动，非壳内 if）
    expect(root.querySelector('#res-stats')!.textContent).toMatch(/11\/3\/5%$/);
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    expect(root.textContent).toContain('暴+4%');
  });

  it('量纲随 percent bool：crit 未声明 percent → 顶栏与词条都无 %', () => {
    const root = mount(makePack({ critPercent: false }), makeSave(0, true));
    expect(root.querySelector('#res-stats')!.textContent).toMatch(/11\/3\/5$/);
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    expect(root.textContent).toContain('暴+4');
  });
});

describe('#26 · 倍率投影走引擎 projectGearBase（同式同源）', () => {
  it('改档位倍率 = 纯 JSON：展示值 = round(基础 × mult)，与引擎函数同值', () => {
    const content = makePack({ mult: 3, critPercent: false });
    const root = mount(content, makeSave(0));
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    expect(root.textContent).toContain('攻+15'); // round(5 × 3)
    // 与引擎展示投影同值（壳零第二份 ×mult 公式的证据链）
    const item = content.items.find((entry) => entry.id === 'sword');
    expect(projectGearBase(content, item?.bonuses ?? {}, 'plain')).toEqual([
      { stat: 'atk', value: 15 },
    ]);
  });
});

describe('#26 · 购买力走引擎 shopAffordOf（与判定同源）', () => {
  it('gold=100：改 price 45 → 可买；改 price 150 → 禁用（纯 JSON 联动）', () => {
    const cheap = mount(makePack({ price: 45 }), makeSave(100));
    cheap.querySelector<HTMLButtonElement>('.tab[data-tab="shop"]')!.click();
    expect(cheap.querySelector('.bag-row .btn.btn-disabled')).toBeNull();

    const dear = mount(makePack({ price: 150 }), makeSave(100));
    dear.querySelector<HTMLButtonElement>('.tab[data-tab="shop"]')!.click();
    expect(dear.querySelector('.bag-row .btn.btn-disabled')).not.toBeNull();
  });
});

describe('#26 · 事件文案随 texts.shell 模板走', () => {
  it('改 sellLog 模板 → 卖出行跟随（改文案 = 纯 JSON 改动）', () => {
    const content = makePack({ sellLog: '售出 {name} 得 {gained} 文' });
    const game = createGame({ content, clock: new ManualClock(), save: makeSave(0) });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    game.dispatch({ type: 'bag:sell', payload: { item: 'heal', count: 1 } });
    expect(root.querySelector('#log')?.textContent).toContain('售出 回气丹 得 18 文');
  });
});
