// @vitest-environment happy-dom
/**
 * #8 验收：Boss 战特殊呈现（壳层）——
 * - 阶段徽标（进入脚本阶段后显示阶段名，content 数据直出）；
 * - 血条分段刻度（阈值位置 = content 阶段脚本，非 Boss 无刻度）；
 * - boss:phase 事件 → events.bossPhase 模板入浮提示与修行录；
 * - 生效视图走引擎组合投影（combatEnemyView），壳零缩放公式。
 *
 * 夹具包按 #26 先例内联（壳文案只配被测键，缺键回显键名与生产同码）。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import { createGame, ManualClock, type GameAction, type GameEvent, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 最小 Boss 包：e1 两阶段（0.6 血目暴睁 atk×2 / 0.3 狂暴 变招+叙事）。 */
function makePack(): ContentPack {
  return {
    skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
    items: [{ id: 'heal', name: '回气丹', icon: '回', type: 'consumable', sell: 18, heal: { percent: 0.3 } }],
    recipes: [],
    enemies: [
      {
        id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
        hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
        gold: { min: 4, max: 10 }, drops: [],
      },
      {
        id: 'e2', name: '赤尾妖蝎', icon: '蝎', level: 8, kind: 'claw',
        hp: 24, atk: 3, def: 1, attackInterval: 1000000, exp: 8,
        gold: { min: 1, max: 2 }, drops: [],
      },
    ],
    gearDrops: [],
    elements: [],
    rarities: [{ id: 'plain', name: '朴素', weight: 1, mult: 1, affix: 0, sell: 1 }],
    affixPool: [],
    combatText: {
      verbs: {
        basic: [{ v: '击', limbs: ['面门'] }],
        claw: [{ v: '抓', limbs: ['肩头'] }],
      },
      moves: { basic: ['搏兔一击'], e1: ['饿虎扑食'], e1_rage: ['狂暴撕咬'], e2: ['毒尾横扫'] },
      openings: ['你足尖一点'],
      critIntro: ['你气机鼓荡'],
      cons: {
        hit: {
          light: ['{defender}受创{d}点。'], mid: ['{defender}受创{d}点。'],
          heavy: ['{defender}受创{d}点。'], deadly: ['{defender}受创{d}点。'],
        },
        hurt: {
          light: ['你受创{d}点。'], mid: ['你受创{d}点。'],
          heavy: ['你受创{d}点。'], deadly: ['你受创{d}点。'],
        },
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
      compare: {
        revenge: ['今 {rounds} 合雪耻'], faster: ['今 {rounds} 合胜'],
        slower: ['今 {rounds} 合方克'], even: ['与前番 {rounds} 合如一'],
      },
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
        events: {
          bossPhase: '【{enemy}】显露「{name}」之相！（阶段 {phase}）',
          victoryFlog: '【{name}】倒下！{summary}',
          victoryLog: '击倒【{name}】',
          defeatFlog: '你不敌【{name}】',
          defeatToast: '落败',
          expCombat: '斗法修为 +{amount}',
        },
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
        },
      },
    },
    shop: [],
    bosses: [
      {
        enemy: 'e1',
        phases: [
          { threshold: 0.6, name: '血目暴睁', mods: { atk: 2 }, narration: ['【{enemy}】血目暴睁！'] },
          {
            threshold: 0.3, name: '狂暴', mods: { attackInterval: 0.5 }, moveKey: 'e1_rage',
            narration: ['【{enemy}】狂暴！'],
            summons: { count: 1, enemies: [{ enemy: 'e2', weight: 1 }] },
          },
        ],
      },
    ],
  } as unknown as ContentPack;
}

/** 斗法 3 层存档：对 e1（hp 60）恰 4-5 击，两阶段在击杀前确定性触发。 */
function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: { skills: { fight: { xp: 100 } }, items: {} },
  } as unknown as SaveData;
}

function mount(): { root: HTMLElement; ui: ReturnType<typeof buildUi>; game: ReturnType<typeof createGame> } {
  const content = makePack();
  const game = createGame({ content, clock: new ManualClock(), save: makeSave() });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui, game };
}

describe('#8 · Boss 战壳呈现', () => {
  it('开战前：血条刻度随阶段脚本渲染（60%/30% 双刻度），无阶段徽标', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    game.events.drain();
    ui.render(); // happy-dom 无 rAF，事件驱动的合并重绘需手动触发
    expect(root.querySelectorAll('.bar > i.tick')).toHaveLength(2);
    const lefts = Array.from(root.querySelectorAll<HTMLElement>('.bar > i.tick')).map((el) => el.style.left);
    expect(lefts).toEqual(['60%', '30%']);
    expect(root.querySelector('.boss-phase')).toBeNull(); // 未入脚本阶段
  });

  it('跨阈值：阶段徽标出现（阶段名 content 直出）+ 事件文案入浮提示/修行录', () => {
    const { root, ui, game } = mount();
    const seen: GameEvent[] = [];
    game.events.subscribe((event) => seen.push(event));
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    for (let i = 0; i < 60 && !seen.some((e) => e.type === 'boss:phase'); i++) {
      game.tick(1000);
      ui.render();
    }
    expect(seen.some((e) => e.type === 'boss:phase')).toBe(true);
    expect(root.querySelector('.boss-phase')?.textContent).toBe('血目暴睁');
    expect(root.querySelector('.toast')?.textContent).toContain('血目暴睁');
    expect(root.querySelector('#log')?.textContent).toContain('显露「血目暴睁」之相');
  });
});

/**
 * #30 验收：召唤物壳呈现——召唤物血条行 + 集火徽标（首槽 = 引擎集火序）；
 * 生效数值走引擎投影（summonMinionOf 组合面），壳零缩放公式；清场后行消失。
 * 无文本节点元素（血条）以 querySelector 存在性断言（innerText 盲区教训）。
 */
describe('#30 · 召唤物壳呈现', () => {
  it('跨召唤阈值：召唤物行出现（集火徽标 + 血条元素 + 投影数值），清场后消失', () => {
    const { root, ui, game } = mount();
    const seen: GameEvent[] = [];
    game.events.subscribe((event) => seen.push(event));
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    for (let i = 0; i < 60 && !seen.some((e) => e.type === 'boss:summon'); i++) {
      game.tick(1000);
      ui.render();
    }
    expect(seen.some((e) => e.type === 'boss:summon')).toBe(true);
    // 召唤物行：e2 缩影（无 mult = 投影原值 hp 24），集火徽标随首槽渲染。
    expect(root.querySelectorAll('.minion-row')).toHaveLength(1);
    expect(root.querySelector('.minion-row.focus')).not.toBeNull();
    expect(root.querySelector('.minion-row .act-badge')?.textContent).toBe('集火');
    expect(root.querySelector('.minion-row [data-bar="minion"]')).not.toBeNull();
    expect(root.querySelector('.minion-row')?.textContent).toContain('敌 24/24');
    // 清场：召唤物被击杀后行消失（战斗不中断）。
    for (let i = 0; i < 60 && root.querySelector('.minion-row'); i++) {
      game.tick(1000);
      ui.render();
    }
    expect(root.querySelectorAll('.minion-row')).toHaveLength(0);
    expect(root.querySelector('[data-act="flee"]')).not.toBeNull(); // 战斗仍在（回主目标）
  });
});
