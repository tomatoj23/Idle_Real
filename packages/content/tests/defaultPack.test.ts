import { describe, expect, it } from 'vitest';
import { formatContentErrors, loadDefaultContent, validateContentPack } from '../src/index.js';
import type { ContentPack } from '../src/index.js';
import defaultPackJson from '../src/content/default.json';

describe('默认内容包 · 验收（issue #2）', () => {
  it('validateContentPack 通过', () => {
    const result = validateContentPack(defaultPackJson);
    if (!result.ok) {
      console.error(formatContentErrors(result.errors));
    }
    expect(result.ok).toBe(true);
  });

  it('loadDefaultContent 强校验通过并返回完整包', () => {
    const pack = loadDefaultContent();
    expect(pack.skills).toHaveLength(6);
    expect(pack.items).toHaveLength(42);
    expect(pack.recipes).toHaveLength(16);
    expect(pack.enemies).toHaveLength(8);
    expect(pack.gearDrops).toHaveLength(8);
    expect(pack.shop).toHaveLength(6);
  });

  it('织物线：灵蚕丝/冰蚕丝为采药副产出，布道袍用丝、甲胄用矿石', () => {
    const pack = loadDefaultContent();
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

  it('引擎兜底网：fist 招式与四系动词池齐备', () => {
    const pack = loadDefaultContent();
    expect(pack.combatText.moves.fist).toEqual(['搏兔一击', '石破天惊']);
    for (const style of ['sword', 'fist', 'claw', 'magic'] as const) {
      expect(pack.combatText.verbs[style].length).toBeGreaterThan(0);
    }
  });
});

/* ==================== 数值基线（防迁移走样，对照旧 js/data.js） ==================== */
/* 本节断言全部手抄自旧版 data.js；改动默认包数值必须是有意重设并同步更新此处。 */

describe('默认内容包 · 数值基线', () => {
  const pack: ContentPack = loadDefaultContent();
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
      pill_heal: ['pill', 18],
      pill_qi: ['pill', 50],
      pill_atk: ['pill', 130],
      pill_def: ['pill', 180],
      pill_gold: ['pill', 700],
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
      scorp_tail: ['equip', 25],
      wolf_fang: ['equip', 60],
      corpse_nail: ['equip', 130],
      ghost_mask: ['equip', 160],
      blood_gourd: ['equip', 420],
      luo_shayi: ['equip', 460],
      mojun_blade: ['equip', 780],
      mojun_guan: ['equip', 1250],
      taotie_fang: ['equip', 1550],
      taotie_pi: ['equip', 1650],
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
      ['scorp_tail', 'weapon', { atk: 5 }],
      ['wolf_fang', 'accessory', { crit: 4, atk: 2 }],
      ['corpse_nail', 'weapon', { atk: 15 }],
      ['ghost_mask', 'accessory', { def: 8, crit: 6 }],
      ['blood_gourd', 'weapon', { atk: 40 }],
      ['luo_shayi', 'body', { def: 30, hp: 220 }],
      ['mojun_blade', 'weapon', { atk: 70 }],
      ['mojun_guan', 'accessory', { atk: 10, def: 10, crit: 8 }],
      ['taotie_fang', 'weapon', { atk: 95, crit: 5 }],
      ['taotie_pi', 'body', { def: 75, hp: 500 }],
    ]);
  });

  it('丹药：回气丹恢复三成，增益丹时长五分钟', () => {
    expect(itemById.pill_heal.heal).toEqual({ percent: 0.3 });
    expect(itemById.pill_qi.effect).toEqual({ duration: 300000, multipliers: { gatherXp: 1.25 } });
    expect(itemById.pill_atk.effect).toEqual({ duration: 300000, multipliers: { atk: 1.2 } });
    expect(itemById.pill_def.effect).toEqual({ duration: 300000, multipliers: { def: 1.3 } });
    expect(itemById.pill_gold.effect).toEqual({
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
      ['炼制回气丹', 'alchemy', 1, 'pill_heal', { herb1: 2 }, 0.75, 3000, 8],
      ['炼制聚气丹', 'alchemy', 12, 'pill_qi', { herb1: 1, herb2: 1 }, 0.65, 4500, 20],
      ['炼制破煞丹', 'alchemy', 28, 'pill_atk', { herb2: 2, core1: 1 }, 0.6, 6000, 45],
      ['炼制凝神丹', 'alchemy', 42, 'pill_def', { herb3: 2 }, 0.55, 7500, 80],
      ['炼制九转金丹', 'alchemy', 65, 'pill_gold', { herb4: 2, ore4: 1, core2: 1 }, 0.45, 12000, 220],
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
      ['e3', '鬼面修士', 18, 'magic', 280, 32, 14, 2400, 95, { min: 28, max: 55 }, [{ item: 'core1', chance: 0.5 }, { item: 'pill_heal', chance: 0.15 }, { item: 'herb2', chance: 0.25 }]],
      ['e4', '尸傀', 30, 'claw', 560, 55, 26, 2600, 190, { min: 55, max: 95 }, [{ item: 'core2', chance: 0.3 }, { item: 'ore2', chance: 0.35 }]],
      ['e5', '血魔', 45, 'magic', 1050, 88, 46, 2400, 380, { min: 110, max: 190 }, [{ item: 'core2', chance: 0.45 }, { item: 'herb3', chance: 0.25 }]],
      ['e6', '阴罗妖将', 60, 'magic', 2000, 135, 82, 2200, 700, { min: 220, max: 380 }, [{ item: 'core3', chance: 0.3 }, { item: 'herb4', chance: 0.15 }]],
      ['e7', '魔君残魂', 78, 'magic', 3800, 205, 145, 2200, 1300, { min: 420, max: 720 }, [{ item: 'core3', chance: 0.45 }, { item: 'ore4', chance: 0.2 }]],
      ['e8', '上古凶兽·饕餮', 92, 'claw', 6000, 240, 150, 2400, 2600, { min: 850, max: 1500 }, [{ item: 'core3', chance: 0.8 }, { item: 'pill_gold', chance: 0.2 }]],
    ]);
  });

  it('异宝掉落表全表', () => {
    const rows = pack.gearDrops.map((g) => [g.enemy, g.chance, g.pool]);
    expect(rows).toEqual([
      ['e1', 0.1, ['scorp_tail', 'wolf_fang']],
      ['e2', 0.1, ['scorp_tail', 'wolf_fang']],
      ['e3', 0.09, ['corpse_nail', 'ghost_mask']],
      ['e4', 0.09, ['corpse_nail', 'ghost_mask']],
      ['e5', 0.08, ['blood_gourd', 'luo_shayi']],
      ['e6', 0.08, ['blood_gourd', 'luo_shayi']],
      ['e7', 0.07, ['mojun_blade', 'mojun_guan']],
      ['e8', 0.15, ['taotie_fang', 'taotie_pi']],
    ]);
  });

  it('坊市货架全表', () => {
    const rows = pack.shop.map((s) => [s.item, s.price]);
    expect(rows).toEqual([
      ['pill_heal', 45],
      ['pill_qi', 120],
      ['pill_atk', 320],
      ['pill_def', 450],
      ['silk', 15],
      ['bingsilk', 90],
    ]);
  });

  it('战斗文案：动词池/招式注册/词库结构', () => {
    const ct = pack.combatText;
    expect(Object.keys(ct.verbs)).toEqual(['sword', 'fist', 'claw', 'magic']);
    expect(ct.verbs.sword).toHaveLength(6);
    expect(ct.verbs.fist).toHaveLength(3);
    expect(ct.verbs.claw).toHaveLength(5);
    expect(ct.verbs.magic).toHaveLength(5);
    // 招式注册：fist + 9 件武器（4 剑 + 5 妖兵）+ 8 敌
    expect(Object.keys(ct.moves).sort()).toEqual(
      [
        'fist', 'sword1', 'sword2', 'sword3', 'sword4',
        'scorp_tail', 'corpse_nail', 'blood_gourd', 'mojun_blade', 'taotie_fang',
        'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8',
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
