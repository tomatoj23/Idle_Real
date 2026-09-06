// @vitest-environment happy-dom
/**
 * Batch1/T6 合成验收 tracer（#28）：西方魔幻迷你包接引擎跑通。
 *
 * 包体（@wendao/content/packs/fantasy）纯按协议层徒手编写、零引擎改动；
 * 本文件验证 T1-T5 的合成效果——挂机循环、战斗解算、装备掷点、事件流，
 * 以及同一套生产壳（buildUi，#26 后壳零题材字符串）直接渲染第二题材。
 */
import { describe, expect, it } from 'vitest';
import { loadFantasyPack } from '@wendao/content/packs/fantasy';
import { createGame, ManualClock, type GameAction } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 驱动 tick 直至条件满足（maxSteps 兜底断言防挂死）。 */
function runUntil(
  clock: ManualClock,
  game: ReturnType<typeof createGame>,
  done: () => boolean,
  maxSteps: number,
): void {
  for (let i = 0; i < maxSteps && !done(); i++) {
    clock.advance(3000);
    game.tick(3000);
  }
  expect(done()).toBe(true);
}

describe('fantasy tracer · 挂机循环', () => {
  it('开始采集 → 产出落袋 → 修为升级 → 事件流正常', () => {
    const clock = new ManualClock();
    const game = createGame({ content: loadFantasyPack(), clock, seed: 7 });
    const events: string[] = [];
    game.events.subscribe((event) => events.push(event.type));

    game.dispatch({ type: 'activity:start', payload: { skillId: 'herbalism', index: 0 } });
    // interval 1500ms：60 游戏秒 = 40 次完整采集（确定性产出）。
    for (let i = 0; i < 20; i++) {
      clock.advance(3000);
      game.tick(3000);
    }
    const st = game.snapshot().state;
    expect(st.items['herb']).toBe(40);
    // 副产出协议面在跑（概率性，仅断言无崩溃且池内）。
    expect(st.skills['herbalism']?.xp).toBeGreaterThan(0);
    expect(events).toContain('exp');
    expect(events).toContain('levelup');
  });
});

describe('fantasy tracer · 战斗解算与事件流', () => {
  it('挑战洞蝠 → 英语战斗叙事 → 胜利摘要 → 掉落/修为/金币', () => {
    const clock = new ManualClock();
    const game = createGame({ content: loadFantasyPack(), clock, seed: 11 });
    const attacks: string[] = [];
    const notes: string[] = [];
    let victory = false;
    game.events.subscribe((event) => {
      if (event.type === 'attack') attacks.push(String(event.data?.text ?? ''));
      if (event.type === 'combat-note') notes.push(String(event.data?.text ?? ''));
      if (event.type === 'victory') {
        victory = true;
        expect(String(event.data?.enemyName)).toBe('Cave Bat');
        expect(String(event.data?.summary)).toMatch(/^The fight lasted \d+ rounds/);
      }
    });

    game.dispatch({ type: 'combat:start', payload: { enemyId: 'cave_bat' } });
    runUntil(clock, game, () => victory, 40);

    // 英语文案由内容包模板填槽产出：出招句 + 后果句 + 系统 note。
    expect(attacks.length).toBeGreaterThan(0);
    expect(notes.some((text) => text.includes('Cave Bat'))).toBe(true);
    for (const text of [...attacks, ...notes]) {
      // 协议面验收：任何槽位都已被引擎填槽，无 {slot} 键名残留。
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
    const st = game.snapshot().state;
    expect(st.gold).toBeGreaterThan(0);
    expect(st.skills['swordplay']?.xp).toBeGreaterThan(0);
  });
});

describe('fantasy tracer · 装备掷点与佩戴', () => {
  it('魔像连猎 → 异宝掉落（稀有度/词条按词表实例化）→ 佩戴反映到属性', () => {
    const content = loadFantasyPack();
    const clock = new ManualClock();
    const game = createGame({ content, clock, seed: 3 });
    let victories = 0;
    game.events.subscribe((event) => {
      if (event.type === 'victory') victories += 1;
    });

    // 连猎魔像博异宝掉落。引擎语义（探针证实）：残血退避会退出自动再战，
    // 需重开战；无战可打时低血先嗑药/等脱战回血，金币够就补药（autoEat 兜底）。
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'arcane_golem' } });
    for (let i = 0; i < 800 && game.snapshot().state.gear.length === 0; i++) {
      const st = game.snapshot().state;
      const maxHp = game.snapshot().stats?.maxHp ?? 1;
      if (!st.combat) {
        if (st.hp < maxHp * 0.85 && (st.items['potion'] ?? 0) > 0) {
          game.dispatch({ type: 'consumable:eat', payload: { item: 'potion' } });
        } else if (st.hp >= maxHp * 0.85) {
          game.dispatch({ type: 'combat:start', payload: { enemyId: 'arcane_golem' } });
        }
      } else if ((st.items['potion'] ?? 0) < 2 && st.gold >= 8) {
        game.dispatch({ type: 'shop:buy', payload: { item: 'potion' } });
      }
      clock.advance(3000);
      game.tick(3000);
    }

    const gear = game.snapshot().state.gear;
    expect(gear.length).toBeGreaterThan(0);
    const rarityIds = ['plain', 'fine', 'mythic'];
    for (const instance of gear) {
      expect(rarityIds).toContain(instance.rarity);
      // 词条数与稀有度词表一致（plain 0 / fine 1 / mythic 2），词条值正值。
      const rarity = rarityIds.indexOf(instance.rarity);
      const expectedAffixes = [0, 1, 2][rarity];
      expect(instance.affixes).toHaveLength(expectedAffixes);
      for (const affix of instance.affixes) {
        expect(affix.val).toBeGreaterThan(0);
      }
    }
    expect(victories).toBeGreaterThan(0);

    // 佩戴：按掉落件 bonuses 键逐一断言对应快照属性严格增长
    // （模板 flat × 档位倍率投影 ≥ 模板值 > 0），AC 覆盖与掉落组合（RNG）解耦。
    const target = gear[0]!;
    const before = game.snapshot().stats;
    expect(before).toBeDefined();
    game.dispatch({ type: 'gear:equip', payload: { uid: target.uid } });
    const after = game.snapshot().stats;
    expect(after).toBeDefined();
    expect(Object.values(game.snapshot().state.equips)).toContain(target.uid);
    const bonuses = content.items.find((it) => it.id === target.itemId)?.bonuses ?? {};
    if (bonuses.atk) expect(after!.atk).toBeGreaterThan(before!.atk);
    if (bonuses.def) expect(after!.def).toBeGreaterThan(before!.def);
    if (bonuses.crit) expect(after!.crit).toBeGreaterThan(before!.crit);
    if (bonuses.hp) expect(after!.maxHp).toBeGreaterThan(before!.maxHp);
    expect(Object.keys(bonuses).length).toBeGreaterThan(0);
  });
});

describe('fantasy tracer · 最小壳渲染（生产 buildUi 直接装配第二题材）', () => {
  it('英语品牌/页签/属性行渲染，无 shell 键名回显，战斗文案入壳', () => {
    const clock = new ManualClock();
    const content = loadFantasyPack();
    const game = createGame({ content, clock, seed: 5 });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();

    // 品牌/侧栏/页签全部英语（texts.shell 驱动）。
    expect(root.textContent).toContain('Grim Vale');
    expect(root.textContent).toContain('Chronicle');
    expect(root.textContent).toContain('Skills');
    expect(root.textContent).toContain('Combat');
    expect(root.textContent).toContain('Bag');
    expect(root.textContent).toContain('Shop');
    // 壳零缺键：任何 texts.shell 键缺失都会以 "xxx.yyy" 键名回显（裁决 ④）。
    expect(root.textContent ?? '').not.toMatch(/\b(brand|topbar|tabs|side|stats|units|icons|common|events|pages)\.[a-z]/);

    // 顶栏属性行：atk/def/crit 快照 + crit 百分比量纲（statLabels percent 驱动）。
    expect(root.querySelector('#res-stats')!.textContent).toMatch(/^\d+\/\d+\/\d+%$/);

    // 斗法页：两个敌人卡（含自定义系别魔像），点击挑战 → 英语战斗文案入壳。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    expect(root.textContent).toContain('Cave Bat');
    expect(root.textContent).toContain('Arcane Golem');
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="cave_bat"]')!.click();
    let won = false;
    for (let i = 0; i < 40 && !won; i++) {
      clock.advance(3000);
      game.tick(3000);
      won = game.events.drain().some((event) => event.type === 'victory');
    }
    expect(won).toBe(true);
    ui.render();
    // 战后摘要画像（英语）已入战斗日志；槽位零残留。
    expect(root.textContent).toContain('Victory over Cave Bat!');
    expect(root.textContent).toContain('The fight lasted');
    expect(root.textContent).not.toContain('{rounds}');

    // 技能页：采集卡英语渲染，真实点击路径跑采集。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    ui.render();
    expect(root.textContent).toContain('Herbalism');
    expect(root.textContent).toContain('Pick Herbs');
  });
});
