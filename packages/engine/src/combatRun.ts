/**
 * CombatRun（#51，架构二轮卡 7a）：战斗状态机的拥有者。
 *
 * game.ts 巨石拆解第一步：逐轮循环（原 settleCombat）、攻击轮、召唤入场、
 * boss phase 推进、victory/defeat 结算全数收进本模块，只经 `step(dt)` 窄门
 * 驱动；敌投影（resolveEnemy/minionViewOf）与掉落掷定作为内部实现内聚于此
 * （D5）。CombatState 的持久存储仍在 GameState.combat（存档形状零变化，D3），
 * 但其**字段**（pt/et/respT/ehp/伤档/bossPhase/召唤槽）由本模块唯一读写——
 * game.ts 对战斗时序变量的直接引用就此清零（验收 1）。
 *
 * deps = 读取器集合（D2）：内容视图 / rng / 事件出口 / 战斗面板实时读取器
 * （战斗中吃丹、换装备立即生效，禁快照值）+ 咽喉与秘境窄门。闭包变量全部
 * 变显式依赖注入。系别临时态（elemExpiry，#15）是纯战斗瞬态：只存本模块
 * 内存、不落盘，开战/再战/离线一律 resetProcs（存档恢复即散尽）。
 *
 * 三不动（D3）：Game 对外四方法、dispatch 巨 switch、存档形状/SAVE_KEY
 * 均不因本模块引入而变化。秘境层推进（advance/leave）与停战序列仍住
 * game.ts（DungeonRun 归第二步票 #52），此处仅窄门回调。
 */

import {
  affinityMultiplier,
  calcDmg,
  compareEncounterText,
  emptyTally,
  fillTemplate,
  BASIC_KEY,
  hitTierOf,
  makeAttackText,
  pickText,
  rollCrit,
  summarizeRounds,
  type CombatTextPools,
  type ElementCombatPrimitive,
} from './combat.js';
import { gearName, rollGear, type GearInstance } from './gear.js';
import {
  dungeonFloorEnemyOf,
  dungeonLayerOf,
  findDungeon,
} from './dungeon.js';
import {
  bossEnemyOf,
  findBossOf,
  isLiveSummon,
  pickSummonEntry,
  summonMinionOf,
  summonPoolOf,
  type BossView,
} from './bosses.js';
import {
  findEnemy,
  findGearDrop,
  findItem,
  signatureOf,
  type CombatParamsView,
  type ElementSignatureView,
  type EnemyView,
  type SkillView,
} from './contentView.js';
import type { CombatState, CombatSummonState, DungeonState } from './state.js';
import type { CombatMinionProjection, GameContent, GameEvent } from './types.js';
import type { LedgerSource } from './ledger.js';

/**
 * 战斗态构造单一来源（#44 D2 锚点，随 #51 迁驻本模块）：初入开团与再战
 * 重置共用一处构造，rounds/crits/tiers 一律出自 emptyTally（combat.ts 导出
 * 面）——手写 CombatState/tally 字面量保持清零（存档恢复逐项钳制除外，
 * state.ts）。
 */
export function makeCombatState(enemyId: string, ehp: number): CombatState {
  return {
    enemyId,
    ehp,
    pt: 0,
    et: 0,
    respT: 0,
    ...emptyTally(),
    bossPhase: -1,
    summons: [],
  };
}

/**
 * CombatRun 依赖面（D2 读取器集合）：全部显式注入，禁快照值——面板类
 * 依赖每次调用现读（战斗中吃丹/换装备即时生效）。战斗路径的入账恒
 * META_IDLE / 'combat' 语义，咽喉窄面不再带 meta 参数。
 */
export interface CombatRunDeps {
  /** 内容包（引擎零内容感知：敌人/Boss/秘境/器胚掉落全读此视图）。 */
  readonly content: GameContent;
  /** 战斗参数（config.combat 缺省回落后的一次解析视图）。 */
  readonly cparams: CombatParamsView;
  /** 战斗词库（combatText 节）。 */
  readonly combatText: CombatTextPools;
  /** 注入随机源（ADR-013：随机一律走此源）。 */
  readonly random: () => number;
  /** 游戏内时间（毫秒）：事件戳与系别临时态过期基准。 */
  readonly now: () => number;
  /** 事件出口（EventBus 发射；事件由本模块组完整 payload）。 */
  readonly emit: (event: GameEvent) => void;
  /** 系统 note 文案读取器（combatText.notes 池抽句；缺失回显键，#019）。 */
  readonly note: (key: string, vars?: Readonly<Record<string, string>>) => string;

  /** 战斗态存取句柄：GameState.combat 的唯一读写门（字段归本模块所有）。 */
  readonly combat: {
    get(): CombatState | null;
    set(next: CombatState | null): void;
  };

  /** 战斗面板实时读取器（D2 核心读取器，全部现读）。 */
  readonly panel: {
    /** 当前气血（活读；敌击/败退写入走 setHp）。 */
    hp(): number;
    setHp(value: number): void;
    /** 气血上限（脱战语境投影）。 */
    maxHp(): number;
    /** low-hp 血线（与入场门控同一条线，#44 isLowHp）。 */
    lowHp(): boolean;
    /** 双方语境战斗面板：攻侧 moveId+系别、防侧来袭系别（#15 条件修饰符）。 */
    battleStats(enemy: EnemyView): { atk: number; crit: number; def: number; maxHp: number };
    /** 玩家出招注册键（佩戴武器 itemId，缺省兜底键）。 */
    moveKey(): string;
    /** 玩家攻击系别（武器 element；无 = 凡击 undefined）。 */
    element(): string | undefined;
    /** 玩家动词池键。 */
    verbStyle(): string;
    /** 兵刃展示名（无武器 = 基础名）。 */
    weaponName(): string;
    /** 玩家武器系别机制签名（未注册/纯风味 = undefined，#15）。 */
    signature(): ElementSignatureView | undefined;
  };

  /** 玩家旗标（自动再战/自动嗑丹，实时读取）。 */
  readonly flags: {
    autoFight(): boolean;
    autoEat(): boolean;
  };

  /** 入账咽喉窄面（#39）：灵石/物品/装备/修为/道韵五路，战斗侧恒 idle 归段。 */
  readonly ledger: {
    gold(delta: number, source: LedgerSource): void;
    /** 物品入袋（折叠挂点在内）；返回是否实际入袋（旧 loot 门控，D10）。 */
    item(itemId: string, count: number, source: LedgerSource): boolean;
    /** 装备实例入账（折叠挂点在内）；返回是否实际入袋。 */
    gearIncome(gear: GearInstance, source: LedgerSource): boolean;
    /** 斗法修为实发（xpMult 消费在咽喉内；返回实发值）。 */
    exp(skill: SkillView, amount: number): number;
    daoYun(delta: number, source: LedgerSource): void;
  };

  /** 斗法技能（修为发放载体；包未定义 = undefined）。 */
  readonly combatSkill: () => SkillView | undefined;

  /** 装备 uid 序列器窄门（state.gearSeq）：掷定前取号、实得后落账。 */
  readonly gearSeq: {
    next(): number;
    commit(uid: number): void;
  };

  /** 同对手上一战记录（对照语基准）：读旧 + 写新。 */
  readonly encounter: {
    prevOf(enemyId: string): { rounds: number; won: boolean; at: number } | undefined;
    record(enemyId: string, rounds: number, won: boolean): void;
  };

  /** 秘境窄门（DungeonRun 归 #52）：攻略指针 + 层推进 + 离境。 */
  readonly dungeon: {
    /** 当前攻略（无 = null）：敌投影层倍率 / 掉落筛层 / 层奖励三处消费。 */
    current(): DungeonState | null;
    /** 胜利休整到期：顶层通关离境或推进下一层（残血退避同律，#7）。 */
    advance(): void;
    /** 离境（败退/敌失引用自愈；撤退走 stopCombat，#7）。 */
    leave(): void;
  };

  /** 停战序列（撤退 note + 清战斗态 + 离境）：dispatch 面与战斗面共用一条序。 */
  readonly stopCombat: (note?: string) => void;

  /** 自动嗑丹执行面（静默服用；事件与入账在 game 侧咽喉）。 */
  readonly eatSilent: (itemId: string) => void;
  /** 背包首个 heal 类消耗品（引擎零内容感知：扫描面在 game 侧）。 */
  readonly findHealConsumable: () => string | undefined;
}

/** CombatRun 对外窄门：战斗推进 + 开战复位 + 快照投影（#40 消费面）。 */
export interface CombatRun {
  /**
   * 战斗大步长结算：按「下一次出招」逐事件推进，dt 消化完或战斗结束为止
   * （与 settleActivity 同语义：假时钟全速模拟一次 tick 可补多轮）。
   * 休整期（respT）内不回血不接战，到期按 autoFight 决定再战或离场。
   */
  step(dt: number): void;
  /** 开战复位：系别临时态归零（enterCombat/离线离场序消费，#15/#44）。 */
  resetProcs(): void;
  /** 战斗中敌人生效视图（resolveEnemy 单点组合）；无战斗 = null。 */
  enemyProjection(): EnemyView | null;
  /** 召唤物视图组（槽位序 = 集火序）；无战斗 = null，失效槽位剔除。 */
  minionProjections(): CombatMinionProjection[] | null;
}

/** CombatRun 工厂：闭包持有 deps 与系别临时态，返回窄门。 */
export function createCombatRun(deps: CombatRunDeps): CombatRun {
  const { content, cparams, combatText, random, now, emit } = deps;

  /**
   * 系别临时态过期时刻（#15）：金·破防 / 水·滞缓 / 风·迅疾 → 过期游戏内
   * 时间。**只在 run 内存，不落盘**（票面约束：抗性/临时态不进存档新字段）
   * ——开战/再战/离线一律 resetProcs，存档恢复即散尽。数值不在此存：每次
   * 消费按当前武器系别现读 content 签名（改包即生效，无第二份缓存）。
   */
  const elemExpiry: Record<ElementCombatPrimitive, number> = { defenseBreak: 0, slow: 0, swift: 0 };
  const resetProcs = (): void => {
    for (const primitive of Object.keys(elemExpiry)) {
      elemExpiry[primitive as ElementCombatPrimitive] = 0;
    }
  };

  /** 战斗 note 叙事发射（text 由 deps.note 读取器出句，#019）。 */
  function emitNote(text: string, enemyId?: string): void {
    emit({ type: 'combat-note', time: now(), data: enemyId ? { text, enemyId } : { text } });
  }

  /** 系别命中：机械原语签名即时生效（过期时间 = 当前时刻 + 时长，命中即续）。 */
  function applyElementProc(element: string | undefined): void {
    const signature = element !== undefined ? signatureOf(content, element) : undefined;
    if (!signature) return;
    elemExpiry[signature.primitive as ElementCombatPrimitive] = now() + signature.duration!;
  }

  /** 临时态在效时取原语参数（比例钳 [0,1)，防御坏内容；系数现读 content）。 */
  function activeSignatureValue(
    primitive: ElementCombatPrimitive,
    expiry: number,
    signature: ElementSignatureView | undefined,
  ): number {
    if (!signature || signature.primitive !== primitive || expiry <= now()) return 0;
    return Math.min(0.999, Math.max(0, signature.value ?? 0));
  }

  /**
   * 战斗中的敌人解析（#7/#8 单点组合）：秘境层倍率投影在前，Boss 阶段
   * 修正在后（叠乘——秘境深层插 Boss 零特判）；两者皆无 = 敌人定义原值。
   */
  function resolveEnemy(enemyId: string): EnemyView | undefined {
    const run = deps.dungeon.current();
    let view = run
      ? dungeonFloorEnemyOf(content, run.dungeonId, run.floor, enemyId)
      : findEnemy(content, enemyId);
    if (!view) return undefined;
    const c = deps.combat.get();
    if (c !== null && c.bossPhase >= 0) {
      view = bossEnemyOf(content, enemyId, c.bossPhase, view) ?? view;
    }
    return view;
  }

  /**
   * 召唤物投影（#30）：秘境层倍率在前（与主 Boss 同律）、召唤 mult 乘区在后；
   * 池行缺失/包变更（阶段缩表）= undefined（调用方清槽，绝不崩）。
   */
  function minionViewOf(minion: CombatSummonState): EnemyView | undefined {
    const c = deps.combat.get();
    if (!c) return undefined;
    const boss = findBossOf(content, c.enemyId);
    if (!boss) return undefined;
    const run = deps.dungeon.current();
    const scaled = run ? dungeonFloorEnemyOf(content, run.dungeonId, run.floor, minion.enemyId) : undefined;
    const base = scaled ?? findEnemy(content, minion.enemyId);
    if (!base) return undefined;
    return summonMinionOf(content, boss, minion.phase, minion.enemyId, base) ?? base;
  }

  /** 装备实例展示名（「档名·物品名」拼装式，与 game.ts 掉落/熔炼同式）。 */
  const gearDisplayName = (gear: GearInstance): string =>
    gearName(content, findItem(content, gear.itemId)?.name ?? gear.itemId, gear.rarity);

  /** 掉落 loot 事件（与 game.ts 旧 emitLoot 同形载荷；物品名缺省回显键，#019）。 */
  function emitLoot(item: string, count: number, source: string): void {
    const def = findItem(content, item);
    emit({
      type: 'loot',
      time: now(),
      data: { item, itemName: def?.name ?? item, count, source },
    });
  }

  /**
   * 材料掉落掷定（victory 消费；enemy.drops 与 bosses[].drops 两池同式叠加，
   * 命中才入账 + 播报 + 计入事件载荷 drops 表；掷点次序与旧两段循环一致）。
   */
  function rollDrops(
    entries: readonly { item?: string; chance: number }[] | undefined,
    drops: string[],
  ): void {
    for (const drop of entries ?? []) {
      if (drop.item && random() < drop.chance) {
        if (deps.ledger.item(drop.item, 1, 'combat')) {
          emitLoot(drop.item, 1, 'drop');
          drops.push(drop.item);
        }
      }
    }
  }

  /**
   * 召唤入场（#30，阶段进入时消费）：逐槽从脚本池按权重抽签（dungeon 加权
   * 抽敌同式），召唤物以缩放投影的满血入场（集火序 = 入场序）；池行全缺失
   * = 该槽跳过（防御路径，绝不崩）。入场播 boss:summon 事件 + 叙事池抽句
   * （池缺省 = 不播报，不造句）。投影走 minionViewOf 同一组合面（秘境层
   * 倍率在前、召唤 mult 在后）——入场即实战视图，禁第二份缩放组合。
   */
  function spawnSummons(boss: BossView, bossEnemy: EnemyView, phaseIndex: number, c: CombatState): void {
    const pool = summonPoolOf(boss, phaseIndex);
    const count = Math.max(0, Math.floor(boss.phases[phaseIndex]?.summons?.count ?? 0));
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const entry = pickSummonEntry(content, pool, random);
      if (!entry) break;
      const slot: CombatSummonState = { enemyId: entry.enemy, phase: phaseIndex, hp: 0, et: 0 };
      const view = minionViewOf(slot);
      if (!view) continue;
      slot.hp = view.hp;
      c.summons.push(slot);
      spawned += 1;
    }
    if (spawned === 0) return;
    const name = typeof boss.phases[phaseIndex]?.name === 'string' ? boss.phases[phaseIndex]!.name : '';
    emit({
      type: 'boss:summon',
      time: now(),
      data: { enemyId: boss.enemy, enemyName: bossEnemy.name, phase: phaseIndex + 1, count: spawned },
    });
    const narration = pickText(boss.phases[phaseIndex]?.summons?.narration, random);
    if (narration !== undefined) {
      emitNote(fillTemplate(narration, { enemy: bossEnemy.name, phase: name }), boss.enemy);
    }
  }

  /**
   * Boss 阶段推进（#8，玩家一击落点后消费）：血量比例 ≤ 阈值即进入该阶段；
   * 单击跨多阈值逐级补发（每级一次 boss:phase 事件 + 阶段叙事 + 召唤入场）。
   * 阶段修正经 resolveEnemy 在后续轮次解算生效（bossPhase 随战斗态持久，
   * 自动再战重置归位）；普通敌人（未注册 Boss）恒跳过。
   */
  function checkBossPhase(enemy: EnemyView, c: CombatState): void {
    const boss = findBossOf(content, enemy.id);
    if (!boss || c.bossPhase >= boss.phases.length - 1) return;
    const ratio = enemy.hp > 0 ? c.ehp / enemy.hp : 1;
    while (c.bossPhase + 1 < boss.phases.length) {
      const next = boss.phases[c.bossPhase + 1]!;
      const threshold =
        typeof next.threshold === 'number' && Number.isFinite(next.threshold) ? next.threshold : 0;
      if (ratio > threshold) break;
      c.bossPhase += 1;
      const name = typeof next.name === 'string' && next.name.length > 0 ? next.name : '';
      emit({
        type: 'boss:phase',
        time: now(),
        data: { enemyId: enemy.id, enemyName: enemy.name, phase: c.bossPhase + 1, name },
      });
      const narration = pickText(next.narration, random);
      if (narration !== undefined) {
        emitNote(fillTemplate(narration, { enemy: enemy.name, phase: name }), enemy.id);
      }
      spawnSummons(boss, enemy, c.bossPhase, c); // 召唤原语（#30）：阶段声明的召唤入场
    }
  }

  /**
   * 玩家一击（#30 多敌目标选择）：召唤物在场时集火最老召唤物（先入先出），
   * 清场后回到主目标（reengage 叙事复用）。伤害链：系别签名（破防/亲和/风味）
   * → 暴击 roll → 减伤解算（可含金·破防）→ 亲和乘区 → 暴击乘区；伤害档对
   * **未破防**期望判档——破防/克制的可观测签名 = 档位跃迁（ADR-012）。
   * 召唤物死亡只清槽位（无收益结算）；主目标死亡才走 victory。
   */
  function playerAttackRound(enemy: EnemyView, c: CombatState): void {
    // 集火目标：召唤物槽首（失效槽位经 isLiveSummon 同一谓词清弃，#48；
    // 恢复侧/逐轮过滤同律），回落主目标。
    const boss = findBossOf(content, c.enemyId);
    let focus = c.summons[0];
    if (focus !== undefined && (boss === undefined || !isLiveSummon(content, boss, focus))) {
      c.summons.shift();
      focus = undefined;
    }
    const focusView = focus !== undefined ? minionViewOf(focus) : undefined;
    const target = focusView ?? enemy;
    const onMinion = focusView !== undefined;

    const moveKey = deps.panel.moveKey();
    const element = deps.panel.element();
    const { atk, crit: critChance } = deps.panel.battleStats(target);
    // 金·破防（临时态在效）：受击者 def 临时降低 → 减伤解算按破防后 def。
    const signature = deps.panel.signature();
    const breakValue = activeSignatureValue('defenseBreak', elemExpiry.defenseBreak, signature);
    const defEff = target.def * (1 - breakValue);
    const dmgBase = calcDmg(atk, defEff, random, cparams);
    // 亲和乘区（#25 预留 affinities 的引擎消费面）：受击者对该系的易伤/抗性。
    const affinity = element !== undefined ? target.affinities?.[element] : undefined;
    let dmg = Math.max(1, Math.round(dmgBase * affinityMultiplier(affinity)));
    const crit = rollCrit(critChance, random);
    if (crit) dmg = Math.round(dmg * cparams.critMultiplier);
    if (onMinion && focus) focus.hp -= dmg;
    else c.ehp -= dmg;
    c.rounds += 1;
    if (crit) c.crits += 1;
    // 系别命中：机械签名临时态即时生效（命中即续，时长归 content）。
    applyElementProc(element);
    // 伤害档对未破防/未亲和的期望判档：破防/克制读高档、被克读轻档（签名可见）。
    const tier = hitTierOf(dmg, atk, target.def, cparams);
    c.tiers[tier] += 1;
    const text = makeAttackText(
      combatText,
      {
        side: 'player',
        enemyName: target.name,
        moveKey,
        verbStyle: deps.panel.verbStyle(),
        weaponName: deps.panel.weaponName(),
        dmg,
        crit,
        atk,
        defenderDef: target.def,
        defenderHp: Math.max(0, onMinion && focus ? focus.hp : c.ehp),
        defenderMaxHp: target.hp,
        ...(element !== undefined ? { element } : {}),
        ...(affinity !== undefined ? { affinity } : {}),
      },
      random,
      cparams,
    );
    emit({
      type: 'attack',
      time: now(),
      data: {
        side: 'player',
        enemyId: target.id,
        enemyName: target.name,
        text,
        dmg,
        crit,
        tier,
        ...(element !== undefined ? { element } : {}),
      },
    });
    if (onMinion && focus) {
      if (focus.hp <= 0) {
        c.summons.shift();
        if (c.summons.length === 0) {
          // 清场回到主目标（#30 验收语义；叙事复用 reengage 池，零新词库键）。
          emitNote(deps.note('reengage', { enemy: enemy.name }), enemy.id);
        }
      }
      return;
    }
    if (c.ehp <= 0) {
      victory(enemy, c);
      return;
    }
    checkBossPhase(enemy, c); // Boss 阶段阈值推进（#8；普通敌人空转）
  }

  /**
   * 敌方一击：减伤解算 → 文案 → 玩家倒下判定。moveKeyOverride = 召唤物出招键
   * （#30：召唤物以自身敌 id 注册招式，不继承 Boss 阶段变招；缺省 = 主敌人
   * Boss 阶段变招语义不变）。
   */
  function enemyAttackRound(enemy: EnemyView, c: CombatState, moveKeyOverride?: string): void {
    const { def, maxHp } = deps.panel.battleStats(enemy);
    const dmg = calcDmg(enemy.atk, def, random, cparams);
    deps.panel.setHp(deps.panel.hp() - dmg);
    const tier = hitTierOf(dmg, enemy.atk, def, cparams);
    // 变招（#8）：Boss 当前阶段声明的出招注册键覆盖敌人 id 键（未声明回退）。
    let moveKey: string;
    if (typeof moveKeyOverride === 'string' && moveKeyOverride.length > 0) {
      moveKey = moveKeyOverride;
    } else {
      const boss = findBossOf(content, enemy.id);
      const phaseMoveKey = boss && c.bossPhase >= 0 ? boss.phases[c.bossPhase]?.moveKey : undefined;
      moveKey = typeof phaseMoveKey === 'string' && phaseMoveKey.length > 0 ? phaseMoveKey : enemy.id;
    }
    const text = makeAttackText(
      combatText,
      {
        side: 'enemy',
        enemyName: enemy.name,
        moveKey,
        // 动词池键 = 敌人内容声明的 kind（开放键域，#021 批 4）；'claw' 不再是
        // 引擎缺省词汇，防御路径回落引擎兜底键（未注册由文案层再兜底）。
        verbStyle: enemy.kind ?? BASIC_KEY,
        weaponName: '',
        dmg,
        crit: false,
        atk: enemy.atk,
        defenderDef: def,
        defenderHp: Math.max(0, deps.panel.hp()),
        defenderMaxHp: maxHp,
        // 敌方系别（#15）：风味句按攻方系别路由；玩家侧无亲和表，语境缺省。
        ...(enemy.element !== undefined ? { element: enemy.element } : {}),
      },
      random,
      cparams,
    );
    emit({
      type: 'attack',
      time: now(),
      data: {
        side: 'enemy',
        enemyId: enemy.id,
        enemyName: enemy.name,
        text,
        dmg,
        tier,
        ...(enemy.element !== undefined ? { element: enemy.element } : {}),
      },
    });
    if (deps.panel.hp() <= 0) defeat(enemy, c);
  }

  /** 胜利结算：灵石/材料/异宝掉落 + 斗法修为 + 签名画像与同对手对照。 */
  function victory(enemy: EnemyView, c: CombatState): void {
    const goldRange = enemy.gold;
    const goldGain = goldRange
      ? Math.floor(goldRange.min + random() * (goldRange.max - goldRange.min + 1))
      : 0;
    deps.ledger.gold(goldGain, 'combat');

    const drops: string[] = [];
    rollDrops(enemy.drops, drops);

    // Boss 专属掉落（#8）：与 enemy.drops 同机制叠加掷点（bosses[].drops）。
    rollDrops(findBossOf(content, enemy.id)?.drops, drops);

    let gearDropName: string | undefined;
    const gearDrop = findGearDrop(content, enemy.id);
    if (gearDrop) {
      // 掉落管线（#14 补全 ①②③⑦）：①掉不掉 → ②按秘境层数筛器胚池 → ③选底材
      // → ④~⑦实例化（equip 走词条池旧管线；器胚走铭纹管线）。稀有度掷点不传
      // 偏置（#5 接缝：掉落侧与旧签名逐点同分布）；uid 只在实得时入账（不空烧序号）。
      const gear = rollGear(content, gearDrop, deps.gearSeq.next(), random, {
        floor: deps.dungeon.current()?.floor,
      });
      if (gear) {
        deps.gearSeq.commit(gear.uid);
        if (deps.ledger.gearIncome(gear, 'combat')) {
          gearDropName = gearDisplayName(gear);
          emit({
            type: 'loot',
            time: now(),
            data: {
              item: gear.itemId,
              itemName: gearDropName,
              count: 1,
              source: 'gear',
              rarity: gear.rarity,
              uid: gear.uid,
            },
          });
        }
      }
    }

    const skill = deps.combatSkill();
    // 载荷记实发值（xpMult 后，ledger.exp 返回值），与修行录账本同源；
    // 名义值口径曾致带 xpMult 天赋时战斗日志与账本对不上。
    const gained = skill ? deps.ledger.exp(skill, enemy.exp) : 0;

    const tally = { rounds: c.rounds, crits: c.crits, tiers: c.tiers };
    const summary = summarizeRounds(tally, combatText, random);
    const prev = deps.encounter.prevOf(enemy.id);
    const compare = compareEncounterText(prev, c.rounds, combatText, random);
    deps.encounter.record(enemy.id, c.rounds, true);
    c.respT = cparams.victoryRestMs; // 战斗态保留（ehp ≤ 0），休整后按 autoFight 决定去留
    c.summons = []; // Boss 死亡清场（#30）：残存召唤物随主敌溃散，不参与结算

    emit({
      type: 'victory',
      time: now(),
      data: {
        enemyId: enemy.id,
        enemyName: enemy.name,
        gold: goldGain,
        rounds: c.rounds,
        exp: gained,
        summary,
        drops,
        ...(gearDropName !== undefined ? { gearDropName } : {}),
        ...(prev !== undefined ? { prevEncounter: prev } : {}),
        ...(compare !== undefined ? { compare } : {}),
      },
    });

    // 秘境层奖励（#7）：层表 rewards 逐项入账 + dungeon:floor 事件；
    // 道韵双键同律（daoYunEarned 只增不减——花掉不回锁，深层秘境供养兵解）。
    const loc = deps.dungeon.current();
    if (loc) {
      const dungeon = findDungeon(content, loc.dungeonId);
      const rewards = dungeon ? dungeonLayerOf(dungeon, loc.floor)?.rewards : undefined;
      const goldReward =
        typeof rewards?.gold === 'number' && Number.isFinite(rewards.gold) && rewards.gold > 0
          ? Math.floor(rewards.gold)
          : 0;
      deps.ledger.gold(goldReward, 'dungeon');
      const items: Record<string, number> = {};
      for (const stack of rewards?.items ?? []) {
        const count = stack?.count;
        if (typeof stack?.item === 'string' && typeof count === 'number' && Number.isFinite(count) && count > 0) {
          if (deps.ledger.item(stack.item, Math.floor(count), 'dungeon')) {
            items[stack.item] = (items[stack.item] ?? 0) + Math.floor(count);
          }
        }
      }
      const rawDaoYun = rewards?.daoYun;
      const daoYunReward =
        typeof rawDaoYun === 'number' && Number.isFinite(rawDaoYun) && rawDaoYun > 0
          ? Math.floor(rawDaoYun)
          : 0;
      deps.ledger.daoYun(daoYunReward, 'dungeon');
      emit({
        type: 'dungeon:floor',
        time: now(),
        data: {
          dungeonId: loc.dungeonId,
          dungeonName: dungeon?.name ?? loc.dungeonId,
          floor: loc.floor,
          floors: dungeon?.floors ?? 0,
          gold: goldReward,
          daoYun: daoYunReward,
          items,
        },
      });
    }
  }

  /** 落败：残血被救回，对照记录 won=false（「前番不敌」的基准）。 */
  function defeat(enemy: EnemyView, c: CombatState): void {
    const maxHp = deps.panel.battleStats(enemy).maxHp;
    deps.panel.setHp(Math.max(1, Math.round(maxHp * cparams.lowHpFraction)));
    deps.combat.set(null);
    deps.encounter.record(enemy.id, c.rounds, false);
    deps.dungeon.leave(); // 秘境败退：攻略作废，最高层记录保留（#7）
    emit({
      type: 'defeat',
      time: now(),
      data: { enemyId: enemy.id, enemyName: enemy.name },
    });
  }

  function step(dt: number): void {
    let remaining = dt;
    let guard = 0;
    while (remaining > 0 && deps.combat.get() && guard++ < 1_000_000) {
      const c = deps.combat.get()!;
      const enemy = resolveEnemy(c.enemyId);
      if (!enemy) {
        deps.combat.set(null); // 内容包已变更：安全弃置
        deps.dungeon.leave(); // 秘境层敌失引用：连攻略一并自愈（防孤儿锁死 enter/combat:start）
        return;
      }
      if (c.respT > 0) {
        const stepMs = Math.min(remaining, c.respT);
        c.respT -= stepMs;
        remaining -= stepMs;
        if (c.respT <= 0) {
          if (deps.dungeon.current()) {
            // 秘境推进（#7）：残血退避同律（挂机不送死，离境保留最高层），
            // 否则自动进入下一层——层序列与 autoFight 开关无关（爬塔即挂机）。
            if (deps.panel.lowHp()) {
              deps.stopCombat(deps.note('retreatWounded'));
              return;
            }
            deps.dungeon.advance();
            continue;
          }
          if (deps.flags.autoFight()) {
            // 自动再战前复查气血：残血且无自动补给时退避（挂机不送死）。
            if (deps.panel.lowHp()) {
              deps.stopCombat(deps.note('retreatWounded'));
              return;
            }
            // 再战重置 = 同敌按单一构造源整态重置（#44 D2）：敌方气血恢复、
            // 计时/伤档清零、阶段从头演（#8）、召唤清场（#30）；循环顶重读
            // 战斗态句柄，旧态引用就此弃用。
            deps.combat.set(makeCombatState(c.enemyId, enemy.hp));
            resetProcs(); // 系别临时态随再战归零（Boss 重生不带残效，#15）
            emitNote(deps.note('reengage', { enemy: enemy.name }), c.enemyId);
          } else {
            deps.stopCombat(deps.note('retreatVictory'));
            return;
          }
        }
        continue;
      }
      // 自动服药（血线触发；目标为背包中首个 heal 类消耗品，引擎零内容感知）
      if (deps.flags.autoEat() && deps.panel.hp() < deps.panel.maxHp() * cparams.autoEatHpFraction) {
        const healConsumable = deps.findHealConsumable();
        if (healConsumable) deps.eatSilent(healConsumable);
      }
      if (!deps.combat.get()) return;
      // 推进到下一个事件点（玩家出招 / 主敌人出招 / 召唤物出招 / dt 消化完）
      // 有效间隔 = 基础间隔 ×（1 ∓ 系别速率修正，#15）：风·迅疾缩短玩家间隔、
      // 水·滞缓延长敌方间隔（临时态在效时；系数现读 content 签名）。
      // 敌人缺省攻击间隔 = 玩家间隔（config.combat.playerAttackInterval，#020）。
      const signature = deps.panel.signature();
      const pInterval = Math.max(
        1,
        Math.round(
          cparams.playerAttackInterval * (1 - activeSignatureValue('swift', elemExpiry.swift, signature)),
        ),
      );
      const enemyBase = Math.max(1, enemy.attackInterval ?? cparams.playerAttackInterval);
      const eInterval = Math.max(
        1,
        Math.round(enemyBase * (1 + activeSignatureValue('slow', elemExpiry.slow, signature))),
      );
      // 投影失效的召唤槽位防御性清弃（isLiveSummon 单一谓词，#48；恢复侧同律——
      // 池外槽/包变更缩表/敌移除逐轮弃置；Boss 未注册 = 无效槽全清）。
      const summonBoss = findBossOf(content, c.enemyId);
      if (c.summons.length > 0) {
        c.summons = summonBoss
          ? c.summons.filter((minion) => isLiveSummon(content, summonBoss, minion))
          : [];
      }
      // 召唤物有效间隔（#30）：攻击间隔随内容定义（缺省 = 玩家间隔），不受
      // 水·滞缓影响（滞缓签名作用于主敌人；召唤物威胁量归 summon mult 调参）。
      const minionIntervals = c.summons.map((minion) => {
        const view = minionViewOf(minion)!;
        return Math.max(1, view.attackInterval ?? cparams.playerAttackInterval);
      });
      let stepMs = Math.min(remaining, pInterval - c.pt, eInterval - c.et);
      c.summons.forEach((minion, i) => {
        stepMs = Math.min(stepMs, minionIntervals[i]! - minion.et);
      });
      stepMs = Math.max(0, stepMs);
      c.pt += stepMs;
      c.et += stepMs;
      c.summons.forEach((minion) => {
        minion.et += stepMs;
      });
      remaining -= stepMs;
      if (c.pt >= pInterval) {
        c.pt -= pInterval;
        playerAttackRound(enemy, c);
        if (!deps.combat.get()) return;
      }
      if (c.et >= eInterval) {
        c.et -= eInterval;
        enemyAttackRound(enemy, c);
        if (!deps.combat.get()) return;
      }
      // 召唤物各自出招（#30）：出招键 = 自身敌 id（不继承 Boss 阶段变招）。
      // 间隔现取（玩家一击可能清槽，预计算的 intervals 不再对位）；迭代中
      // 召唤物不会被移除（召唤物攻击只可能击倒玩家 → defeat 早退）。
      for (const minion of [...c.summons]) {
        const view = minionViewOf(minion);
        if (!view) continue;
        const mInterval = Math.max(1, view.attackInterval ?? cparams.playerAttackInterval);
        if (minion.et >= mInterval) {
          minion.et -= mInterval;
          enemyAttackRound(view, c, minion.enemyId);
          if (!deps.combat.get()) return;
        }
      }
    }
  }

  /** 战斗中敌人生效视图（#40）：浅拷脱离 content 引用，快照自持。 */
  function enemyProjection(): EnemyView | null {
    const c = deps.combat.get();
    if (!c) return null;
    const view = resolveEnemy(c.enemyId);
    return view ? { ...view } : null;
  }

  /**
   * 召唤物视图组（#40，minionViewOf 单点组合，槽位序 = 集火序）：投影失效
   * 槽位剔除——与战斗内清槽同律，绝不崩。槽位态浅拷脱离活状态（hp/et 随
   * tick 就地变更，快照必须自持，与 cloneState 同律）。
   */
  function minionProjections(): CombatMinionProjection[] | null {
    const c = deps.combat.get();
    if (!c) return null;
    const rows: CombatMinionProjection[] = [];
    for (const minion of c.summons) {
      const view = minionViewOf(minion);
      if (view) rows.push({ minion: { ...minion }, view: { ...view } });
    }
    return rows;
  }

  return { step, resetProcs, enemyProjection, minionProjections };
}
