import { describe, expect, it } from 'vitest';
import { validateContentPack, validatePackSemantics } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { fantasyPackJson } from '../src/packs/fantasy.js';
import { xiuxianPackJson } from '../src/packs/xiuxian.js';
import { shellFixture } from './fixtures.js';

/**
 * 跨引用语义检查的基准夹具：最小合法包（与 pack.test.ts 同构，本文件
 * 自持一份——语义独立入口的夹具要做「节结构级」破坏，与整包校验用例
 * 解耦，互不牵连）。
 */
const BASE_PACK: unknown = {
  version: '0.1.0',
  skills: [
    {
      id: 'herb',
      name: '采药',
      icon: '药',
      kind: 'gather',
      activities: [
        {
          name: '采青灵草',
          unlockLevel: 1,
          interval: 3000,
          exp: 6,
          output: { item: 'herb1', count: 1 },
        },
      ],
    },
    { id: 'smith', name: '炼器', icon: '器', kind: 'craft' },
  ],
  items: [
    { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
    { id: 'sword1', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, bonuses: { atk: 6 } },
    { id: 'spare', name: '备件', icon: '备', type: 'mat', sell: 1 },
  ],
  recipes: [
    {
      name: '铸剑',
      skill: 'smith',
      unlockLevel: 5,
      output: { item: 'sword1', count: 1 },
      materials: { herb1: 3 },
      successRate: 1,
      interval: 4500,
      exp: 12,
    },
  ],
  enemies: [
    {
      id: 'e1',
      name: '青鬃狼',
      icon: '狼',
      level: 1,
      kind: 'claw',
      hp: 60,
      atk: 9,
      def: 2,
      attackInterval: 2800,
      exp: 16,
      gold: { min: 4, max: 10 },
      drops: [{ item: 'herb1', chance: 0.4 }],
    },
  ],
  gearDrops: [{ enemy: 'e1', chance: 0.1, pool: ['sword1'] }],
  elements: [],
  rarities: [
    { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
    { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2 },
  ],
  affixPool: [{ name: '锐锋', stat: 'atk', scale: 0.3 }],
  combatText: {
    verbs: {
      sword: [{ v: '刺', limbs: ['咽喉'] }],
      basic: [{ v: '击', limbs: ['面门'] }],
      claw: [{ v: '抓', limbs: ['肩头'] }],
    },
    moves: { basic: ['搏兔一击'], sword1: ['青虹一闪'], e1: ['饿虎扑食'] },
    openings: ['你足尖一点，身形快若惊鸿'],
    critIntro: ['你气机鼓荡，一式全力施为'],
    cons: {
      hit: {
        light: ['{defender}受了点轻伤，受创{d}点。'],
        mid: ['{defender}闷哼一声，受创{d}点。'],
        heavy: ['{defender}喷出一口鲜血，受创{d}点。'],
        deadly: ['{defender}摇摇欲坠，受创{d}点。'],
      },
      hurt: {
        light: ['你受创{d}点。'],
        mid: ['你闷哼一声，受创{d}点。'],
        heavy: ['你喷出一口鲜血，受创{d}点。'],
        deadly: ['你摇摇欲坠，受创{d}点。'],
      },
    },
    fatal: {
      hit: '{defender}发出一声哀鸣——这致命一击受创{d}点！',
      hurt: '你眼前一黑，受创{d}点。',
    },
    templates: {
      playerLight: ['你一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
      playerHeavy: ['{opening}——一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
      playerCrit: ['{critIntro}——「{move}」倏然施出，{weapon}{verb}向{defender}的{limb}！'],
      enemyLight: ['{enemy}一式「{move}」，{verb}向你的{limb}。'],
      enemyHeavy: ['{enemy}凶性大发——「{move}」猛然施出，{verb}向你的{limb}！'],
    },
    notes: {
      retreat: ['你收势撤出战团'],
      retreatToGather: ['你收势离战，转赴修行'],
      retreatWounded: ['你气血未复，暂且退避调息'],
      retreatVictory: ['你见好就收，飘然离场'],
      reengage: ['你略定心神，再度向【{enemy}】出手'],
      start: ['剑拔弩张——你与【{enemy}】战至一处'],
      autoConsume: ['你服下一枚【{item}】，气息稍定'],
    },
    summary: {
      tiers: {
        light: ['招式绵密，轻痕积胜'],
        mid: ['招招见血，稳中求进'],
        heavy: ['大开大合，重创连绵'],
        deadly: ['招招奔要害，锋芒毕露'],
      },
      base: ['{rounds} 合击倒 · {flavor}'],
      crit: ['{rounds} 合击倒 · {flavor} · {crits} 次会心'],
    },
    compare: {
      revenge: ['前番不敌，今 {rounds} 合雪耻'],
      faster: ['前番苦战 {prev} 合，今 {rounds} 合击倒'],
      slower: ['今番 {rounds} 合方克，比前番 {prev} 合多费周章'],
      even: ['与前番 {rounds} 合如出一辙'],
    },
  },
  texts: {
    basicName: '拳脚',
    reject: { '*': { 'bad-payload': '指令无效', 'unknown-action': '未知指令' } },
    shell: shellFixture(),
  },
  shop: [{ item: 'herb1', price: 45 }],
};

function makePack(): Record<string, any> {
  return JSON.parse(JSON.stringify(BASE_PACK));
}

/** 语义错误身份键（与 editor 事务门禁 errorKeyOf 同构：path/keyword/message）。 */
function errorKeyOf(error: ContentError): string {
  return `${error.path}\u001F${error.keyword}\u001F${error.message}`;
}

/**
 * 带招式注册的悬空掉落敌人（挂在 enemies 末尾不位移既有条目；
 * moves 补注册后其唯一语义错误 = 悬空 drop，错误集可控）。
 */
function appendDanglingEnemy(pack: Record<string, any>, id = 'e2'): void {
  pack.enemies.push({
    id,
    name: '悬空怪',
    icon: '悬',
    level: 1,
    kind: 'claw',
    hp: 40,
    atk: 8,
    def: 2,
    attackInterval: 2400,
    exp: 10,
    gold: { min: 1, max: 3 },
    drops: [{ item: 'ghost_item', chance: 0.3 }],
  });
  pack.combatText.moves[id] = ['悬空一击'];
}

/**
 * 变异对照（改完必须验红再还原，别信「测试在场」；content 包无
 * vite.config，mutation-check runner 不支持，验红走手工逐条——#94 票评
 * 申报，集：本头注即清单）。验红手法 = 对 pack.ts 真源码逐条手工施加
 * → 本文件 vitest 红 → 还原：
 * - M1 semanticScopeOf 恒全可信（跳过节形态守卫）→ 畸形节用例崩溃或
 *   噪音级联（错误集失控），红；
 * - M2 checkEnemies 的 drops xref 去掉 typeof string 参与守卫 → 条目级
 *   用例报 "undefined" 噪音，红；
 * - M3 validatePackSemantics 恒返回 []（独立入口空转）→ 悬空 drops 用例
 *   红；
 * - M4 indexIds 去掉条目守卫 → items [null] 用例崩溃，红；
 * - M5 rarities 单调检查去掉 typeof number 守卫 → 畸形倍率字符串字典序
 *   误报倒挂，红。
 */
describe('validatePackSemantics · 语义独立入口（#94）', () => {
  describe('干净包对拍（schema 面缺席时语义面不缺席的基准）', () => {
    it('基准夹具：语义零错，整包校验 ok', () => {
      expect(validatePackSemantics(makePack())).toEqual([]);
      expect(validateContentPack(makePack()).ok).toBe(true);
    });

    it('真实题材包（修仙/魔幻）：语义零错', () => {
      expect(validatePackSemantics(xiuxianPackJson)).toEqual([]);
      expect(validatePackSemantics(fantasyPackJson)).toEqual([]);
    });

    it('仅语义错的包：独立入口与整包校验的语义面同集（对拍）', () => {
      const pack = makePack();
      appendDanglingEnemy(pack);
      const full = validateContentPack(pack);
      expect(full.ok).toBe(false);
      if (full.ok) return;
      expect(validatePackSemantics(pack).map(errorKeyOf).sort()).toEqual(
        full.errors.map(errorKeyOf).sort(),
      );
    });
  });

  describe('带 schema 错包（#56 挂账场景：schema 错 + 悬空 drops）', () => {
    it('前提钉：整包校验对这样的包只报 schema 面（提前返回、语义缺席）', () => {
      const pack = makePack();
      pack.enemies[0].hp = 'oops'; // schema 面：字段类型错
      appendDanglingEnemy(pack); // 语义面：悬空 drop
      const result = validateContentPack(pack);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ path: '/enemies/0/hp', keyword: 'type' });
    });

    it('独立入口报悬空 drop 且无噪音级联（错误集可控：恰好 1 条）', () => {
      const pack = makePack();
      pack.enemies[0].hp = 'oops';
      appendDanglingEnemy(pack);
      const errors = validatePackSemantics(pack);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        path: '/enemies/1/drops/0/item',
        keyword: 'xref',
      });
      expect(errors[0]!.message).toContain('ghost_item');
    });

    it('追加稳定性：既有语义错误键不位移、新增可差分（editor 事务门禁的对照前提）', () => {
      const pack = makePack();
      pack.enemies[0].hp = 'oops';
      appendDanglingEnemy(pack, 'e2'); // 存量语义错：e2 悬空
      const before = validatePackSemantics(pack).map(errorKeyOf);
      expect(before).toHaveLength(1);
      appendDanglingEnemy(pack, 'e3'); // 再入一条悬空（模拟候选入包）
      const after = validatePackSemantics(pack).map(errorKeyOf);
      const added = after.filter((key) => !before.includes(key));
      expect(added).toHaveLength(1);
      expect(added[0]).toContain('/enemies/2/drops/0/item');
    });
  });

  describe('畸形节防护（结构级：畸形节跳过语义只留 schema 面，读它的检查一并跳过）', () => {
    it('items 节非数组：不崩溃；items 索引源失真 → 掉落/配方/商店 xref 全跳过（零噪音）', () => {
      const pack = makePack();
      pack.items = 'oops';
      expect(validateContentPack(pack).ok).toBe(false); // schema 面照常报告
      expect(validatePackSemantics(pack)).toEqual([]);
    });

    it('必选节缺省（items undefined）：同律零噪音', () => {
      const pack = makePack();
      delete pack.items;
      expect(validatePackSemantics(pack)).toEqual([]);
    });

    it('combatText 畸形：招式注册/动词风格/系别风味检查跳过，不崩溃', () => {
      const pack = makePack();
      pack.combatText = 42;
      expect(validatePackSemantics(pack)).toEqual([]);
    });

    it('config 畸形：槽位/武器推导失真 → 招式注册表家族跳过（不误报悬空招式键）', () => {
      const pack = makePack();
      pack.config = { slots: { not: 'array' } }; // slots 畸形
      // moves 里的 weapon1 键依赖 config.slots 推导武器身份——config 不可信时
      // 不得把它误报成悬空键。
      pack.combatText.moves['sword1-note'] = ['误报试验'];
      const errors = validatePackSemantics(pack);
      expect(errors).toEqual([]);
    });

    it('可选节畸形（bosses 非数组）：跳过 Boss 系检查，不崩溃', () => {
      const pack = makePack();
      pack.bosses = { not: 'array' };
      expect(validatePackSemantics(pack)).toEqual([]);
    });
  });

  describe('畸形条目防护（条目级：畸形条目跳过语义留给 schema 面，好条目照查）', () => {
    it('items 混入 null：不崩溃；合法条目的 id 去重照常生效', () => {
      const pack = makePack();
      pack.items.push(null); // 下标 3：畸形条目
      pack.items.push({ ...pack.items[0] }); // 下标 4：与第 0 项撞名（合法条目间）
      const errors = validatePackSemantics(pack);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ path: '/items/4', keyword: 'duplicate' });
    });

    it('条目 id 非字符串：不崩溃、无 "undefined" 撞名噪音；合法条目撞名照查', () => {
      const pack = makePack();
      pack.items[2].id = 123; // 无引用条目（spare）id 类型坏：留给 schema 面
      pack.items.push({ ...pack.items[1] }); // 下标 3：合法条目撞名 sword1
      const errors = validatePackSemantics(pack);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ path: '/items/3', keyword: 'duplicate' });
      expect(JSON.stringify(errors)).not.toContain('undefined');
    });

    it('敌人 drops 缺省/畸形：不崩溃（drops xref 跳过），该敌其余检查照查', () => {
      const pack = makePack();
      delete pack.enemies[0].drops; // schema 面 required，语义面跳过该半边
      const errors = validatePackSemantics(pack);
      expect(errors).toEqual([]); // 无崩溃、无噪音；招式注册仍闭合故零错
    });

    it('引用字段类型坏（drop.item 非字符串）：语义不报存在性（留给 schema），类型对的引用照查', () => {
      const pack = makePack();
      pack.enemies[0].drops[0].item = 123;
      const errors = validatePackSemantics(pack);
      expect(errors).toEqual([]);
    });

    it('稀有度倍率类型坏：不按字典序误报倒挂；数值正常时检查照查', () => {
      const pack = makePack();
      pack.rarities[0].mult = '9'; // 字典序 "9" > "1.15" 会误报，typeof 守卫拦下
      pack.rarities[1].mult = '1.2';
      expect(validatePackSemantics(pack)).toEqual([]);
      const pack2 = makePack();
      pack2.rarities[1].mult = 0.5; // 真倒挂（数值）：照查
      const errors = validatePackSemantics(pack2);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ path: '/rarities/1/mult', keyword: 'monotonic' });
    });
  });
});
