import { describe, expect, it } from 'vitest';
import * as contentApi from '../src/index.js';
import { formatContentErrors, validateContentPack } from '../src/index.js';
import type { ContentPack } from '../src/index.js';
import { loadXiuxianPack, xiuxianPackJson } from '../src/packs/xiuxian.js';

describe('修仙题材包 · 验收（issue #2）', () => {
  it('validateContentPack 通过', () => {
    const result = validateContentPack(xiuxianPackJson);
    if (!result.ok) {
      console.error(formatContentErrors(result.errors));
    }
    expect(result.ok).toBe(true);
  });

  it('loadXiuxianPack 强校验通过并返回完整包', () => {
    const pack = loadXiuxianPack();
    expect(pack.skills).toHaveLength(6);
    expect(pack.items).toHaveLength(54);
    expect(pack.recipes).toHaveLength(16);
    expect(pack.enemies).toHaveLength(8);
    expect(pack.gearDrops).toHaveLength(8);
    expect(pack.rarities).toHaveLength(4);
    expect(pack.affixPool).toHaveLength(4);
    expect(pack.shop).toHaveLength(10);
  });

  it('织物线：灵蚕丝/冰蚕丝为采药副产出，布道袍用丝、甲胄用矿石', () => {
    const pack = loadXiuxianPack();
    const herb = pack.skills.find((s) => s.id === 'herb');
    expect(herb?.activities?.map((a) => a.byproduct?.item)).toEqual([
      'silk',
      'silk',
      'bingsilk',
      'bingsilk',
    ]);
    const recipeByName = Object.fromEntries(pack.recipes.map((r) => [r.name, r]));
    expect(Object.keys(recipeByName['缝布道袍'].materials)).toContain('silk');
    expect(Object.keys(recipeByName['织星辰法衣'].materials)).toContain('bingsilk');
    expect(Object.keys(recipeByName['锻玄铁甲'].materials)).toContain('ore2');
    expect(Object.keys(recipeByName['锻不灭金身甲'].materials)).toContain('ore4');
  });

  it('引擎兜底网：basic 招式与官方包动词池齐备（键域开放后 basic 为 schema 唯一恒需）', () => {
    const pack = loadXiuxianPack();
    expect(pack.combatText.moves.basic).toEqual(['搏兔一击', '石破天惊']);
    expect(pack.combatText.verbs.basic?.length).toBeGreaterThan(0);
    // 官方包约定四池（非 schema 强制）。
    for (const style of ['sword', 'claw', 'magic'] as const) {
      expect(pack.combatText.verbs[style]?.length).toBeGreaterThan(0);
    }
  });

  it('config 槽位节：法器/护体/灵饰起步（#16，为法宝/外袍留门）', () => {
    const pack = loadXiuxianPack();
    expect(pack.config?.slots).toEqual([
      { id: 'weapon', name: '法器', icon: '兵' },
      { id: 'body', name: '护体', icon: '甲' },
      { id: 'accessory', name: '灵饰', icon: '饰' },
    ]);
  });

  it('elements 系别注册表：七系在案（#25 键域开放，官方包约定）', () => {
    const pack = loadXiuxianPack();
    expect(pack.elements).toEqual([
      { id: 'metal', name: '金', signature: { primitive: 'defenseBreak', value: 0.4, duration: 8000 } },
      { id: 'wood', name: '木' },
      { id: 'water', name: '水', signature: { primitive: 'slow', value: 0.25, duration: 8000 } },
      { id: 'fire', name: '火' },
      { id: 'earth', name: '土' },
      { id: 'wind', name: '风', signature: { primitive: 'swift', value: 0.2, duration: 8000 } },
      { id: 'thunder', name: '雷' },
    ]);
  });

  it('系别第一波（#15）：武器系别 / Boss 亲和 / elementFlavor 池 / 系别条件铭纹在案', () => {
    const pack = loadXiuxianPack();
    const itemById = new Map(pack.items.map((it) => [it.id, it]));
    // 四系构筑载体：金重剑（破防）/ 星辰剑（雷·霆爆）/ 星纹胚（水·滞缓）/ 诛仙胚（风·迅疾）。
    expect(itemById.get('sword2')?.element).toBe('metal');
    expect(itemById.get('sword3')?.element).toBe('thunder');
    expect(itemById.get('blank_sword_2')?.element).toBe('water');
    expect(itemById.get('blank_sword_3')?.element).toBe('wind');
    // 无系武器可见（凡击回退）。
    expect(itemById.get('sword1')?.element).toBeUndefined();
    expect(itemById.get('sword4')?.element).toBeUndefined();
    // Boss 亲和度（只给 Boss 配）：水克火易伤、火克金抗性（五行相克归 content）。
    const e8 = pack.enemies.find((enemy) => enemy.id === 'e8');
    expect(e8?.element).toBe('fire');
    expect(e8?.affinities).toEqual({ water: 50, metal: -50 });
    // 风味句池：四系 + 火系（Boss 攻击侧），雷系带霆爆专属 crits 池。
    expect(Object.keys(pack.combatText.elementFlavor ?? {}).sort()).toEqual([
      'fire', 'metal', 'thunder', 'water', 'wind',
    ]);
    expect(pack.combatText.elementFlavor?.thunder?.crits?.length).toBeGreaterThan(0);
    // 攻侧系别条件铭纹（掌心雷：雷系攻击 atk+%）与抗性铭纹（逆鳞：受火系 def+）。
    expect(itemById.get('insc_zhangxinlei')?.tiers?.[2]).toEqual([
      { stat: 'atk', zone: 'addPct', value: 20, condition: { element: 'thunder' } },
    ]);
    expect(itemById.get('insc_nilin')?.tiers?.[2]).toEqual([
      { stat: 'def', zone: 'flat', value: 24, condition: { element: 'fire' } },
    ]);
  });

  it('texts.shell 壳层文案：品牌/量纲标记/单位模板在案（#26，壳零题材字符串）', () => {
    const pack = loadXiuxianPack();
    expect(pack.texts.shell.brand.name).toBe('问道长生');
    expect(pack.texts.shell.brand.locale).toBe('zh-CN');
    expect(pack.texts.shell.brand.bootError).toContain('{message}');
    // 量纲显式声明（#26 票评）：crit 百分比量纲，点数系无量纲标记。
    expect(pack.texts.shell.stats.labels.crit).toEqual({ label: '暴', percent: true });
    expect(pack.texts.shell.stats.labels.atk).toEqual({ label: '攻' });
    // 事件与页面文案走 {slot} 模板（fillTemplate 同一约定）。
    expect(pack.texts.shell.events.victoryFlog).toBe('【{name}】轰然倒地！{summary}{compare}');
    expect(pack.texts.shell.pages.shop.price).toBe('{price} 灵石');
    expect(pack.texts.shell.units.level).toBe('{v} 层');
  });

  it('achievements 成就节：四型条件齐备、隐藏成就与奖励在案（#9）', () => {
    const pack = loadXiuxianPack();
    expect(pack.achievements).toHaveLength(11);
    const byId = Object.fromEntries(pack.achievements!.map((a) => [a.id, a]));
    expect(byId['kill_100']).toBeDefined();
    expect(byId['kill_100']!.condition).toEqual({ stat: 'kills', target: 100 });
    // 反向阈值（最快击杀）与布尔型（隐藏败绩）各一。
    expect(byId['fast_kill_3']!.condition).toEqual({ stat: 'fastestKill', op: 'lte', target: 3 });
    expect(byId['first_death']!.hidden).toBe(true);
    expect(byId['first_death']!.condition).toEqual({ stat: 'deaths' });
    // 兵解/秘境联动成就的奖励面。
    expect(byId['rebirth_1']!.reward).toEqual({ daoYun: 5 });
    expect(byId['dungeon_floor_5']!.reward).toEqual({ gold: 300 });
    // 壳文案：页签/副标题槽/统计标签表（键域 = 引擎统计注册表）。
    expect(pack.texts.shell.tabs.achievements).toBe('成就');
    expect(pack.texts.shell.pages.achievements.subtitle).toContain('{unlocked}');
    expect(Object.keys(pack.texts.shell.pages.achievements.statLabels).sort()).toEqual(
      ['cycles', 'deaths', 'dungeonFloorBest', 'fastestKill', 'kills', 'maxHit', 'rebirths'].sort(),
    );
    expect(pack.texts.shell.events.achievementToast).toContain('{name}');
  });
});

describe('content 包分居（#23，#29 守卫补强）', () => {
  it('导出面键全集快照：主入口恒为纯协议，任何新增导出立即红灯', () => {
    // 值导出键全集（类型导出编译擦除，运行时导出面即此三项）。
    // 旧防回归键 loadDefaultContent / loadXiuxianPack / xiuxianPackJson 一旦出现
    // 也会令快照多出键而红灯；失败 diff 会点名多出的键名。
    // 题材侧导出只能走 @wendao/content/packs/* 子路径（ADR-017）。
    expect(Object.keys(contentApi).sort()).toEqual([
      'formatContentErrors',
      'validateContent',
      'validateContentPack',
    ]);
  });
});

/* ==================== 数值基线（防迁移走样，对照旧 js/data.js） ==================== */
/* 本节断言全部手抄自旧版 data.js；改动修仙包数值必须是有意重设并同步更新此处。 */

describe('修仙题材包 · 数值基线', () => {
  const pack: ContentPack = loadXiuxianPack();
  const itemById = Object.fromEntries(pack.items.map((it) => [it.id, it]));

  it('物品：类型与出售价全表', () => {
    const table = Object.fromEntries(
      pack.items.map((it) => [it.id, [it.type, it.sell] as const]),
    );
    expect(table).toEqual({
      qi1: ['mat', 2],
      qi2: ['mat', 9],
      qi3: ['mat', 30],
      herb1: ['mat', 4],
      herb2: ['mat', 15],
      herb3: ['mat', 45],
      herb4: ['mat', 120],
      silk: ['mat', 6],
      bingsilk: ['mat', 60],
      ore1: ['mat', 5],
      ore2: ['mat', 20],
      ore3: ['mat', 60],
      ore4: ['mat', 180],
      core1: ['mat', 25],
      core2: ['mat', 90],
      core3: ['mat', 320],
      guimiao_yaofu: ['mat', 25],
      consumable_heal: ['consumable', 18],
      consumable_qi: ['consumable', 50],
      consumable_atk: ['consumable', 130],
      consumable_def: ['consumable', 180],
      consumable_gold: ['consumable', 700],
      sword1: ['equip', 30],
      sword2: ['equip', 120],
      sword3: ['equip', 400],
      sword4: ['equip', 1500],
      body1: ['equip', 35],
      body2: ['equip', 140],
      body3: ['equip', 450],
      body4: ['equip', 1600],
      acc1: ['equip', 100],
      acc2: ['equip', 320],
      acc3: ['equip', 1200],
      gear_shard: ['mat', 8],
      blank_sword_1: ['blank', 0],
      blank_sword_2: ['blank', 0],
      blank_sword_3: ['blank', 0],
      blank_body_1: ['blank', 0],
      blank_body_2: ['blank', 0],
      blank_body_3: ['blank', 0],
      blank_acc_1: ['blank', 0],
      blank_acc_2: ['blank', 0],
      blank_acc_3: ['blank', 0],
      insc_lieshi: ['inscription', 0],
      insc_suiyu: ['inscription', 0],
      insc_guyuan: ['inscription', 0],
      insc_dongxuan: ['inscription', 0],
      insc_ranxue: ['inscription', 0],
      insc_tiebi: ['inscription', 0],
      insc_qifu: ['inscription', 0],
      insc_nilin: ['inscription', 0],
      insc_shigu: ['inscription', 0],
      insc_yinlei: ['inscription', 0],
      insc_zhangxinlei: ['inscription', 0],
    });
  });

  it('装备：槽位与基础加成全表', () => {
    expect(
      pack.items
        .filter((it) => it.type === 'equip')
        .map((it) => [it.id, it.slot, it.bonuses]),
    ).toEqual([
      ['sword1', 'weapon', { atk: 6 }],
      ['sword2', 'weapon', { atk: 18 }],
      ['sword3', 'weapon', { atk: 45 }],
      ['sword4', 'weapon', { atk: 105 }],
      ['body1', 'body', { def: 6, hp: 25 }],
      ['body2', 'body', { def: 16, hp: 70 }],
      ['body3', 'body', { def: 40, hp: 180 }],
      ['body4', 'body', { def: 90, hp: 450 }],
      ['acc1', 'accessory', { crit: 5 }],
      ['acc2', 'accessory', { crit: 10 }],
      ['acc3', 'accessory', { crit: 18, atk: 15, def: 15 }],
    ]);
  });

  it('器胚：层数段/纹阶天花板/偏好标签/胚纹全表（#14，分层掉胚否决 itemLevel 缩放）', () => {
    const rows = pack.items
      .filter((it) => it.type === 'blank')
      .map((it) => [it.id, it.slot, it.floorRange, it.tierRange, it.preferredTags, it.inherentModifiers]);
    expect(rows).toEqual([
      ['blank_sword_1', 'weapon', { min: 1, max: 5 }, { min: 1, max: 2 }, ['offense'], [{ stat: 'atk', zone: 'flat', value: 4 }]],
      ['blank_sword_2', 'weapon', { min: 6, max: 10 }, { min: 2, max: 3 }, ['offense', 'fortune'], [{ stat: 'atk', zone: 'flat', value: 10 }]],
      ['blank_sword_3', 'weapon', { min: 11, max: 15 }, { min: 3, max: 3 }, ['offense', 'fortune'], [{ stat: 'atk', zone: 'flat', value: 24 }]],
      ['blank_body_1', 'body', { min: 1, max: 5 }, { min: 1, max: 2 }, ['defense'], [{ stat: 'def', zone: 'flat', value: 3 }]],
      ['blank_body_2', 'body', { min: 6, max: 10 }, { min: 2, max: 3 }, ['defense', 'sustain'], [{ stat: 'def', zone: 'flat', value: 8 }]],
      ['blank_body_3', 'body', { min: 11, max: 15 }, { min: 3, max: 3 }, ['defense', 'sustain'], [{ stat: 'def', zone: 'flat', value: 20 }]],
      ['blank_acc_1', 'accessory', { min: 1, max: 5 }, { min: 1, max: 2 }, ['fortune'], [{ stat: 'crit', zone: 'flat', value: 2 }]],
      ['blank_acc_2', 'accessory', { min: 6, max: 10 }, { min: 2, max: 3 }, ['fortune', 'sustain'], [{ stat: 'crit', zone: 'flat', value: 4 }]],
      ['blank_acc_3', 'accessory', { min: 11, max: 15 }, { min: 3, max: 3 }, ['fortune', 'offense'], [{ stat: 'crit', zone: 'flat', value: 7 }]],
    ]);
  });

  it('铭纹池：8~12 条 + 三阶表 + 条件/feature 特色铭纹 + tags（#14）', () => {
    const inscriptions = pack.items.filter((it) => it.type === 'inscription');
    // 票面范围：铭纹池 8~12 条。
    expect(inscriptions.length).toBeGreaterThanOrEqual(8);
    expect(inscriptions.length).toBeLessThanOrEqual(12);
    // 三阶表定长 3 且逐阶非空。
    for (const insc of inscriptions) {
      expect(insc.tiers).toHaveLength(3);
      for (const row of insc.tiers) expect(row.length).toBeGreaterThan(0);
    }
    // 机制型特色铭纹（feature condition+primitive，引擎原语池零新增）2~3 条。
    expect(inscriptions.filter((it) => it.feature !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(inscriptions.filter((it) => it.feature !== undefined).length).toBeLessThanOrEqual(3);
    // 条件铭纹（受火系防御）：元素条件引用已注册系别。
    const nilin = inscriptions.find((it) => it.id === 'insc_nilin');
    expect(nilin?.tiers[2]).toEqual([{ stat: 'def', zone: 'flat', value: 24, condition: { element: 'fire' } }]);
    // 标签词表：器胚 preferredTags 的键域来源。
    const tagVocab = new Set(inscriptions.flatMap((it) => it.tags ?? []));
    for (const blank of pack.items.filter((it) => it.type === 'blank')) {
      for (const tag of blank.preferredTags ?? []) expect(tagVocab.has(tag)).toBe(true);
    }
  });

  it('消耗品：回气丹恢复三成，增益丹时长五分钟', () => {
    expect(itemById.consumable_heal.heal).toEqual({ percent: 0.3 });
    expect(itemById.consumable_qi.effect).toEqual({ duration: 300000, multipliers: { gatherXp: 1.25 } });
    expect(itemById.consumable_atk.effect).toEqual({ duration: 300000, multipliers: { atk: 1.2 } });
    expect(itemById.consumable_def.effect).toEqual({ duration: 300000, multipliers: { def: 1.3 } });
    expect(itemById.consumable_gold.effect).toEqual({
      duration: 300000,
      multipliers: { atk: 1.4, def: 1.4 },
      crit: 10,
    });
  });

  it('采集活动：解锁层/耗时（毫秒）/修为/产出/副产出全表', () => {
    const rows = pack.skills
      .filter((s) => s.kind === 'gather')
      .flatMap((s) =>
        (s.activities ?? []).map((a) => [
          s.id,
          a.name,
          a.unlockLevel,
          a.interval,
          a.exp,
          a.output.item,
          a.byproduct?.item ?? null,
          a.byproduct?.chance ?? null,
        ]),
      );
    expect(rows).toEqual([
      ['qi', '吐纳聚灵', 1, 2000, 5, 'qi1', null, null],
      ['qi', '凝灵成雾', 20, 3500, 14, 'qi2', null, null],
      ['qi', '摘星引罡', 45, 5500, 36, 'qi3', null, null],
      ['herb', '采青灵草', 1, 3000, 6, 'herb1', 'silk', 0.5],
      ['herb', '采紫云花', 15, 4000, 15, 'herb2', 'silk', 0.4],
      ['herb', '采玄冰莲', 35, 6000, 40, 'herb3', 'bingsilk', 0.5],
      ['herb', '采万年灵芝', 60, 9000, 90, 'herb4', 'bingsilk', 0.35],
      ['mine', '凿凡铁', 1, 2500, 6, 'ore1', null, null],
      ['mine', '采玄铁', 18, 4000, 16, 'ore2', null, null],
      ['mine', '取星辰砂', 40, 6500, 42, 'ore3', null, null],
      ['mine', '采灵晶', 65, 9500, 100, 'ore4', null, null],
    ]);
  });

  it('配方：炼丹成功率与炼器必成全表', () => {
    const rows = pack.recipes.map((r) => [
      r.name,
      r.skill,
      r.unlockLevel,
      r.output.item,
      r.materials,
      r.successRate,
      r.interval,
      r.exp,
    ]);
    expect(rows).toEqual([
      ['炼制回气丹', 'alchemy', 1, 'consumable_heal', { herb1: 2 }, 0.75, 3000, 8],
      ['炼制聚气丹', 'alchemy', 12, 'consumable_qi', { herb1: 1, herb2: 1 }, 0.65, 4500, 20],
      ['炼制破煞丹', 'alchemy', 28, 'consumable_atk', { herb2: 2, core1: 1 }, 0.6, 6000, 45],
      ['炼制凝神丹', 'alchemy', 42, 'consumable_def', { herb3: 2 }, 0.55, 7500, 80],
      ['炼制九转金丹', 'alchemy', 65, 'consumable_gold', { herb4: 2, ore4: 1, core2: 1 }, 0.45, 12000, 220],
      ['锻青锋剑', 'smith', 1, 'sword1', { ore1: 4, qi1: 5 }, 1, 4000, 10],
      ['缝布道袍', 'smith', 5, 'body1', { silk: 3, qi1: 6 }, 1, 4500, 12],
      ['琢聚灵玉佩', 'smith', 12, 'acc1', { qi1: 12, ore1: 3 }, 1, 5000, 20],
      ['锻玄铁重剑', 'smith', 20, 'sword2', { ore2: 6, qi1: 18 }, 1, 6000, 35],
      ['锻玄铁甲', 'smith', 26, 'body2', { ore2: 5, qi1: 16 }, 1, 6000, 38],
      ['琢破妄金瞳', 'smith', 36, 'acc2', { qi2: 15, ore2: 6 }, 1, 7000, 60],
      ['锻星辰剑', 'smith', 45, 'sword3', { ore3: 8, qi2: 20 }, 1, 8000, 100],
      ['织星辰法衣', 'smith', 52, 'body3', { bingsilk: 4, qi2: 18 }, 1, 8500, 120],
      ['铸混沌钟铃', 'smith', 66, 'acc3', { qi3: 20, ore4: 5 }, 1, 10000, 220],
      ['锻诛仙剑', 'smith', 75, 'sword4', { ore4: 10, qi3: 20, core3: 2 }, 1, 14000, 380],
      ['锻不灭金身甲', 'smith', 82, 'body4', { ore4: 8, qi3: 16 }, 1, 15000, 420],
    ]);
  });

  it('敌人：数值/受击方式/修为/灵石/掉落全表', () => {
    const rows = pack.enemies.map((e) => [
      e.id,
      e.name,
      e.level,
      e.kind,
      e.hp,
      e.atk,
      e.def,
      e.attackInterval,
      e.exp,
      e.gold,
      e.drops,
    ]);
    expect(rows).toEqual([
      ['e1', '青鬃狼', 1, 'claw', 60, 9, 2, 2800, 16, { min: 4, max: 10 }, [{ item: 'core1', chance: 0.25 }, { item: 'herb1', chance: 0.4 }]],
      ['e2', '赤尾妖蝎', 8, 'claw', 140, 17, 6, 2600, 40, { min: 12, max: 24 }, [{ item: 'core1', chance: 0.35 }, { item: 'herb2', chance: 0.3 }]],
      ['e3', '鬼面修士', 18, 'magic', 280, 32, 14, 2400, 95, { min: 28, max: 55 }, [{ item: 'core1', chance: 0.5 }, { item: 'consumable_heal', chance: 0.15 }, { item: 'herb2', chance: 0.25 }]],
      ['e4', '尸傀', 30, 'claw', 560, 55, 26, 2600, 190, { min: 55, max: 95 }, [{ item: 'core2', chance: 0.3 }, { item: 'ore2', chance: 0.35 }]],
      ['e5', '血魔', 45, 'magic', 1050, 88, 46, 2400, 380, { min: 110, max: 190 }, [{ item: 'core2', chance: 0.45 }, { item: 'herb3', chance: 0.25 }]],
      ['e6', '阴罗妖将', 60, 'magic', 2000, 135, 82, 2200, 700, { min: 220, max: 380 }, [{ item: 'core3', chance: 0.3 }, { item: 'herb4', chance: 0.15 }]],
      ['e7', '魔君残魂', 78, 'magic', 3800, 205, 145, 2200, 1300, { min: 420, max: 720 }, [{ item: 'core3', chance: 0.45 }, { item: 'ore4', chance: 0.2 }]],
      ['e8', '上古凶兽·饕餮', 92, 'claw', 6000, 240, 150, 2400, 2600, { min: 850, max: 1500 }, [{ item: 'core3', chance: 0.8 }, { item: 'consumable_gold', chance: 0.2 }]],
    ]);
  });

  it('异宝掉落表全表（#14 起掉器胚，E5/E6 混池跨层段）', () => {
    const rows = pack.gearDrops.map((g) => [g.enemy, g.chance, g.pool]);
    expect(rows).toEqual([
      ['e1', 0.1, ['blank_sword_1', 'blank_body_1', 'blank_acc_1']],
      ['e2', 0.1, ['blank_sword_1', 'blank_body_1', 'blank_acc_1']],
      ['e3', 0.09, ['blank_sword_2', 'blank_body_2', 'blank_acc_2']],
      ['e4', 0.09, ['blank_sword_2', 'blank_body_2', 'blank_acc_2']],
      ['e5', 0.08, ['blank_sword_2', 'blank_body_2', 'blank_acc_2', 'blank_sword_3', 'blank_body_3', 'blank_acc_3']],
      ['e6', 0.08, ['blank_sword_2', 'blank_body_2', 'blank_acc_2', 'blank_sword_3', 'blank_body_3', 'blank_acc_3']],
      ['e7', 0.07, ['blank_sword_3', 'blank_body_3', 'blank_acc_3']],
      ['e8', 0.15, ['blank_sword_3', 'blank_body_3', 'blank_acc_3']],
    ]);
  });

  it('稀有度词表全表（对照旧引擎掷点基线 70/20/8/2，#018 数据化；smelt 熔炼产出 #14）', () => {
    expect(pack.rarities).toEqual([
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1, smelt: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2, smelt: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4, smelt: 4 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, smelt: 8, showcase: true },
    ]);
    // ADR-016 裁决 ④：UI 特判走显式 bool，不写 = 普通档。
    expect(pack.rarities.filter((r) => r.showcase).map((r) => r.id)).toEqual(['epic']);
  });

  it('词条池全表（scale 对照旧引擎量级系数，#018 数据化）', () => {
    expect(pack.affixPool).toEqual([
      { name: '锐锋', stat: 'atk', scale: 0.3 },
      { name: '罡气', stat: 'def', scale: 0.3 },
      { name: '浑厚', stat: 'hp', scale: 1.5 },
      { name: '通明', stat: 'crit', scale: 0.25 },
    ]);
  });

  it('坊市货架全表（#5 补材料条目：修仙包炼制循环的购料通路）', () => {
    const rows = pack.shop.map((s) => [s.item, s.price]);
    expect(rows).toEqual([
      ['consumable_heal', 45],
      ['consumable_qi', 120],
      ['consumable_atk', 320],
      ['consumable_def', 450],
      ['silk', 15],
      ['bingsilk', 90],
      ['herb1', 10],
      ['qi1', 6],
      ['ore1', 12],
      ['core1', 60],
    ]);
  });

  it('炼制协议面：config.crafting 显式基线 + craft 页/事件文案在案（#5）', () => {
    expect(pack.config?.crafting).toEqual({
      successPerLevel: 0.004,
      successCap: 0.99,
      failExpRefund: 0.25,
      rarityBiasPerLevel: 0.0004,
    });
    expect(pack.texts.shell.tabs.craft).toBe('炼制');
    expect(pack.texts.shell.pages.craft.successRate).toContain('{rate}');
    expect(pack.texts.shell.pages.craft.matRow).toContain('{have}');
    expect(pack.texts.shell.events.lootCraft).toContain('{name}');
    expect(pack.texts.shell.events.craftFail).toContain('{exp}');
    expect(pack.texts.shell.events.craftHalt).toContain('{name}');
  });

  it('装备构筑协议面：config.gear 显式基线 + 熔炼/重铸文案在案（#14）', () => {
    expect(pack.config?.gear).toEqual({ shardItem: 'gear_shard', reforgeCost: 3, tagWeightPerMatch: 1 });
    expect(pack.texts.shell.pages.bag.smeltBtn).toBe('熔炼');
    expect(pack.texts.shell.pages.bag.reforgeBtn).toBe('重铸');
    expect(pack.texts.shell.pages.bag.inscTier).toContain('{tier}');
    expect(pack.texts.shell.events.gearSmelt).toContain('{shard}');
    expect(pack.texts.shell.events.gearReforge).toContain('{tier}');
    expect(pack.texts.reject['gear:reforge']?.['no-shard']).toContain('{cost}');
  });

  it('战斗文案：动词池/招式注册/词库结构', () => {
    const ct = pack.combatText;
    expect(Object.keys(ct.verbs)).toEqual(['sword', 'basic', 'claw', 'magic']);
    expect(ct.verbs.sword).toHaveLength(6);
    expect(ct.verbs.basic).toHaveLength(3);
    expect(ct.verbs.claw).toHaveLength(5);
    expect(ct.verbs.magic).toHaveLength(5);
    // 招式注册：basic + 7 件武器（4 剑 + 3 剑胚，#14 器胚武器同律）+ 8 敌 + Boss 变招键（#8）
    expect(Object.keys(ct.moves).sort()).toEqual(
      [
        'basic', 'sword1', 'sword2', 'sword3', 'sword4',
        'blank_sword_1', 'blank_sword_2', 'blank_sword_3',
        'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e8_devour',
      ].sort(),
    );
    expect(ct.moves.sword4).toEqual(['诛仙一线', '万剑归宗']);
    expect(ct.openings).toHaveLength(4);
    expect(ct.critIntro).toHaveLength(2);
    for (const side of ['hit', 'hurt'] as const) {
      expect(ct.cons[side].light).toHaveLength(side === 'hit' ? 3 : 2);
      expect(ct.cons[side].mid).toHaveLength(side === 'hit' ? 3 : 2);
      expect(ct.cons[side].heavy).toHaveLength(2);
      expect(ct.cons[side].deadly).toHaveLength(2);
    }
    expect(ct.fatal.hit).toContain('{defender}');
    expect(ct.fatal.hit).toContain('{d}');
    expect(ct.fatal.hurt).toContain('{d}');
  });
});
