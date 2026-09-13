// @vitest-environment happy-dom
/**
 * #40 验收（壳层）：snapshot 战斗/活动视图投影——
 * - AC2 分叉免疫：引擎注入第三层 mock 修正（秘境层倍率后再 ×2），修正进入
 *   resolveEnemy 组合面，snapshot.enemy 与 DOM 展示同源跟随、零壳层改动；
 * - AC3 进度条与 gatherSpeed 天赋联动：点亮天赋后进度条速率即时变化；
 * - AC4 无战斗：enemy/minions 投影 = null，斗法页不渲染交战敌卡。
 *
 * 夹具包按 #26 先例内联（壳文案只配被测键，缺键回显键名与生产同码）。
 */
import { describe, expect, it, vi } from 'vitest';

// 第三层 mock 修正打在引擎内部模块上（game.ts 的 './dungeon.js' 相对导入与
// 本 mock 按解析后路径命中同一模块）：引擎组合与包根导出同步生效。
vi.mock('../../../packages/engine/src/dungeon.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../packages/engine/src/dungeon.js')>();
  return {
    ...actual,
    dungeonFloorEnemyOf: (...args: Parameters<typeof actual.dungeonFloorEnemyOf>) => {
      const view = actual.dungeonFloorEnemyOf(...args);
      return view ? { ...view, hp: view.hp * 2 } : view;
    },
  };
});

import type { ContentPack } from '@wendao/content';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

function makePack(): ContentPack {
  return {
    skills: [
      {
        id: 'herb',
        name: '采药',
        icon: '药',
        kind: 'gather',
        activities: [
          { name: '采青灵草', unlockLevel: 1, interval: 3000, exp: 6, output: { item: 'herb1', count: 1 } },
        ],
      },
      { id: 'fight', name: '斗法', icon: '斗', kind: 'combat' },
    ],
    items: [
      { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
      { id: 'heal', name: '回气丹', icon: '回', type: 'consumable', sell: 18, heal: { percent: 0.3 } },
    ],
    recipes: [],
    enemies: [
      {
        id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
        hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
        gold: { min: 4, max: 10 }, drops: [],
      },
    ],
    gearDrops: [],
    elements: [],
    rarities: [{ id: 'plain', name: '朴素', weight: 1, mult: 1, affix: 0, sell: 1 }],
    affixPool: [],
    combatText: {
      verbs: { basic: [{ v: '击', limbs: ['面门'] }], claw: [{ v: '抓', limbs: ['肩头'] }] },
      moves: { basic: ['搏兔一击'], e1: ['饿虎扑食'] },
      openings: ['你足尖一点'],
      critIntro: ['你气机鼓荡'],
      cons: {
        hit: { light: ['{defender}受创{d}点。'], mid: ['{defender}受创{d}点。'], heavy: ['{defender}受创{d}点。'], deadly: ['{defender}受创{d}点。'] },
        hurt: { light: ['你受创{d}点。'], mid: ['你受创{d}点。'], heavy: ['你受创{d}点。'], deadly: ['你受创{d}点。'] },
      },
      fatal: { hit: '{defender}受创{d}点！', hurt: '你受创{d}点。' },
      templates: {
        playerLight: ['你一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
        playerHeavy: ['{opening}——一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
        playerCrit: ['{critIntro}——「{move}」，{weapon}{verb}向{defender}的{limb}！'],
        enemyLight: ['{enemy}一式「{move}」，{verb}向你的{limb}。'],
        enemyHeavy: ['{enemy}凶性大发——「{move}」，{verb}向你的{limb}！'],
      },
      notes: {
        retreat: ['你收势撤战'], retreatToGather: ['你收势离战'], retreatWounded: ['你暂且退避'],
        retreatVictory: ['你见好就收'], reengage: ['你再度向【{enemy}】出手'],
        start: ['你与【{enemy}】战至一处'], autoConsume: ['你服下【{item}】'],
      },
      summary: {
        tiers: { light: ['轻痕积胜'], mid: ['稳中求进'], heavy: ['重创连绵'], deadly: ['锋芒毕露'] },
        base: ['{rounds} 合击倒 · {flavor}'], crit: ['{rounds} 合击倒 · {flavor} · {crits} 会心'],
      },
      compare: { revenge: ['今 {rounds} 合雪耻'], faster: ['今 {rounds} 合胜'], slower: ['今 {rounds} 合方克'], even: ['与前番 {rounds} 合如一'] },
    },
    texts: {
      basicName: '拳脚',
      reject: { '*': { 'bad-payload': '指令无效' } },
      shell: {
        brand: { sigil: '道', name: '试炼', locale: 'zh-CN', bootError: '中止：{message}' },
        topbar: { statsTitle: '属', statsSigil: '斗', goldTitle: '灵石', goldSigil: '石', hpTitle: '气血', hpSigil: '血' },
        tabs: { skills: '修', combat: '斗', bag: '袋', shop: '市', rebirth: '转', talents: '韵', dungeon: '秘', craft: '炼' },
        side: { title: '录' },
        stats: { labels: { atk: { label: '攻' }, def: { label: '防' }, crit: { label: '暴', percent: true } } },
        units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
        icons: { buff: '丹', gear: '器', unknown: '？' },
        common: { needLevel: '需 {level} 层', needDaoYun: '需 {daoYun} 道韵', compareWrap: '（{compare}）', itemListSep: '、' },
        events: {},
        pages: {
          skills: {
            empty: '空', chipLocked: '锁', expSub: '{into}/{need}', expMax: '满', actNow: '{name}',
            idle: '闲', stopBtn: '停', running: '中', byproduct: '{name}', actMeta: '{interval}',
            startBtn: '始', realmLine: '{realm}',
          },
          combat: {
            title: '斗法', subtitle: '{level}', enemyMissing: '无', resting: '休整',
            enemyHp: '敌 {ehp}/{hp}', selfStats: '{hp}/{max}', fleeBtn: '撤',
            autoFightOn: '自动·开', autoFightOff: '自动·关', autoEatOn: '嗑·开', autoEatOff: '嗑·关',
            noConsumables: '无丹', enemyStats: '{hp}', enemyGold: '{min}~{max}', dropsSuffix: '', fightBtn: '战',
            engagedBadge: '集火',
          },
          dungeon: { title: '秘境', empty: '空', subtitle: '', floorNow: '第 {floor}/{floors} 层', best: '最深 {best}', enterBtn: '入', retreatBtn: '撤', clearBadge: '通', entryKey: '需 {item}', powerNow: '', powerRec: '' },
        },
      },
    },
    shop: [],
    dungeons: [
      {
        id: 'rift',
        name: '裂隙',
        icon: '裂',
        floors: 1,
        layers: [
          { floor: { min: 1, max: 1 }, enemies: [{ enemy: 'e1', weight: 1 }], mult: { hp: 2 } },
        ],
      },
    ],
    rebirth: {
      reset: ['skills'],
      keep: [],
      formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
      talents: [
        { id: 't_speed', name: '疾风', cost: 1, effects: [{ stat: 'gatherSpeed', zone: 'flat', value: 1 }] },
      ],
    },
  } as unknown as ContentPack;
}

function makeSave(state: Record<string, unknown> = {}): SaveData {
  return { version: 1, time: 0, state: { items: {}, ...state } } as unknown as SaveData;
}

function mount(save: SaveData) {
  const content = makePack();
  const game = createGame({ content, clock: new ManualClock(), save });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui, game };
}

describe('#40 · 壳层投影消费', () => {
  it('AC2 分叉免疫：引擎第三层 mock 修正 → snapshot 与 DOM 同源跟随（零壳层改动）', () => {
    const { root, ui, game } = mount(makeSave({ skills: { fight: { xp: 100 } } }));
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    (root.querySelector('[data-act="dungeon-enter"][data-dungeon="rift"]') as HTMLButtonElement).click();
    game.events.drain();
    ui.render();
    // 引擎组合面：层倍率 hp×2 = 120，第三层 mock ×2 = 240（同源，战斗结算同值）。
    const snap = game.snapshot();
    expect(snap.enemy?.hp).toBe(240);
    // DOM 敌卡直读投影：名称 + 血量上限与 snapshot.enemy 一致。
    expect(root.querySelector('.enemy-head b')?.textContent).toBe(snap.enemy?.name);
    expect(root.querySelector('.enemy-sub')?.textContent).toContain(`/240`);
  });

  it('AC3 进度条与 gatherSpeed 联动：点亮天赋后速率即时变化', () => {
    const { root, ui, game } = mount(makeSave({ daoYun: 5 }));
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    (root.querySelector('[data-act="start"][data-skill="herb"]') as HTMLButtonElement).click();
    game.tick(300);
    ui.render();
    const bar = () => root.querySelector<HTMLElement>('.bar-jade [data-bar="activity"]')!;
    expect(bar().style.width).toBe('10%'); // 300 / 3000
    game.dispatch({ type: 'talent:buy', payload: { nodeId: 't_speed' } });
    game.tick(300);
    ui.render();
    expect(bar().style.width).toBe('40%'); // (300+300) / (3000/2)
  });

  it('AC4 无战斗：enemy/minions 投影 = null，斗法页不渲染交战敌卡', () => {
    const { root, ui, game } = mount(makeSave());
    const snap = game.snapshot();
    expect(snap.enemy).toBeNull();
    expect(snap.minions).toBeNull();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    expect(root.querySelector('.enemy-card.fighting')).toBeNull();
    expect(root.querySelectorAll('.enemy-card').length).toBeGreaterThan(0); // 敌列表卡照常
  });
});
