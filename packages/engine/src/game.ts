import { EventBus } from './events.js';
import { realClock } from './clock.js';
import { createRng } from './rng.js';
import { levelFromXp, maxHpForLevel } from './progression.js';
import {
  affixParamsOf,
  combatLevelOf,
  combatParamsOf,
  combatTextOf,
  enemyGateOf,
  findActivity,
  findEnemy,
  findGearDrop,
  findItem,
  findShopEntry,
  playerMaxHp,
  progressionParamsOf,
  skillsOf,
  textsOf,
  type ActivityView,
  type EnemyView,
  type ItemView,
  type SkillView,
} from './contentView.js';
import {
  calcDmg,
  compareEncounterText,
  fillTemplate,
  hitTierOf,
  makeAttackText,
  pickText,
  rollCrit,
  summarizeRounds,
  type DamageTier,
} from './combat.js';
import {
  gearContributions,
  gearName,
  gearSell,
  makeGear,
  rollRarity,
  type GearInstance,
} from './gear.js';
import {
  cloneState,
  initialState,
  restoreState,
  type CombatState,
  type GameState,
} from './state.js';
import type { Clock, GameAction, GameContent, PlayerStatsView, SaveData } from './types.js';
import {
  aggregateStats,
  type AggregationContext,
  type Contribution,
} from './modifiers.js';

export interface CreateGameOptions {
  /** 由 content 包校验过的内容包；引擎零内容感知，仅透明持有。 */
  readonly content: GameContent;
  /** 恢复存档；缺省从零开局。 */
  readonly save?: SaveData;
  /** 时钟注入点；缺省真实时钟，测试可注入 ManualClock。 */
  readonly clock?: Clock;
  /** 无存档时的初始 RNG 种子；缺省 1（确定性纪律：随机状态随档持久化）。 */
  readonly seed?: number;
  /** 注入随机源（测试用）；注入后引擎不再维护种子持久化。 */
  readonly rng?: () => number;
  /**
   * 静态全局修饰符贡献（issue #13 接缝）：宗门加成/转生天赋/测试桩等
   * 无实体状态的产出方从这里注入，全部经聚合管线（ADR-011）结算；
   * 装备/丹药 buff 等实体产出方由后续票在引擎内部从状态派生，不走此参数。
   */
  readonly contributions?: readonly Contribution[];
}

export interface Game {
  /** 推进 dt 毫秒的游戏内时间，产出相应事件流。 */
  tick(dt: number): void;
  /** 派发玩家动作；被拒时产出 reject 事件（不抛错）。 */
  dispatch(action: GameAction): void;
  /**
   * 离线/欠账补偿结算（ADR-013 观察时补偿）：把 elapsedMs 的挂机欠账
   * O(1) 一次性补齐（正在进行的采集活动），产出单条 offline-settled 汇总。
   * 应用层在重开加载、后台强节流追平等"观察时"调用。
   */
  settleOffline(elapsedMs: number): void;
  /** 事件流：drain() 拉取积压事件，subscribe() 订阅推送。 */
  readonly events: EventBus;
  /** 导出存档快照（含 savedAt 墙钟，离线补偿结算基准）。 */
  snapshot(): SaveData;
}

/**
 * 游戏实例工厂：引擎的唯一入口。
 *
 * issue #3 交付：状态树（skills/items/gp）+ 挂机采集循环（活动推进/
 * 材料入袋/修为/升级）+ 脱战回血 + 拒绝事件 + 离线 O(1) 补偿结算。
 * 本切片无战斗，气血恒为脱战状态（#4 接管战斗语义）。
 */
export function createGame(options: CreateGameOptions): Game {
  const clock = options.clock ?? realClock();
  const content = options.content;
  const events = new EventBus();

  // 玩法参数一次解析（#020 批 3，ADR-016 裁决 ① 分策）：
  // config 缺省字段逐项回落引擎基线，改参数 = 纯 JSON 改动。
  const cparams = combatParamsOf(content);
  const pparams = progressionParamsOf(content);
  const aparams = affixParamsOf(content);

  const contributions: readonly Contribution[] = options.contributions ?? [];
  const state: GameState = options.save
    ? restoreState(content, options.save, options.seed ?? 1, contributions)
    : initialState(content, options.seed ?? 1, contributions);
  let time = options.save?.time ?? 0;

  const injectedRng = options.rng;
  let rng = createRng(state.rngSeed);
  const random = (): number => {
    if (injectedRng) return injectedRng();
    const value = rng.next();
    state.rngSeed = rng.state(); // 随机状态随档持久化（ADR-013）
    return value;
  };
  const hpCap = (): number => playerStats(hpContext()).maxHp;
  const xpOf = (skillId: string): number => state.skills[skillId]?.xp ?? 0;
  const levelOf = (skillId: string): number => levelFromXp(xpOf(skillId), pparams);
  if (options.save) {
    // 恢复后按当前佩戴/增益重 clamp 气血（state.ts 只兜无装备基线上限）。
    state.hp = Math.min(state.hp, Math.max(1, playerStats({ moveId: weaponMoveKey() }).maxHp));
  }

  const combatSkill = (): SkillView | undefined => skillsOf(content).find((skill) => skill.kind === 'combat');
  const combatText = combatTextOf(content);
  const texts = textsOf(content);

  /** 无武器兵刃展示名（texts.fistName，#019）：形状非法时键名回显（裁决 ④）。 */
  const fistName: string =
    typeof texts.fistName === 'string' && texts.fistName.length > 0 ? texts.fistName : 'fistName';

  /**
   * reject 展示文案（texts.reject 映射，#019）：命中序 = 精确动作 →
   * `'*'` 跨动作兜底 → 键名回显 `{action}/{reason}`（裁决 ④ 防御可见）。
   */
  function rejectText(
    action: string,
    reason: string,
    vars?: Readonly<Record<string, string>>,
  ): string {
    const rejectMap = texts.reject as Record<string, unknown> | undefined;
    const resolve = (entry: unknown): string | undefined => {
      const reasonMap = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined;
      const template = reasonMap?.[reason];
      if (typeof template !== 'string' || template.length === 0) return undefined;
      return fillTemplate(template, vars ?? {});
    };
    return resolve(rejectMap?.[action]) ?? resolve(rejectMap?.['*']) ?? `${action}/${reason}`;
  }

  /** 系统 note 叙事（combatText.notes 池，#019）：池缺失/抽空回显池键名（裁决 ④）。 */
  function noteFrom(key: string, vars?: Readonly<Record<string, string>>): string {
    const notes = combatText.notes as Record<string, unknown> | undefined;
    const pool = notes && typeof notes === 'object' ? notes[key] : undefined;
    const template = pickText(pool, random);
    return template === undefined ? key : fillTemplate(template, vars ?? {});
  }

  /** 气血上限语境：佩戴武器视为持续生效的 moveId 语境；脱战无来袭系别。 */
  const hpContext = (): AggregationContext => ({ moveId: weaponMoveKey() });

  /* ---------- 玩家属性：装备 + 丹药 buff + 静态注入 → 单一聚合管线（ADR-011） ---------- */

  /** 佩戴中的装备实例（槽位与装备定义一致才有效）。 */
  function wornGear(): Array<{ readonly gear: GearInstance; readonly item: ItemView; readonly slot: string }> {
    const out: Array<{ gear: GearInstance; item: ItemView; slot: string }> = [];
    for (const [slot, uid] of Object.entries(state.equips)) {
      const gear = state.gear.find((entry) => entry.uid === uid);
      if (!gear) continue;
      const item = findItem(content, gear.itemId);
      if (!item || item.slot !== slot) continue;
      out.push({ gear, item, slot });
    }
    return out;
  }

  /** 佩戴中的武器；无则拳脚（招式注册键与动词池随之兜底）。 */
  function wornWeapon(): { readonly gear: GearInstance; readonly item: ItemView } | undefined {
    const uid = state.equips['weapon'];
    if (uid === undefined) return undefined;
    return wornGear().find((entry) => entry.gear.uid === uid);
  }

  /** 玩家招式注册键：佩戴武器 itemId，否则 'fist'（未注册由文案层再兜底）。 */
  function weaponMoveKey(): string {
    return wornWeapon()?.item.id ?? 'fist';
  }

  /**
   * 全部属性贡献：静态注入（createGame.contributions）+ 装备实例投影
   * （flat）+ 生效中的丹药 buff（倍率区 mult / 暴击百分点 flat）。
   * 顺带清理过期 buff（读时清理，旧版同策略）。
   */
  function playerContributions(): Contribution[] {
    const out: Contribution[] = [...contributions];
    for (const { gear, item } of wornGear()) {
      out.push(...gearContributions(content, gear, item.bonuses ?? {}, item.name));
    }
    for (const [pillId, until] of Object.entries(state.buffs)) {
      if (until <= time) {
        delete state.buffs[pillId]; // 过期 buff 读时清理，不落盘
        continue;
      }
      const item = findItem(content, pillId);
      const effect = item?.effect;
      if (!item || !effect) continue;
      const source = { id: pillId, kind: 'pill', name: item.name };
      for (const [stat, mult] of Object.entries(effect.multipliers ?? {})) {
        if (typeof mult === 'number' && mult > 0) {
          out.push({ modifier: { stat, zone: 'mult', value: mult }, source });
        }
      }
      if (typeof effect.crit === 'number' && effect.crit !== 0) {
        out.push({ modifier: { stat: 'crit', zone: 'flat', value: effect.crit }, source });
      }
    }
    return out;
  }

  /** 玩家属性基线：攻/防/暴读 config.combat，气血曲线读 config.progression（#020）。 */
  function statBase(): Record<string, number> {
    const clv = combatLevelOf(content, state.skills);
    return {
      atk: cparams.statAtkBase + clv * cparams.statAtkPerLevel,
      def: cparams.statDefBase + clv * cparams.statDefPerLevel,
      hp: maxHpForLevel(clv, pparams),
      crit: cparams.statCritBase,
    };
  }

  /**
   * 聚合玩家属性（crit 钳上限）。context 缺省为无语境面板读数；
   * 战斗内攻击侧带 {moveId}、防御侧带 {element}（条件修饰符门控）。
   */
  function playerStats(context: AggregationContext = {}): PlayerStatsView {
    const breakdown = aggregateStats(statBase(), playerContributions(), context);
    return {
      atk: Math.round(breakdown.atk?.value ?? 0),
      def: Math.round(breakdown.def?.value ?? 0),
      crit: Math.min(cparams.critCap, Math.round(breakdown.crit?.value ?? 0)),
      maxHp: Math.round(breakdown.hp?.value ?? 0),
    };
  }

  /** 战斗双方语境合成：攻侧 moveId、防侧来袭 element（一次取齐）。 */
  function combatStats(enemy: EnemyView): {
    atk: number;
    crit: number;
    def: number;
    maxHp: number;
  } {
    const moveKey = weaponMoveKey();
    const atkSide = aggregateStats(statBase(), playerContributions(), { moveId: moveKey });
    const defSide = aggregateStats(statBase(), playerContributions(), {
      element: enemy.element,
    });
    return {
      atk: Math.round(atkSide.atk?.value ?? 0),
      crit: Math.min(cparams.critCap, Math.round(atkSide.crit?.value ?? 0)),
      def: Math.round(defSide.def?.value ?? 0),
      maxHp: Math.round(defSide.hp?.value ?? 0),
    };
  }

  function addItem(itemId: string, count: number): void {
    if (!(count > 0)) return;
    const next = (state.items[itemId] ?? 0) + count;
    if (next > 0) state.items[itemId] = next;
    else delete state.items[itemId]; // 不落盘 0 值键
  }

  function takeItem(itemId: string, count: number): boolean {
    const owned = state.items[itemId] ?? 0;
    if (count > owned) return false;
    if (count === owned) delete state.items[itemId];
    else state.items[itemId] = owned - count;
    return true;
  }

  function grantExp(skill: SkillView, amount: number, quiet: boolean): void {
    if (!(amount > 0)) return;
    const before = levelFromXp(xpOf(skill.id), pparams);
    const entry = state.skills[skill.id] ?? { xp: 0 };
    entry.xp += amount;
    state.skills[skill.id] = entry;
    if (!quiet) {
      events.emit({
        type: 'exp',
        time,
        data: { skillId: skill.id, skillName: skill.name, amount },
      });
    }
    const after = levelFromXp(entry.xp, pparams);
    if (after > before && before < pparams.maxLevel) {
      if (!quiet) {
        events.emit({
          type: 'levelup',
          time,
          data: { skillId: skill.id, skillName: skill.name, level: Math.min(after, pparams.maxLevel) },
        });
      }
    }
  }

  /** 拒绝事件：展示文案由 texts 节按 action+reason 解析（#019），协议 code 保留。 */
  function reject(actionType: string, reason: string, vars?: Readonly<Record<string, string>>): void {
    events.emit({
      type: 'reject',
      time,
      data: { action: actionType, reason, message: rejectText(actionType, reason, vars) },
    });
  }

  function emitLoot(item: string, count: number, source: string): void {
    const def = findItem(content, item);
    events.emit({
      type: 'loot',
      time,
      data: { item, itemName: def?.name ?? item, count, source },
    });
  }

  /** bag:sell / shop:buy 共用的载荷解析；非法返回 null。 */
  function readItemPayload(payload: unknown): { itemId: string; count: number } | null {
    const p = payload as { item?: unknown; count?: unknown } | undefined;
    const itemId = p?.item;
    const count = p?.count === undefined ? 1 : p.count;
    if (
      typeof itemId !== 'string' ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      return null;
    }
    return { itemId, count };
  }

  /** gear:equip / gear:sell 共用的 uid 载荷解析（uid 必须 +arg 转数字，旧版教训）。 */
  function readUidPayload(payload: unknown): number | undefined {
    const p = payload as { uid?: unknown } | undefined;
    const uid = p?.uid;
    if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) return undefined;
    return uid;
  }

  /** 单轮采集完成：产出 → 副产出（掷点）→ 修为（采集类 buff 经管线加成）。 */
  function completeActivityOnce(skill: SkillView, activity: ActivityView): void {
    addItem(activity.output.item, activity.output.count);
    emitLoot(activity.output.item, activity.output.count, 'activity');
    if (activity.byproduct && random() < activity.byproduct.chance) {
      addItem(activity.byproduct.item, 1);
      emitLoot(activity.byproduct.item, 1, 'byproduct');
    }
    const xpMult = aggregateStats({ gatherXp: 1 }, playerContributions(), {}).gatherXp?.value ?? 1;
    grantExp(skill, Math.round(activity.exp * xpMult), false);
    events.emit({
      type: 'activity-complete',
      time,
      data: { skillId: skill.id, skillName: skill.name, activityName: activity.name },
    });
  }

  /** 大步长 tick 可一次补多轮（假时钟全速模拟依赖此语义）。 */
  function settleActivity(dt: number): void {
    const active = state.activity;
    if (!active) return;
    const found = findActivity(content, active.skillId, active.index);
    if (!found) {
      state.activity = null; // 内容包已变更：安全弃置
      return;
    }
    active.progress += dt;
    let guard = 0;
    while (active.progress >= found.activity.interval && guard++ < 1_000_000) {
      active.progress -= found.activity.interval;
      completeActivityOnce(found.skill, found.activity);
    }
  }

  /* ---------- 丹药（#4）：即时恢复 / 持续 buff ---------- */

  /** 嗑丹。silent = 自动嗑丹（战斗日志由 attack/note 承载，不弹 reject）。 */
  function eatPill(pillId: string, silent: boolean): void {
    const item = findItem(content, pillId);
    if (!item || item.type !== 'pill') {
      if (!silent) reject('pill:eat', 'not-pill');
      return;
    }
    if ((state.items[pillId] ?? 0) <= 0) {
      if (!silent) reject('pill:eat', 'no-item');
      return;
    }
    if (item.heal) {
      const cap = playerStats(hpContext()).maxHp;
      if (state.hp >= cap) {
        if (!silent) reject('pill:eat', 'full-hp');
        return;
      }
      takeItem(pillId, 1);
      const healed = Math.min(cap, state.hp + Math.round(cap * item.heal.percent)) - state.hp;
      state.hp += healed;
      events.emit({
        type: 'pill:eat',
        time,
        data: { item: pillId, itemName: item.name, kind: 'heal', healed },
      });
      if (silent) {
        events.emit({
          type: 'combat-note',
          time,
          data: { text: noteFrom('autoPill', { item: item.name }), kind: 'pill' },
        });
      }
    } else if (item.effect) {
      takeItem(pillId, 1);
      state.buffs[pillId] = time + item.effect.duration; // 同名丹药覆盖续时（旧版语义）
      events.emit({
        type: 'pill:eat',
        time,
        data: { item: pillId, itemName: item.name, kind: 'buff', minutes: Math.round(item.effect.duration / 60000) },
      });
    }
  }

  /* ---------- 战斗（#4）：回合解算 / 文案 / 胜负结算 ---------- */

  function emitNote(text: string, enemyId?: string): void {
    events.emit({ type: 'combat-note', time, data: enemyId ? { text, enemyId } : { text } });
  }

  function stopCombat(note?: string): void {
    const c = state.combat;
    if (!c) return;
    state.combat = null;
    emitNote(note ?? noteFrom('retreat'), c.enemyId);
  }

  /** 玩家一击：暴击 roll → 伤害 → 伤害档累计 → 文案 → 胜负判定。 */
  function playerAttackRound(enemy: EnemyView, c: CombatState): void {
    const moveKey = weaponMoveKey();
    const weapon = wornWeapon();
    const { atk, crit: critChance } = combatStats(enemy);
    const dmgBase = calcDmg(atk, enemy.def, random, cparams);
    const crit = rollCrit(critChance, random);
    const dmg = crit ? Math.round(dmgBase * cparams.critMultiplier) : dmgBase;
    c.ehp -= dmg;
    c.rounds += 1;
    if (crit) c.crits += 1;
    const tier = hitTierOf(dmg, atk, enemy.def, cparams);
    c.tiers[tier] += 1;
    const text = makeAttackText(
      combatText,
      {
        side: 'player',
        enemyName: enemy.name,
        moveKey,
        verbStyle: weapon ? 'sword' : 'fist',
        weaponName: weapon ? weapon.item.name : fistName,
        dmg,
        crit,
        atk,
        defenderDef: enemy.def,
        defenderHp: Math.max(0, c.ehp),
        defenderMaxHp: enemy.hp,
      },
      random,
      cparams,
    );
    events.emit({
      type: 'attack',
      time,
      data: { side: 'player', enemyId: enemy.id, enemyName: enemy.name, text, dmg, crit, tier },
    });
    if (c.ehp <= 0) victory(enemy, c);
  }

  /** 敌人一击：减伤解算 → 文案 → 玩家倒下判定。 */
  function enemyAttackRound(enemy: EnemyView, c: CombatState): void {
    const { def, maxHp } = combatStats(enemy);
    const dmg = calcDmg(enemy.atk, def, random, cparams);
    state.hp -= dmg;
    const tier = hitTierOf(dmg, enemy.atk, def, cparams);
    const text = makeAttackText(
      combatText,
      {
        side: 'enemy',
        enemyName: enemy.name,
        moveKey: enemy.id,
        verbStyle: enemy.kind ?? 'claw',
        weaponName: '',
        dmg,
        crit: false,
        atk: enemy.atk,
        defenderDef: def,
        defenderHp: Math.max(0, state.hp),
        defenderMaxHp: maxHp,
      },
      random,
      cparams,
    );
    events.emit({
      type: 'attack',
      time,
      data: { side: 'enemy', enemyId: enemy.id, enemyName: enemy.name, text, dmg, tier },
    });
    if (state.hp <= 0) defeat(enemy, c);
  }

  /** 胜利结算：灵石/材料/异宝掉落 + 斗法修为 + 签名画像与同对手对照。 */
  function victory(enemy: EnemyView, c: CombatState): void {
    const gold = enemy.gold;
    const gpGain = gold
      ? Math.floor(gold.min + random() * (gold.max - gold.min + 1))
      : 0;
    state.gp += gpGain;

    const drops: string[] = [];
    for (const drop of enemy.drops ?? []) {
      if (drop.item && random() < drop.chance) {
        addItem(drop.item, 1);
        emitLoot(drop.item, 1, 'drop');
        drops.push(drop.item);
      }
    }

    let gearDropName: string | undefined;
    const gearDrop = findGearDrop(content, enemy.id);
    if (gearDrop && random() < gearDrop.chance) {
      const itemId = pickText(gearDrop.pool, random);
      const item = itemId ? findItem(content, itemId) : undefined;
      if (item) {
        state.gearSeq += 1;
        // 词条标尺/波动走 config.affix（#020）；rarity 显式 roll 与缺省参数位求值同序。
        const gear = makeGear(content, item.id, item.bonuses ?? {}, state.gearSeq, random, rollRarity(content, random), aparams);
        state.gear.push(gear);
        gearDropName = gearName(content, item.name, gear.rarity);
        events.emit({
          type: 'loot',
          time,
          data: {
            item: item.id,
            itemName: gearDropName,
            count: 1,
            source: 'gear',
            rarity: gear.rarity,
            uid: gear.uid,
          },
        });
      }
    }

    const skill = combatSkill();
    if (skill) grantExp(skill, enemy.exp, false);

    const tally = { rounds: c.rounds, crits: c.crits, tiers: c.tiers };
    const summary = summarizeRounds(tally, combatText, random);
    const prev = state.lastEncounter[enemy.id];
    const compare = compareEncounterText(prev, c.rounds, combatText, random);
    state.lastEncounter[enemy.id] = { rounds: c.rounds, won: true, at: time };
    c.respT = cparams.victoryRestMs; // 战斗态保留（ehp ≤ 0），休整后按 autoFight 决定去留

    events.emit({
      type: 'victory',
      time,
      data: {
        enemyId: enemy.id,
        enemyName: enemy.name,
        gp: gpGain,
        rounds: c.rounds,
        exp: skill ? enemy.exp : 0,
        summary,
        drops,
        ...(gearDropName !== undefined ? { gearDropName } : {}),
        ...(prev !== undefined ? { prevEncounter: prev } : {}),
        ...(compare !== undefined ? { compare } : {}),
      },
    });
  }

  /** 落败：残血被救回，对照记录 won=false（「前番不敌」的基准）。 */
  function defeat(enemy: EnemyView, c: CombatState): void {
    const maxHp = combatStats(enemy).maxHp;
    state.hp = Math.max(1, Math.round(maxHp * cparams.lowHpFraction));
    state.combat = null;
    state.lastEncounter[enemy.id] = { rounds: c.rounds, won: false, at: time };
    events.emit({
      type: 'defeat',
      time,
      data: { enemyId: enemy.id, enemyName: enemy.name },
    });
  }

  /**
   * 战斗大步长结算：按「下一次出招」逐事件推进，dt 消化完或战斗结束为止
   * （与 settleActivity 同语义：假时钟全速模拟一次 tick 可补多轮）。
   * 休整期（respT）内不回血不接战，到期按 autoFight 决定再战或离场。
   */
  function settleCombat(dt: number): void {
    let remaining = dt;
    let guard = 0;
    while (remaining > 0 && state.combat && guard++ < 1_000_000) {
      const c = state.combat;
      const enemy = findEnemy(content, c.enemyId);
      if (!enemy) {
        state.combat = null; // 内容包已变更：安全弃置
        return;
      }
      if (c.respT > 0) {
        const step = Math.min(remaining, c.respT);
        c.respT -= step;
        remaining -= step;
        if (c.respT <= 0) {
          if (state.autoFight) {
            // 自动再战前复查气血：残血且无自动补给时退避（挂机不送死）。
            if (state.hp < playerStats(hpContext()).maxHp * cparams.lowHpFraction) {
              stopCombat(noteFrom('retreatWounded'));
              return;
            }
            c.ehp = enemy.hp;
            c.pt = 0;
            c.et = 0;
            c.rounds = 0;
            c.crits = 0;
            c.tiers = { light: 0, mid: 0, heavy: 0, deadly: 0 };
            emitNote(noteFrom('reengage', { enemy: enemy.name }), enemy.id);
          } else {
            stopCombat(noteFrom('retreatVictory'));
            return;
          }
        }
        continue;
      }
      // 自动嗑丹（血线触发；目标为背包中首个 heal 类丹药，引擎零内容感知）
      if (state.autoEat && state.hp < playerStats(hpContext()).maxHp * cparams.autoEatHpFraction) {
        const healPill = Object.keys(state.items).find((itemId) => {
          if (!((state.items[itemId] ?? 0) > 0)) return false;
          const item = findItem(content, itemId);
          return item?.type === 'pill' && item.heal !== undefined;
        });
        if (healPill) eatPill(healPill, true);
      }
      if (!state.combat) return;
      // 推进到下一个事件点（玩家出招 / 敌人出招 / dt 消化完）
      // 敌人缺省攻击间隔 = 玩家间隔（config.combat.playerAttackInterval，#020）。
      const pWait = cparams.playerAttackInterval - c.pt;
      const eWait = Math.max(1, enemy.attackInterval ?? cparams.playerAttackInterval) - c.et;
      const step = Math.min(remaining, pWait, eWait);
      c.pt += step;
      c.et += step;
      remaining -= step;
      if (c.pt >= cparams.playerAttackInterval) {
        c.pt -= cparams.playerAttackInterval;
        playerAttackRound(enemy, c);
        if (!state.combat) return;
      }
      if (c.et >= (enemy.attackInterval ?? cparams.playerAttackInterval)) {
        c.et -= enemy.attackInterval ?? cparams.playerAttackInterval;
        enemyAttackRound(enemy, c);
        if (!state.combat) return;
      }
    }
  }

  /**
   * 离线补偿结算（ADR-013 观察时补偿）：O(1) 算清欠账——
   * 完整轮次产出直接累加；副产出用 floor(期望) + 余数伯努利一次掷定，
   * 不逐轮回放。气血按脱战回满。只产出一条 offline-settled 汇总事件。
   */
  function settleOffline(elapsedMs: number): void {
    if (elapsedMs <= 0) return;
    if (state.combat) state.combat = null; // 离线不可战斗：视作离场休整，回满血由下方统一处理
    const active = state.activity;
    if (!active) return;
    const found = findActivity(content, active.skillId, active.index);
    if (!found) {
      state.activity = null;
      return;
    }
    const { skill, activity } = found;

    const total = active.progress + elapsedMs;
    const cycles = Math.floor(total / activity.interval);
    active.progress = total % activity.interval;

    state.hp = hpCap(); // 离线全程脱战

    if (cycles <= 0) return;
    const items: Record<string, number> = {};
    addItem(activity.output.item, activity.output.count * cycles);
    items[activity.output.item] = activity.output.count * cycles;

    if (activity.byproduct) {
      const expected = cycles * activity.byproduct.chance;
      const whole = Math.floor(expected);
      let bonus = whole;
      if (whole < cycles && random() < expected - whole) bonus += 1; // 余数无偏掷定
      if (bonus > 0) {
        addItem(activity.byproduct.item, bonus);
        items[activity.byproduct.item] = bonus;
      }
    }

    const before = levelFromXp(xpOf(skill.id));
    grantExp(skill, activity.exp * cycles, true);
    const after = levelFromXp(xpOf(skill.id));
    const levels =
      after > before
        ? [{ skillId: skill.id, skillName: skill.name, level: Math.min(after, pparams.maxLevel) }]
        : [];

    events.emit({
      type: 'offline-settled',
      time,
      data: {
        seconds: Math.round(elapsedMs / 1000),
        skillId: skill.id,
        skillName: skill.name,
        activityName: activity.name,
        cycles,
        exp: cycles * activity.exp,
        items,
        levels,
      },
    });
  }

  return {
    events,

    settleOffline,

    tick(dt: number): void {
      if (!Number.isFinite(dt) || dt <= 0) {
        return;
      }
      time += dt;
      if (state.combat) {
        // 战斗中：不回血不采药，由战斗循环推进（#4 接管战斗语义）。
        settleCombat(dt);
      } else {
        // 脱战回血。
        const cap = hpCap();
        if (state.hp < cap) {
          state.hp = Math.min(cap, state.hp + cap * pparams.hpRegenPerSec * (dt / 1000));
        }
        settleActivity(dt);
      }
      events.emit({ type: 'tick', time, data: { dt } });
    },

    dispatch(action: GameAction): void {
      switch (action.type) {
        case 'activity:start': {
          // 战斗与采集互斥：开修行即收势离战。
          if (state.combat) stopCombat(noteFrom('retreatToGather'));
          const payload = action.payload as { skillId?: unknown; index?: unknown } | undefined;
          if (
            !payload ||
            typeof payload.skillId !== 'string' ||
            typeof payload.index !== 'number' ||
            !Number.isInteger(payload.index) ||
            payload.index < 0
          ) {
            reject(action.type, 'bad-payload');
            return;
          }
          const found = findActivity(content, payload.skillId, payload.index);
          if (!found) {
            reject(action.type, 'not-found');
            return;
          }
          if (levelOf(found.skill.id) < found.activity.unlockLevel) {
            reject(action.type, 'level', {
              level: String(found.activity.unlockLevel),
              activity: found.activity.name,
            });
            return;
          }
          // 同一活动进行中：幂等派发（不清进度、不发事件）。
          if (
            state.activity &&
            state.activity.skillId === found.skill.id &&
            state.activity.index === payload.index
          ) {
            return;
          }
          // 活动名随档保存：恢复时校验下标指向的活动与名字一致，
          // 防内容重排后静默换目标（ADR-015 稳定引用；活动 id 待 #16 引入）。
          state.activity = {
            skillId: found.skill.id,
            index: payload.index,
            name: found.activity.name,
            progress: 0,
          };
          events.emit({
            type: 'activity-start',
            time,
            data: {
              skillId: found.skill.id,
              skillName: found.skill.name,
              index: payload.index,
              activityName: found.activity.name,
            },
          });
          return;
        }

        case 'activity:stop': {
          const active = state.activity;
          if (!active) return; // 幂等
          const name = findActivity(content, active.skillId, active.index)?.activity.name;
          state.activity = null;
          events.emit({
            type: 'activity-stop',
            time,
            data: { skillId: active.skillId, activityName: name },
          });
          return;
        }

        case 'bag:sell': {
          const parsed = readItemPayload(action.payload);
          if (!parsed) {
            reject(action.type, 'bad-payload');
            return;
          }
          const { itemId, count } = parsed;
          const item = findItem(content, itemId);
          if (!item) {
            reject(action.type, 'not-found');
            return;
          }
          const owned = state.items[itemId] ?? 0;
          if (count > owned) {
            reject(action.type, 'no-item', { item: item.name, owned: String(owned) });
            return;
          }
          takeItem(itemId, count);
          const gained = item.sell * count;
          state.gp += gained;
          events.emit({
            type: 'sell',
            time,
            data: { item: itemId, itemName: item.name, count, gained, gp: state.gp },
          });
          return;
        }

        case 'shop:buy': {
          const parsed = readItemPayload(action.payload);
          if (!parsed) {
            reject(action.type, 'bad-payload');
            return;
          }
          const { itemId, count } = parsed;
          const entry = findShopEntry(content, itemId);
          if (!entry) {
            reject(action.type, 'not-in-shop');
            return;
          }
          const item = findItem(content, itemId);
          const cost = entry.price * count;
          if (state.gp < cost) {
            reject(action.type, 'no-gold', { cost: String(cost), gp: String(state.gp) });
            return;
          }
          state.gp -= cost;
          addItem(itemId, count);
          events.emit({
            type: 'buy',
            time,
            data: { item: itemId, itemName: item?.name ?? itemId, count, cost, gp: state.gp },
          });
          return;
        }

        case 'combat:start': {
          const payload = action.payload as { enemyId?: unknown } | undefined;
          const enemyId = payload?.enemyId;
          if (typeof enemyId !== 'string') {
            reject(action.type, 'bad-payload');
            return;
          }
          const enemy = findEnemy(content, enemyId);
          if (!enemy) {
            reject(action.type, 'not-found');
            return;
          }
          // 开战门控（N1 判定侧单一来源，#020）：判定与 UI 锁定态共用 enemyGateOf
          // 同一实现（偏移量读 config.combat.levelGateOffset），reject 文案
          // {level} = enemy.level − 偏移（引擎内不再有第二份 clv+offset 公式）。
          const gate = enemyGateOf(content, state.skills, enemyId);
          if (gate.locked) {
            reject(action.type, 'level', { level: String(gate.requiredLevel) });
            return;
          }
          if (state.combat?.enemyId === enemyId) return; // 幂等
          if (state.hp < playerStats(hpContext()).maxHp * cparams.lowHpFraction) {
            reject(action.type, 'low-hp');
            return;
          }
          if (state.activity) {
            const act = state.activity;
            state.activity = null; // 战斗与采集互斥
            events.emit({
              type: 'activity-stop',
              time,
              data: { skillId: act.skillId, activityName: act.name },
            });
          }
          state.combat = {
            enemyId,
            ehp: enemy.hp,
            pt: 0,
            et: 0,
            respT: 0,
            rounds: 0,
            crits: 0,
            tiers: { light: 0, mid: 0, heavy: 0, deadly: 0 },
          };
          emitNote(noteFrom('start', { enemy: enemy.name }), enemy.id);
          return;
        }

        case 'combat:stop': {
          stopCombat();
          return;
        }

        case 'combat:auto': {
          state.autoFight = !state.autoFight;
          return;
        }

        case 'combat:auto-eat': {
          state.autoEat = !state.autoEat;
          return;
        }

        case 'pill:eat': {
          const payload = action.payload as { item?: unknown } | undefined;
          if (typeof payload?.item !== 'string') {
            reject(action.type, 'bad-payload');
            return;
          }
          eatPill(payload.item, false);
          return;
        }

        case 'gear:equip': {
          const uid = readUidPayload(action.payload);
          if (uid === undefined) {
            reject(action.type, 'bad-payload');
            return;
          }
          const gear = state.gear.find((entry) => entry.uid === uid);
          if (!gear) {
            reject(action.type, 'not-found');
            return;
          }
          const item = findItem(content, gear.itemId);
          const slot = item?.slot;
          if (!item || !slot) {
            // uid 有效但物品不可佩戴：协议 code 细化为 not-wearable（#019），
            // 文案单独挂 texts.reject['gear:equip']/not-wearable，不与 '*' 兜底混用。
            reject(action.type, 'not-wearable');
            return;
          }
          if (state.equips[slot] === uid) return; // 已佩戴幂等
          state.equips[slot] = uid; // 同槽替换
          state.hp = Math.min(state.hp, hpCap());
          events.emit({
            type: 'equip:wear',
            time,
            data: { uid, slot, name: gearName(content, item.name, gear.rarity) },
          });
          return;
        }

        case 'gear:unequip': {
          const payload = action.payload as { slot?: unknown } | undefined;
          const slot = payload?.slot;
          if (typeof slot !== 'string') {
            reject(action.type, 'bad-payload');
            return;
          }
          const uid = state.equips[slot];
          if (uid === undefined) return; // 空槽幂等
          const gear = state.gear.find((entry) => entry.uid === uid);
          delete state.equips[slot];
          state.hp = Math.min(state.hp, hpCap());
          events.emit({
            type: 'equip:remove',
            time,
            data: {
              slot,
              uid,
              ...(gear ? { name: gearName(content, findItem(content, gear.itemId)?.name ?? gear.itemId, gear.rarity) } : {}),
            },
          });
          return;
        }

        case 'gear:sell': {
          const uid = readUidPayload(action.payload);
          if (uid === undefined) {
            reject(action.type, 'bad-payload');
            return;
          }
          const gear = state.gear.find((entry) => entry.uid === uid);
          if (!gear) {
            reject(action.type, 'not-found');
            return;
          }
          if (Object.values(state.equips).includes(uid)) {
            reject(action.type, 'worn');
            return;
          }
          const item = findItem(content, gear.itemId);
          const gained = gearSell(content, item?.sell ?? 0, gear.rarity);
          state.gear = state.gear.filter((entry) => entry.uid !== uid);
          state.gp += gained;
          events.emit({
            type: 'sell',
            time,
            data: {
              item: gear.itemId,
              itemName: gearName(content, item?.name ?? gear.itemId, gear.rarity),
              count: 1,
              gained,
              gp: state.gp,
            },
          });
          return;
        }

        default:
          reject(action.type, 'unknown-action');
      }
    },

    snapshot(): SaveData {
      // GameState 无索引签名，与 GameContent 同理放宽为透明 Record（#2 先例）。
      return {
        version: 1,
        time,
        savedAt: clock.now(),
        state: cloneState(state) as unknown as Readonly<Record<string, unknown>>,
        // 属性面板（#4 验收：佩戴稀有度武器 → snapshot 反映倍率+词条）。
        stats: playerStats(),
      };
    },
  };
}
