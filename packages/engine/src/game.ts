import { EventBus } from './events.js';
import { realClock } from './clock.js';
import { createRng } from './rng.js';
import { levelFromXp, maxHpForLevel } from './progression.js';
import {
  affixParamsOf,
  combatLevelOf,
  combatParamsOf,
  combatTextOf,
  craftMissingOf,
  craftParamsOf,
  craftSuccessRateOf,
  enemyGateOf,
  findActivity,
  findEnemy,
  findGearDrop,
  findItem,
  findRecipe,
  findShopEntry,
  findSkill,
  playerMaxHp,
  progressionParamsOf,
  skillsOf,
  textsOf,
  type ActivityView,
  type EnemyView,
  type ItemView,
  type RecipeView,
  type SkillView,
} from './contentView.js';
import {
  calcDmg,
  compareEncounterText,
  fillTemplate,
  BASIC_KEY,
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
  type ActivityState,
  type CombatState,
  type GameState,
} from './state.js';
import type { Clock, GameAction, GameContent, PlayerStatsView, SaveData } from './types.js';
import {
  applyRebirthReset,
  effectiveIntervalOf,
  gatherSpeedOf,
  offlineCapOf,
  rebirthGateOf,
  rebirthOf,
  rebirthPreviewOf,
  talentContributionsOf,
  talentGateOf,
  talentNodeOf,
  xpMultOf,
} from './rebirth.js';
import {
  aggregateStats,
  type AggregationContext,
  type Contribution,
} from './modifiers.js';
import {
  dungeonFloorEnemyOf,
  dungeonGateOf,
  dungeonLayerOf,
  findDungeon,
  pickDungeonEnemyOf,
  type DungeonView,
} from './dungeon.js';

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
 * issue #3 交付：状态树（skills/items/gold）+ 挂机采集循环（活动推进/
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
  const crparams = craftParamsOf(content);

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

  /** 无武器兵刃展示名（texts.basicName，#019；#24 fist→basic 中性化）：形状非法时键名回显（裁决 ④）。 */
  const basicName: string =
    typeof texts.basicName === 'string' && texts.basicName.length > 0 ? texts.basicName : 'basicName';

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

  /** 玩家招式注册键：佩戴武器 itemId，否则兜底键（未注册由文案层再兜底）。 */
  function weaponMoveKey(): string {
    return wornWeapon()?.item.id ?? BASIC_KEY;
  }

  /**
   * 玩家动词池键（#021 批 4 解绑内嵌映射；#24 fist→basic）：佩戴武器读
   * 内容声明的 verbStyle（开放键域，如法杖走 magic 池 = 纯 JSON 改动）；
   * 无武器 / 缺声明 / 声明非法回落引擎兜底键（未注册由文案层再兜底）。
   */
  function playerVerbStyle(): string {
    const declared = wornWeapon()?.item.verbStyle;
    return typeof declared === 'string' && declared.length > 0 ? declared : BASIC_KEY;
  }

  /**
   * 全部属性贡献：静态注入（createGame.contributions）+ 装备实例投影
   * （flat）+ 生效中的丹药 buff（倍率区 mult / 暴击百分点 flat）+
   * 已点亮天赋（rebirth.talents → 标准修饰符，#6；管线投影单一来源
   * talentContributionsOf，与测试/第二题材共用）。顺带清理过期 buff
   * （读时清理，旧版同策略）。
   */
  function playerContributions(): Contribution[] {
    const out: Contribution[] = [
      ...contributions,
      ...talentContributionsOf(content, state.talents),
    ];
    for (const { gear, item } of wornGear()) {
      out.push(...gearContributions(content, gear, item.bonuses ?? {}, item.name));
    }
    for (const [consumableId, until] of Object.entries(state.buffs)) {
      if (until <= time) {
        delete state.buffs[consumableId]; // 过期 buff 读时清理，不落盘
        continue;
      }
      const item = findItem(content, consumableId);
      const effect = item?.effect;
      if (!item || !effect) continue;
      const source = { id: consumableId, kind: 'consumable', name: item.name };
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

  /** 发放修为：返回实发值（倍率后取整）——离线事件载荷与实际入账同源。 */
  function grantExp(skill: SkillView, amount: number, quiet: boolean): number {
    if (!(amount > 0)) return 0;
    // 全经验倍率（xpMult 消费点，#6）：gather/craft/combat/离线同路单点，
    // 与采集特化倍率 gatherXp（调用方先行叠乘）自然组合。
    const granted = Math.round(amount * xpMultOf(playerContributions()));
    if (!(granted > 0)) return 0;
    const before = levelFromXp(xpOf(skill.id), pparams);
    const entry = state.skills[skill.id] ?? { xp: 0 };
    entry.xp += granted;
    state.skills[skill.id] = entry;
    if (!quiet) {
      events.emit({
        type: 'exp',
        time,
        data: { skillId: skill.id, skillName: skill.name, amount: granted },
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
    return granted;
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
    const skill = findSkill(content, active.skillId);
    if (!skill) {
      state.activity = null; // 内容包已变更：安全弃置
      return;
    }
    // craft 类技能的动作是 recipes（index = 包内 recipes 下标，#5）。
    if (skill.kind === 'craft') {
      settleCraft(active, skill, dt);
      return;
    }
    const found = findActivity(content, active.skillId, active.index);
    if (!found) {
      state.activity = null; // 内容包已变更：安全弃置
      return;
    }
    active.progress += dt;
    // 采集速度（gatherSpeed 消费点，#6）：有效间隔 = 基础间隔 ÷ 速度倍率
    //（在线/离线/快照投影同调 effectiveIntervalOf，禁第二份缩放式）。
    const interval = effectiveIntervalOf(
      found.activity.interval,
      gatherSpeedOf(playerContributions()),
    );
    let guard = 0;
    while (active.progress >= interval && guard++ < 1_000_000) {
      active.progress -= interval;
      completeActivityOnce(found.skill, found.activity);
    }
  }

  /* ---------- 炼制（#5 垂直切片③）：配方循环 / 失败损料 / 缺料停炉 / 装备实例化 ---------- */

  /**
   * 单轮炼制完成（旧版 game.js 406-418 语义）：先扣料 → 成功率掷点 →
   * 成功发产出 + 配方修为；失败材料全损、只返还修为（round(exp × failRefund)）。
   * 事件面：exp（复用 grantExp）+ loot（source=craft）/ craft-fail + activity-complete。
   */
  function completeCraftOnce(skill: SkillView, recipe: RecipeView): void {
    for (const [matId, count] of Object.entries(recipe.materials)) {
      takeItem(matId, count);
    }
    if (random() < craftSuccessRateOf(content, state.skills, recipe)) {
      grantCraftOutput(skill, recipe);
      grantExp(skill, recipe.exp, false);
    } else {
      const exp = Math.round(recipe.exp * Math.max(0, crparams.failExpRefund));
      grantExp(skill, exp, false);
      events.emit({
        type: 'craft-fail',
        time,
        data: { skillId: skill.id, skillName: skill.name, recipeName: recipe.name, exp },
      });
    }
    events.emit({
      type: 'activity-complete',
      time,
      data: { skillId: skill.id, skillName: skill.name, activityName: recipe.name },
    });
  }

  /**
   * 炼制产出：equip 类 → 装备实例化（rollRarity 受炼器等级偏置 + 词条掷定，
   * #5/#14 接缝：偏置 = 技艺层 × config.crafting.rarityBiasPerLevel）；其余入袋。
   */
  function grantCraftOutput(skill: SkillView, recipe: RecipeView): void {
    const item = findItem(content, recipe.output.item);
    if (!item) return; // 包校验已保证存在；防御路径静默跳过
    if (item.type !== 'equip') {
      addItem(item.id, recipe.output.count);
      emitLoot(item.id, recipe.output.count, 'craft');
      return;
    }
    const bias = levelOf(skill.id) * crparams.rarityBiasPerLevel;
    for (let i = 0; i < recipe.output.count; i++) {
      state.gearSeq += 1;
      // 词条标尺/波动走 config.affix；rarity 显式 roll（带偏置）与缺省参数位求值同序。
      const gear = makeGear(
        content,
        item.id,
        item.bonuses ?? {},
        state.gearSeq,
        random,
        rollRarity(content, random, bias),
        aparams,
      );
      state.gear.push(gear);
      events.emit({
        type: 'loot',
        time,
        data: {
          item: item.id,
          itemName: gearName(content, item.name, gear.rarity),
          count: 1,
          source: 'craft',
          rarity: gear.rarity,
          uid: gear.uid,
        },
      });
    }
  }

  /**
   * 炼制大步长结算（旧版 game.js 401-420 语义）：轮内材料耗尽即中止；
   * 结算后材料不足 → 自动停炉（活动清空 + craft-halt 事件，旧版踩坑回归：
   * 绝不静默卡死、绝不抛未捕获异常）。
   */
  function settleCraft(active: ActivityState, skill: SkillView, dt: number): void {
    const recipe = findRecipe(content, active.index);
    if (!recipe || recipe.skill !== skill.id) {
      state.activity = null; // 内容包已变更：安全弃置
      return;
    }
    active.progress += dt;
    let guard = 0;
    while (active.progress >= recipe.interval && guard++ < 1_000_000) {
      if (craftMissingOf(recipe, state.items).length > 0) break;
      active.progress -= recipe.interval;
      completeCraftOnce(skill, recipe);
    }
    if (craftMissingOf(recipe, state.items).length > 0) {
      state.activity = null; // 缺料停炉：与手动收功同效（剩余进度一并弃置）
      events.emit({
        type: 'craft-halt',
        time,
        data: { skillId: skill.id, skillName: skill.name, recipeName: recipe.name },
      });
    }
  }

  /* ---------- 消耗品（#4）：即时恢复 / 持续 buff；#24 pill→consumable 中性化 ---------- */

  /** 服用消耗品。silent = 自动服用（战斗日志由 attack/note 承载，不弹 reject）。 */
  function eatConsumable(consumableId: string, silent: boolean): void {
    const item = findItem(content, consumableId);
    if (!item || item.type !== 'consumable') {
      if (!silent) reject('consumable:eat', 'not-consumable');
      return;
    }
    if ((state.items[consumableId] ?? 0) <= 0) {
      if (!silent) reject('consumable:eat', 'no-item');
      return;
    }
    if (item.heal) {
      const cap = playerStats(hpContext()).maxHp;
      if (state.hp >= cap) {
        if (!silent) reject('consumable:eat', 'full-hp');
        return;
      }
      takeItem(consumableId, 1);
      const healed = Math.min(cap, state.hp + Math.round(cap * item.heal.percent)) - state.hp;
      state.hp += healed;
      events.emit({
        type: 'consumable:eat',
        time,
        data: { item: consumableId, itemName: item.name, kind: 'heal', healed },
      });
      if (silent) {
        events.emit({
          type: 'combat-note',
          time,
          data: { text: noteFrom('autoConsume', { item: item.name }), kind: 'consumable' },
        });
      }
    } else if (item.effect) {
      takeItem(consumableId, 1);
      state.buffs[consumableId] = time + item.effect.duration; // 同名消耗品覆盖续时（旧版语义）
      events.emit({
        type: 'consumable:eat',
        time,
        data: { item: consumableId, itemName: item.name, kind: 'buff', minutes: Math.round(item.effect.duration / 60000) },
      });
    }
  }

  /* ---------- 战斗（#4）：回合解算 / 文案 / 胜负结算 ---------- */

  function emitNote(text: string, enemyId?: string): void {
    events.emit({ type: 'combat-note', time, data: enemyId ? { text, enemyId } : { text } });
  }

  /* ---------- 秘境（#7）：层序列战斗复用既有战斗状态机 ---------- */

  /** 秘境感知的敌人解析：层表倍率投影（dungeonFloorEnemyOf 单一来源）；脱境 = 敌人定义原值。 */
  function resolveEnemy(enemyId: string): EnemyView | undefined {
    const run = state.dungeon;
    if (!run) return findEnemy(content, enemyId);
    return dungeonFloorEnemyOf(content, run.dungeonId, run.floor, enemyId);
  }

  /** 进入指定层：加权抽敌 → 以层倍率投影的气血开战（战斗状态机与解算零分叉）。 */
  function enterDungeonFloor(dungeon: DungeonView, floor: number): boolean {
    const enemy = pickDungeonEnemyOf(content, dungeon, floor, random);
    if (!enemy) return false;
    const scaled = dungeonFloorEnemyOf(content, dungeon.id, floor, enemy.id) ?? enemy;
    state.combat = {
      enemyId: scaled.id,
      ehp: scaled.hp,
      pt: 0,
      et: 0,
      respT: 0,
      rounds: 0,
      crits: 0,
      tiers: { light: 0, mid: 0, heavy: 0, deadly: 0 },
    };
    emitNote(noteFrom('start', { enemy: scaled.name }), scaled.id);
    return true;
  }

  /** 离境结算（#7）：清攻略 + dungeon:leave 事件（最高层已随进层实时登记）。 */
  function leaveDungeon(): void {
    const run = state.dungeon;
    if (!run) return;
    state.dungeon = null;
    const dungeon = findDungeon(content, run.dungeonId);
    events.emit({
      type: 'dungeon:leave',
      time,
      data: {
        dungeonId: run.dungeonId,
        dungeonName: dungeon?.name ?? run.dungeonId,
        floor: run.floor,
        best: Math.max(state.dungeonBest[run.dungeonId] ?? 0, run.floor),
      },
    });
  }

  /**
   * 秘境层推进（胜利休整到期消费，#7）：顶层已清 → 通关离境；否则层号 +1、
   * 登记最高层、抽敌开战下一层。层奖励已在 victory 入账（dungeon:floor），
   * 此处只决定去留；层表空/敌人全缺失 = 防御离境（绝不抛错卡死）。
   */
  function advanceDungeonFloor(): void {
    const run = state.dungeon;
    if (!run) return;
    const dungeon = findDungeon(content, run.dungeonId);
    if (!dungeon) {
      state.dungeon = null; // 内容包已变更：安全弃置
      return;
    }
    if (run.floor >= dungeon.floors) {
      state.dungeon = null;
      events.emit({
        type: 'dungeon:clear',
        time,
        data: { dungeonId: dungeon.id, dungeonName: dungeon.name, floors: dungeon.floors },
      });
      stopCombat(noteFrom('retreatVictory'));
      return;
    }
    run.floor += 1;
    state.dungeonBest[run.dungeonId] = Math.max(state.dungeonBest[run.dungeonId] ?? 0, run.floor);
    if (!enterDungeonFloor(dungeon, run.floor)) {
      state.dungeon = null;
      stopCombat();
    }
  }

  function stopCombat(note?: string): void {
    const c = state.combat;
    if (!c) return;
    state.combat = null;
    emitNote(note ?? noteFrom('retreat'), c.enemyId);
    leaveDungeon(); // 秘境攻略随战团散去（#7：撤退/退避/转赴修行一律离境）
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
        verbStyle: playerVerbStyle(),
        weaponName: weapon ? weapon.item.name : basicName,
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
        // 动词池键 = 敌人内容声明的 kind（开放键域，#021 批 4）；'claw' 不再是
        // 引擎缺省词汇，防御路径回落引擎兜底键（未注册由文案层再兜底）。
        verbStyle: enemy.kind ?? BASIC_KEY,
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
    const goldRange = enemy.gold;
    const goldGain = goldRange
      ? Math.floor(goldRange.min + random() * (goldRange.max - goldRange.min + 1))
      : 0;
    state.gold += goldGain;

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
        gold: goldGain,
        rounds: c.rounds,
        exp: skill ? enemy.exp : 0,
        summary,
        drops,
        ...(gearDropName !== undefined ? { gearDropName } : {}),
        ...(prev !== undefined ? { prevEncounter: prev } : {}),
        ...(compare !== undefined ? { compare } : {}),
      },
    });

    // 秘境层奖励（#7）：层表 rewards 逐项入账 + dungeon:floor 事件；
    // 道韵双键同律（daoYunEarned 只增不减——花掉不回锁，深层秘境供养兵解）。
    if (state.dungeon) {
      const run = state.dungeon;
      const dungeon = findDungeon(content, run.dungeonId);
      const rewards = dungeon ? dungeonLayerOf(dungeon, run.floor)?.rewards : undefined;
      const goldReward =
        typeof rewards?.gold === 'number' && Number.isFinite(rewards.gold) && rewards.gold > 0
          ? Math.floor(rewards.gold)
          : 0;
      if (goldReward > 0) state.gold += goldReward;
      const items: Record<string, number> = {};
      for (const stack of rewards?.items ?? []) {
        const count = stack?.count;
        if (typeof stack?.item === 'string' && typeof count === 'number' && Number.isFinite(count) && count > 0) {
          addItem(stack.item, Math.floor(count));
          items[stack.item] = (items[stack.item] ?? 0) + Math.floor(count);
        }
      }
      const rawDaoYun = rewards?.daoYun;
      const daoYunReward =
        typeof rawDaoYun === 'number' && Number.isFinite(rawDaoYun) && rawDaoYun > 0
          ? Math.floor(rawDaoYun)
          : 0;
      if (daoYunReward > 0) {
        state.daoYun += daoYunReward;
        state.daoYunEarned += daoYunReward;
      }
      events.emit({
        type: 'dungeon:floor',
        time,
        data: {
          dungeonId: run.dungeonId,
          dungeonName: dungeon?.name ?? run.dungeonId,
          floor: run.floor,
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
    const maxHp = combatStats(enemy).maxHp;
    state.hp = Math.max(1, Math.round(maxHp * cparams.lowHpFraction));
    state.combat = null;
    state.lastEncounter[enemy.id] = { rounds: c.rounds, won: false, at: time };
    leaveDungeon(); // 秘境败退：攻略作废，最高层记录保留（#7）
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
      const enemy = resolveEnemy(c.enemyId);
      if (!enemy) {
        state.combat = null; // 内容包已变更：安全弃置
        leaveDungeon(); // 秘境层敌失引用：连攻略一并自愈（防孤儿锁死 enter/combat:start）
        return;
      }
      if (c.respT > 0) {
        const step = Math.min(remaining, c.respT);
        c.respT -= step;
        remaining -= step;
        if (c.respT <= 0) {
          if (state.dungeon) {
            // 秘境推进（#7）：残血退避同律（挂机不送死，离境保留最高层），
            // 否则自动进入下一层——层序列与 autoFight 开关无关（爬塔即挂机）。
            if (state.hp < playerStats(hpContext()).maxHp * cparams.lowHpFraction) {
              stopCombat(noteFrom('retreatWounded'));
              return;
            }
            advanceDungeonFloor();
            continue;
          }
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
      // 自动服药（血线触发；目标为背包中首个 heal 类消耗品，引擎零内容感知）
      if (state.autoEat && state.hp < playerStats(hpContext()).maxHp * cparams.autoEatHpFraction) {
        const healConsumable = Object.keys(state.items).find((itemId) => {
          if (!((state.items[itemId] ?? 0) > 0)) return false;
          const item = findItem(content, itemId);
          return item?.type === 'consumable' && item.heal !== undefined;
        });
        if (healConsumable) eatConsumable(healConsumable, true);
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
    if (state.dungeon) state.dungeon = null; // 秘境不可离线续跑：就地离境（最高层已随进层登记，#7）
    // 离线上限（offlineCap 消费点，#6）：Σflat 毫秒，≤ 0 = 不设限（基线行为
    // 完全一致）；超限部分不入账（上限的语义本体）。
    const cap = offlineCapOf(playerContributions());
    if (cap > 0 && elapsedMs > cap) elapsedMs = cap;
    const active = state.activity;
    if (!active) return;
    const skill = findSkill(content, active.skillId);
    if (!skill) {
      state.activity = null;
      return;
    }
    if (skill.kind === 'craft') {
      settleCraftOffline(active, skill, elapsedMs);
      return;
    }
    const found = findActivity(content, active.skillId, active.index);
    if (!found) {
      state.activity = null;
      return;
    }
    const { activity } = found;

    // 采集速度（gatherSpeed 消费点，#6）：有效间隔与在线 settleActivity 同调。
    const interval = effectiveIntervalOf(activity.interval, gatherSpeedOf(playerContributions()));
    const total = active.progress + elapsedMs;
    const cycles = Math.floor(total / interval);
    active.progress = total - cycles * interval;

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

    // 采集修为乘数（gatherXp 消费点）先行叠乘，xpMult 由 grantExp 单点消费
    // ——离线/在线语义对称（在线 completeActivityOnce 同式）。
    const gatherMult =
      aggregateStats({ gatherXp: 1 }, playerContributions(), {}).gatherXp?.value ?? 1;
    const expBase = Math.round(activity.exp * cycles * gatherMult);
    const before = levelFromXp(xpOf(skill.id));
    const expTotal = grantExp(skill, expBase, true);
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
        exp: expTotal,
        items,
        levels,
      },
    });
  }

  /**
   * 炼制离线补偿（ADR-013 观察时补偿，O(1) 统计式）：成功数 = floor(期望) +
   * 余数无偏掷定（副产出同式先例）。材料按完整轮数扣减（失败不返料、只返还
   * 修为，与在线语义一致）；材料只够部分轮数 → 炼完即停炉（活动清空）。
   * 装备产出为离散唯一实体，逐件掷定稀有度与词条（有界：attempts ≤ 时长/interval）。
   */
  function settleCraftOffline(active: ActivityState, skill: SkillView, elapsedMs: number): void {
    const recipe = findRecipe(content, active.index);
    if (!recipe || recipe.skill !== skill.id) {
      state.activity = null;
      return;
    }
    const total = active.progress + elapsedMs;
    const cycles = Math.floor(total / recipe.interval);
    active.progress = total % recipe.interval;

    state.hp = hpCap(); // 离线全程脱战

    if (cycles <= 0) return;
    let attempts = cycles;
    for (const [matId, need] of Object.entries(recipe.materials)) {
      const afford = Math.floor((state.items[matId] ?? 0) / need);
      if (afford < attempts) attempts = afford;
    }
    if (attempts <= 0) {
      state.activity = null; // 无料可炼：停炉
      return;
    }

    const rate = craftSuccessRateOf(content, state.skills, recipe);
    const expected = attempts * rate;
    const whole = Math.floor(expected);
    let successes = whole;
    if (whole < attempts && random() < expected - whole) successes += 1; // 余数无偏掷定
    const failures = attempts - successes;

    for (const [matId, need] of Object.entries(recipe.materials)) {
      takeItem(matId, need * attempts);
    }

    const items: Record<string, number> = {};
    const item = findItem(content, recipe.output.item);
    if (item && successes > 0) {
      if (item.type !== 'equip') {
        addItem(item.id, recipe.output.count * successes);
        items[item.id] = recipe.output.count * successes;
      } else {
        const bias = levelOf(skill.id) * crparams.rarityBiasPerLevel;
        // 装备产出按 output.count 逐件掷定（与在线 grantCraftOutput 同语义）。
        const instances = successes * recipe.output.count;
        for (let i = 0; i < instances; i++) {
          state.gearSeq += 1;
          const gear = makeGear(
            content,
            item.id,
            item.bonuses ?? {},
            state.gearSeq,
            random,
            rollRarity(content, random, bias),
            aparams,
          );
          state.gear.push(gear);
        }
        items[item.id] = instances;
      }
    }

    const expBase = Math.round(
      successes * recipe.exp + failures * recipe.exp * Math.max(0, crparams.failExpRefund),
    );
    const before = levelFromXp(xpOf(skill.id));
    // xpMult 由 grantExp 单点消费；事件载荷 = 实发值（离线/在线对称）。
    const expTotal = grantExp(skill, expBase, true);
    const after = levelFromXp(xpOf(skill.id));
    const levels =
      after > before
        ? [{ skillId: skill.id, skillName: skill.name, level: Math.min(after, pparams.maxLevel) }]
        : [];

    if (attempts < cycles) state.activity = null; // 材料告罄：停炉（与在线语义一致）

    events.emit({
      type: 'offline-settled',
      time,
      data: {
        seconds: Math.round(elapsedMs / 1000),
        skillId: skill.id,
        skillName: skill.name,
        activityName: recipe.name,
        cycles: attempts,
        exp: expTotal,
        items,
        levels,
      },
    });
  }

  /** 进行中活动的有效轮间隔（snapshot 展示投影，#6）；无活动 = undefined。 */
  function runningIntervalOf(): number | undefined {
    const act = state.activity;
    if (!act) return undefined;
    const skill = findSkill(content, act.skillId);
    if (skill?.kind === 'craft') {
      const recipe = findRecipe(content, act.index);
      return recipe && recipe.skill === skill.id ? recipe.interval : undefined;
    }
    const found = findActivity(content, act.skillId, act.index);
    if (!found) return undefined;
    return effectiveIntervalOf(found.activity.interval, gatherSpeedOf(playerContributions()));
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
          // craft 类技能：动作归 recipes（index = 包内 recipes 下标，#5）。
          // 旧版 startCraft 语义（js/game.js:238-245）：层数门控 + 开炉前验料。
          const craftSkill = findSkill(content, payload.skillId);
          if (craftSkill && craftSkill.kind === 'craft') {
            const recipe = findRecipe(content, payload.index);
            if (!recipe || recipe.skill !== craftSkill.id) {
              reject(action.type, 'not-found');
              return;
            }
            if (levelOf(craftSkill.id) < recipe.unlockLevel) {
              reject(action.type, 'level', {
                level: String(recipe.unlockLevel),
                activity: recipe.name,
              });
              return;
            }
            // 道韵解锁门槛（#6）：按累计道韵判定，判定与 UI 锁定态同源 rebirthGateOf。
            const craftGate = rebirthGateOf(content, state.daoYunEarned, { skillId: craftSkill.id });
            if (craftGate.locked) {
              reject(action.type, 'rebirth-locked', { daoYun: String(craftGate.requiredDaoYun) });
              return;
            }
            if (craftMissingOf(recipe, state.items).length > 0) {
              reject(action.type, 'no-materials', { activity: recipe.name });
              return;
            }
            // 同一配方进行中：幂等派发（不清进度、不发事件）。
            if (
              state.activity &&
              state.activity.skillId === craftSkill.id &&
              state.activity.index === payload.index
            ) {
              return;
            }
            state.activity = {
              skillId: craftSkill.id,
              index: payload.index,
              name: recipe.name,
              progress: 0,
            };
            events.emit({
              type: 'activity-start',
              time,
              data: {
                skillId: craftSkill.id,
                skillName: craftSkill.name,
                index: payload.index,
                activityName: recipe.name,
              },
            });
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
          // 道韵解锁门槛（#6）：同上，按技艺 id 判定。
          const gate = rebirthGateOf(content, state.daoYunEarned, { skillId: found.skill.id });
          if (gate.locked) {
            reject(action.type, 'rebirth-locked', { daoYun: String(gate.requiredDaoYun) });
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
          state.gold += gained;
          events.emit({
            type: 'sell',
            time,
            data: { item: itemId, itemName: item.name, count, gained, gold: state.gold },
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
          // 判定式与 UI 视图 shopAffordOf 同一来源（N4 收敛，#26）：afford = 单件
          // 特化（cost = price × 1），本处为 count 泛化式，禁止壳内另写比较。
          if (state.gold < cost) {
            reject(action.type, 'no-gold', { cost: String(cost), gold: String(state.gold) });
            return;
          }
          state.gold -= cost;
          addItem(itemId, count);
          events.emit({
            type: 'buy',
            time,
            data: { item: itemId, itemName: item?.name ?? itemId, count, cost, gold: state.gold },
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
          // 道韵解锁门槛（#6）：开战判定与 UI 锁定态同源 rebirthGateOf（N1 同款收敛）。
          const rGate = rebirthGateOf(content, state.daoYunEarned, { enemyId });
          if (rGate.locked) {
            reject(action.type, 'rebirth-locked', { daoYun: String(rGate.requiredDaoYun) });
            return;
          }
          // 秘境进行中不可接野战（#7）：层序列战斗在身，先撤退离境再言斗法。
          if (state.dungeon) {
            reject(action.type, 'in-dungeon');
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

        case 'dungeon:enter': {
          // 秘境入门（#7）：定义 → 幂等/互斥 → 门控（道韵/钥匙，判定与 UI 同源
          // dungeonGateOf）→ 气血门控 → 清活动 → 自第 1 层开战（进层即登记最高层）。
          const payload = action.payload as { dungeonId?: unknown } | undefined;
          const dungeonId = payload?.dungeonId;
          if (typeof dungeonId !== 'string') {
            reject(action.type, 'bad-payload');
            return;
          }
          const dungeon = findDungeon(content, dungeonId);
          if (!dungeon) {
            reject(action.type, 'not-found');
            return;
          }
          if (state.dungeon) {
            reject(action.type, 'in-dungeon');
            return;
          }
          if (state.combat) {
            reject(action.type, 'in-combat');
            return;
          }
          const gate = dungeonGateOf(content, dungeonId, {
            daoYunEarned: state.daoYunEarned,
            items: state.items,
          });
          if (gate.locked) {
            // 锁因归一走 gate.daoYunLocked（单一来源，UI 锁定态同调）。
            if (gate.daoYunLocked) {
              reject(action.type, 'locked', { daoYun: String(gate.requiredDaoYun) });
            } else {
              const keyName = findItem(content, gate.keyItem ?? '')?.name ?? gate.keyItem ?? '';
              reject(action.type, 'no-key', { item: keyName });
            }
            return;
          }
          if (state.hp < playerStats(hpContext()).maxHp * cparams.lowHpFraction) {
            reject(action.type, 'low-hp');
            return;
          }
          if (state.activity) {
            const act = state.activity;
            state.activity = null; // 秘境与采集互斥（与 combat:start 同律）
            events.emit({
              type: 'activity-stop',
              time,
              data: { skillId: act.skillId, activityName: act.name },
            });
          }
          state.dungeon = { dungeonId: dungeon.id, floor: 1 };
          state.dungeonBest[dungeon.id] = Math.max(state.dungeonBest[dungeon.id] ?? 0, 1);
          if (!enterDungeonFloor(dungeon, 1)) {
            // 层表空/敌人全缺失：防御离境（包校验已拦，引擎不崩）
            state.dungeon = null;
            reject(action.type, 'no-layer');
            return;
          }
          events.emit({
            type: 'dungeon:enter',
            time,
            data: { dungeonId: dungeon.id, dungeonName: dungeon.name, floor: 1, floors: dungeon.floors },
          });
          return;
        }

        case 'dungeon:leave': {
          // 撤退离境（#7）：战斗在身走 stopCombat（撤退 note + dungeon:leave）；
          // 无战斗（异常态防御）直接清攻略。未在秘境 = 幂等。
          if (!state.dungeon) return;
          if (state.combat) {
            stopCombat();
          } else {
            leaveDungeon();
          }
          return;
        }

        case 'consumable:eat': {
          const payload = action.payload as { item?: unknown } | undefined;
          if (typeof payload?.item !== 'string') {
            reject(action.type, 'bad-payload');
            return;
          }
          eatConsumable(payload.item, false);
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
          state.gold += gained;
          events.emit({
            type: 'sell',
            time,
            data: {
              item: gear.itemId,
              itemName: gearName(content, item?.name ?? gear.itemId, gear.rarity),
              count: 1,
              gained,
              gold: state.gold,
            },
          });
          return;
        }

        case 'rebirth:perform': {
          // 兵解（#6）：转生结算框架——重置集/保留集/道韵公式全部来自
          // content.rebirth；瞬态（活动/战斗/气血）由引擎一律清空回满。
          const section = rebirthOf(content);
          if (!section) {
            reject(action.type, 'not-available');
            return;
          }
          if (state.combat) {
            reject(action.type, 'in-combat');
            return;
          }
          const preview = rebirthPreviewOf(content, state.skills);
          if (!preview.eligible) {
            reject(action.type, 'no-progress', {
              need: String(preview.minProgress),
              xp: String(preview.totalXp),
            });
            return;
          }
          applyRebirthReset(section, state);
          state.daoYun += preview.gain;
          state.daoYunEarned += preview.gain;
          state.rebirths += 1;
          state.activity = null; // 散功：进度一并弃置（结算事件承载体，不另发 activity-stop）
          state.combat = null;
          state.dungeon = null; // 攻略作废（瞬态）；dungeonBest 为记录资产，default-keep 长存（#7）
          state.hp = hpCap(); // 新一世气血回满（上限已随重置/天赋重算）
          events.emit({
            type: 'rebirth',
            time,
            data: { daoYun: preview.gain, totalXp: preview.totalXp, rebirths: state.rebirths },
          });
          return;
        }

        case 'talent:buy': {
          // 点亮天赋（#6）：前置全点亮 + 道韵余额足额；效果经
          // talentContributionsOf 常驻注入聚合管线（playerContributions）。
          if (!rebirthOf(content)) {
            reject(action.type, 'not-available');
            return;
          }
          const payload = action.payload as { nodeId?: unknown } | undefined;
          const nodeId = payload?.nodeId;
          if (typeof nodeId !== 'string') {
            reject(action.type, 'bad-payload');
            return;
          }
          const node = talentNodeOf(content, nodeId);
          // 判定走 talentGateOf（单一来源，UI 锁定态同调，N4 收敛）。
          const gate = talentGateOf(content, state.daoYun, state.talents, nodeId);
          if (!gate.exists || !node) {
            reject(action.type, 'not-found');
            return;
          }
          if (gate.owned) return; // 已点亮幂等
          if (gate.prereqMissing) {
            reject(action.type, 'prereq');
            return;
          }
          if (!gate.affordable) {
            reject(action.type, 'no-daoyun', { cost: String(node.cost), daoYun: String(state.daoYun) });
            return;
          }
          state.daoYun -= node.cost;
          state.talents.push(nodeId);
          // 气血上限随天赋变化：负向修饰符时 clamp（正向不回血，旧版同策略）。
          state.hp = Math.min(state.hp, hpCap());
          events.emit({
            type: 'talent:buy',
            time,
            data: { nodeId, name: node.name, cost: node.cost, daoYun: state.daoYun },
          });
          return;
        }

        default:
          reject(action.type, 'unknown-action');
      }
    },

    snapshot(): SaveData {
      // GameState 无索引签名，与 GameContent 同理放宽为透明 Record（#2 先例）。
      const runningInterval = runningIntervalOf();
      return {
        version: 1,
        time,
        savedAt: clock.now(),
        state: cloneState(state) as unknown as Readonly<Record<string, unknown>>,
        // 属性面板（#4 验收：佩戴稀有度武器 → snapshot 反映倍率+词条）。
        stats: playerStats(),
        // 进行中活动的有效轮间隔（#6 展示投影）：采集按 gatherSpeed 缩放
        // （与 settleActivity/settleOffline 同调 effectiveIntervalOf），炼制为
        // 配方原值；进度条零公式复算。非存档必需，恢复侧忽略。
        ...(runningInterval !== undefined ? { activityInterval: runningInterval } : {}),
      };
    },
  };
}
