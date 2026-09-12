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
  findBlank,
  findEnemy,
  findGearDrop,
  findItem,
  findRecipe,
  findRarity,
  findShopEntry,
  findSkill,
  gearParamsOf,
  playerMaxHp,
  progressionParamsOf,
  signatureOf,
  skillsOf,
  textsOf,
  weaponSlotOf,
  type ActivityView,
  type EnemyView,
  type ItemView,
  type RecipeView,
  type SkillView,
} from './contentView.js';
import {
  affinityMultiplier,
  calcDmg,
  compareEncounterText,
  fillTemplate,
  BASIC_KEY,
  ELEMENT_COMBAT_PRIMITIVES,
  hitTierOf,
  makeAttackText,
  pickText,
  rollCrit,
  summarizeRounds,
  type DamageTier,
  type ElementCombatPrimitive,
} from './combat.js';
import {
  gearContributions,
  gearName,
  gearSell,
  makeGear,
  rollGear,
  rollRarity,
  tierBoundsOf,
  type GearInstance,
} from './gear.js';
import {
  clearRebirthTransient,
  cloneState,
  initialState,
  restoreState,
  type ActivityState,
  type CombatState,
  type CombatSummonState,
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
import {
  bossEnemyOf,
  findBossOf,
  isLiveSummon,
  pickSummonEntry,
  summonMinionOf,
  summonPoolOf,
  type BossView,
} from './bosses.js';
import { applyStatsEvent } from './stats.js';
import { achievementConditionMet, achievementsOf } from './achievements.js';

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
  const gparams = gearParamsOf(content); // 装备构筑循环参数（#14：熔炼/重铸/标签加权）

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
  // 统计累积（#9）：订阅自身事件总线，emit 即同步累积到 state.stats
  //（监听器异常由 EventBus 吞掉；成就评估在 tick/dispatch/settleOffline 末尾统一进行）。
  events.subscribe((event) => applyStatsEvent(state.stats, event));
  const hpCap = (): number => playerStats(hpContext()).maxHp;
  const xpOf = (skillId: string): number => state.skills[skillId]?.xp ?? 0;
  const levelOf = (skillId: string): number => levelFromXp(xpOf(skillId), pparams);
  if (options.save) {
    // 恢复后按完整属性投影重 clamp 气血（#41）：state.ts 已按收编后的修为钳过
    // 基线，此处兜佩戴/增益/天赋投影出的上限差（投影上限低于存档 hp 时压回，
    // 如负向贡献或旧档跨包越顶）；只降不升，回满属回血/settleOffline 语义。
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

  /** 佩戴中的武器；无则拳脚（招式注册键与动词池随之兜底）。武器槽按
   * role === 'weapon' 解析（#14 放宽，'weapon' 键不再是引擎硬编码），
   * 未声明 role 的包按槽位 id 兜底识别（weaponSlotOf 单一来源）。 */
  function wornWeapon(): { readonly gear: GearInstance; readonly item: ItemView } | undefined {
    const weaponSlot = weaponSlotOf(content);
    if (weaponSlot === undefined) return undefined;
    const uid = state.equips[weaponSlot];
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

  /* ---------- 系别（#15，ADR-012 结构签名）：签名/亲和/风味全 content 参数化 ---------- */

  /**
   * 玩家攻击系别：佩戴武器的 element（开放键域，elements 注册表）；无武器 /
   * 未声明 = 凡击。签名/亲和度/风味句的攻方来源单点。
   */
  function weaponElement(): string | undefined {
    const element = wornWeapon()?.item.element;
    return typeof element === 'string' && element.length > 0 ? element : undefined;
  }

  /**
   * 攻击系别的机制签名（系数/时长全读 content，引擎零写死）：签名解析失败
   * （未注册/形状非法）= 纯风味系，机制层静默降级为凡击。
   */
  function attackSignature() {
    return signatureOf(content, weaponElement());
  }

  /**
   * 系别临时态过期时刻（#15）：金·破防 / 水·滞缓 / 风·迅疾 → 过期游戏内时间。
   * **只在闭包内，不落盘**（票面约束：抗性/临时态不进存档新字段）——开战/
   * 再战/离线一律重置，存档恢复即散尽。数值不在此存：每次消费按当前武器
   * 系别现读 content 签名（改包即生效，无第二份缓存）。
   */
  const elemExpiry: Record<ElementCombatPrimitive, number> = { defenseBreak: 0, slow: 0, swift: 0 };
  const resetElemExpiry = (): void => {
    for (const primitive of Object.keys(elemExpiry)) {
      elemExpiry[primitive as ElementCombatPrimitive] = 0;
    }
  };

  /** 系别命中：机械原语签名即时生效（过期时间 = 当前时刻 + 时长，命中即续）。 */
  function applyElementProc(element: string | undefined): void {
    const signature = element !== undefined ? signatureOf(content, element) : undefined;
    if (!signature) return;
    elemExpiry[signature.primitive as ElementCombatPrimitive] = time + signature.duration!;
  }

  /** 临时态在效时取原语参数（比例钳 [0,1)，防御坏内容；系数现读 content）。 */
  function activeSignatureValue(
    primitive: ElementCombatPrimitive,
    expiry: number,
    signature: ReturnType<typeof attackSignature>,
  ): number {
    if (!signature || signature.primitive !== primitive || expiry <= time) return 0;
    return Math.min(0.999, Math.max(0, signature.value ?? 0));
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

  /** 战斗双方语境合成：攻侧 moveId+系别（武器 element，#15）、防侧来袭 element
   * （条件修饰符门控：受某系伤害的抗性铭纹走此语境）。 */
  function combatStats(enemy: EnemyView): {
    atk: number;
    crit: number;
    def: number;
    maxHp: number;
  } {
    const moveKey = weaponMoveKey();
    const element = weaponElement();
    const atkSide = aggregateStats(statBase(), playerContributions(), {
      moveId: moveKey,
      ...(element !== undefined ? { element } : {}),
    });
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

  /** 装备实例展示名（「档名·物品名」单一拼装点，掉落/熔炼/重铸三处共用）。 */
  function gearDisplayName(gear: GearInstance): string {
    return gearName(content, findItem(content, gear.itemId)?.name ?? gear.itemId, gear.rarity);
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
      const gear = makeGear(content, item.id, item.bonuses ?? {}, state.gearSeq, random, {
        rarity: rollRarity(content, random, bias),
        affix: aparams,
      });
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

  /**
   * 战斗中的敌人解析（#7/#8 单点组合）：秘境层倍率投影在前，Boss 阶段
   * 修正在后（叠乘——秘境深层插 Boss 零特判）；两者皆无 = 敌人定义原值。
   */
  function resolveEnemy(enemyId: string): EnemyView | undefined {
    const run = state.dungeon;
    let view = run
      ? dungeonFloorEnemyOf(content, run.dungeonId, run.floor, enemyId)
      : findEnemy(content, enemyId);
    if (!view) return undefined;
    const c = state.combat;
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
    const c = state.combat;
    if (!c) return undefined;
    const boss = findBossOf(content, c.enemyId);
    if (!boss) return undefined;
    const run = state.dungeon;
    const scaled = run ? dungeonFloorEnemyOf(content, run.dungeonId, run.floor, minion.enemyId) : undefined;
    const base = scaled ?? findEnemy(content, minion.enemyId);
    if (!base) return undefined;
    return summonMinionOf(content, boss, minion.phase, minion.enemyId, base) ?? base;
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
    events.emit({
      type: 'boss:summon',
      time,
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
      events.emit({
        type: 'boss:phase',
        time,
        data: { enemyId: enemy.id, enemyName: enemy.name, phase: c.bossPhase + 1, name },
      });
      const narration = pickText(next.narration, random);
      if (narration !== undefined) {
        emitNote(fillTemplate(narration, { enemy: enemy.name, phase: name }), enemy.id);
      }
      spawnSummons(boss, enemy, c.bossPhase, c); // 召唤原语（#30）：阶段声明的召唤入场
    }
  }

  /** 进入指定层：加权抽敌 → 以层倍率投影的气血开战（战斗状态机与解算零分叉）。 */
  function enterDungeonFloor(dungeon: DungeonView, floor: number): boolean {
    const enemy = pickDungeonEnemyOf(content, dungeon, floor, random);
    if (!enemy) return false;
    const scaled = dungeonFloorEnemyOf(content, dungeon.id, floor, enemy.id) ?? enemy;
    resetElemExpiry(); // 系别临时态不跨战团（开新战一律归零，#15）
    state.combat = {
      enemyId: scaled.id,
      ehp: scaled.hp,
      pt: 0,
      et: 0,
      respT: 0,
      rounds: 0,
      crits: 0,
      tiers: { light: 0, mid: 0, heavy: 0, deadly: 0 },
      bossPhase: -1,
      summons: [],
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

    const moveKey = weaponMoveKey();
    const weapon = wornWeapon();
    const element = weaponElement();
    const { atk, crit: critChance } = combatStats(target);
    // 金·破防（临时态在效）：受击者 def 临时降低 → 减伤解算按破防后 def。
    const signature = attackSignature();
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
        verbStyle: playerVerbStyle(),
        weaponName: weapon ? weapon.item.name : basicName,
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
    events.emit({
      type: 'attack',
      time,
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
          emitNote(noteFrom('reengage', { enemy: enemy.name }), enemy.id);
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
    const { def, maxHp } = combatStats(enemy);
    const dmg = calcDmg(enemy.atk, def, random, cparams);
    state.hp -= dmg;
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
        defenderHp: Math.max(0, state.hp),
        defenderMaxHp: maxHp,
        // 敌方系别（#15）：风味句按攻方系别路由；玩家侧无亲和表，语境缺省。
        ...(enemy.element !== undefined ? { element: enemy.element } : {}),
      },
      random,
      cparams,
    );
    events.emit({
      type: 'attack',
      time,
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

    // Boss 专属掉落（#8）：与 enemy.drops 同机制叠加掷点（bosses[].drops）。
    for (const drop of findBossOf(content, enemy.id)?.drops ?? []) {
      if (drop.item && random() < drop.chance) {
        addItem(drop.item, 1);
        emitLoot(drop.item, 1, 'drop');
        drops.push(drop.item);
      }
    }

    let gearDropName: string | undefined;
    const gearDrop = findGearDrop(content, enemy.id);
    if (gearDrop) {
      // 掉落管线（#14 补全 ①②③⑦）：①掉不掉 → ②按秘境层数筛器胚池 → ③选底材
      // → ④~⑦实例化（equip 走词条池旧管线；器胚走铭纹管线）。稀有度掷点不传
      // 偏置（#5 接缝：掉落侧与旧签名逐点同分布）；uid 只在实得时入账（不空烧序号）。
      const gear = rollGear(content, gearDrop, state.gearSeq + 1, random, {
        floor: state.dungeon?.floor,
      });
      if (gear) {
        state.gearSeq = gear.uid;
        state.gear.push(gear);
        gearDropName = gearDisplayName(gear);
        events.emit({
          type: 'loot',
          time,
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

    const skill = combatSkill();
    if (skill) grantExp(skill, enemy.exp, false);

    const tally = { rounds: c.rounds, crits: c.crits, tiers: c.tiers };
    const summary = summarizeRounds(tally, combatText, random);
    const prev = state.lastEncounter[enemy.id];
    const compare = compareEncounterText(prev, c.rounds, combatText, random);
    state.lastEncounter[enemy.id] = { rounds: c.rounds, won: true, at: time };
    c.respT = cparams.victoryRestMs; // 战斗态保留（ehp ≤ 0），休整后按 autoFight 决定去留
    c.summons = []; // Boss 死亡清场（#30）：残存召唤物随主敌溃散，不参与结算

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
            c.bossPhase = -1; // Boss 重生从头演阶段（#8：阶段随再战重置归位）
            c.summons = []; // 召唤物随再战清场（#30：Boss 重生不带残阵）
            resetElemExpiry(); // 系别临时态随再战归零（Boss 重生不带残效，#15）
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
      // 推进到下一个事件点（玩家出招 / 主敌人出招 / 召唤物出招 / dt 消化完）
      // 有效间隔 = 基础间隔 ×（1 ∓ 系别速率修正，#15）：风·迅疾缩短玩家间隔、
      // 水·滞缓延长敌方间隔（临时态在效时；系数现读 content 签名）。
      // 敌人缺省攻击间隔 = 玩家间隔（config.combat.playerAttackInterval，#020）。
      const signature = attackSignature();
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
      let step = Math.min(remaining, pInterval - c.pt, eInterval - c.et);
      c.summons.forEach((minion, i) => {
        step = Math.min(step, minionIntervals[i]! - minion.et);
      });
      step = Math.max(0, step);
      c.pt += step;
      c.et += step;
      c.summons.forEach((minion) => {
        minion.et += step;
      });
      remaining -= step;
      if (c.pt >= pInterval) {
        c.pt -= pInterval;
        playerAttackRound(enemy, c);
        if (!state.combat) return;
      }
      if (c.et >= eInterval) {
        c.et -= eInterval;
        enemyAttackRound(enemy, c);
        if (!state.combat) return;
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
          if (!state.combat) return;
        }
      }
    }
  }

  /**
   * 成就评估（#9）：按 content 包成就表对照统计 snapshot 判定。
   * 解锁一次且仅一次（state.achievements 稳定引用幂等）；奖励（灵石/道韵/物品）
   * 由引擎入账并随 achievement:unlock 事件承载（物品静默入袋，不重发 loot）。
   * 消费点：tick/dispatch/settleOffline 末尾各评估一次——统计只在事件流中变化，
   * 单次调用末评估即可覆盖全部增长点（离线只发单条 offline-settled 的契约不受影响）。
   */
  function evaluateAchievements(): void {
    for (const def of achievementsOf(content)) {
      if (state.achievements.includes(def.id)) continue;
      if (!achievementConditionMet(def.condition, state.stats)) continue;
      state.achievements.push(def.id);
      const items: Record<string, number> = {};
      if (def.reward) {
        if (def.reward.gold !== undefined) state.gold += def.reward.gold;
        if (def.reward.daoYun !== undefined) {
          state.daoYun += def.reward.daoYun;
          state.daoYunEarned += def.reward.daoYun; // 道韵双键同律（花掉不回锁）
        }
        for (const stack of def.reward.items ?? []) {
          // 物品须存在（包校验 xref 已保证；引擎对坏包防御：静默跳过不建孤儿键）。
          if (!findItem(content, stack.item)) continue;
          addItem(stack.item, stack.count);
          items[stack.item] = (items[stack.item] ?? 0) + stack.count;
        }
      }
      events.emit({
        type: 'achievement:unlock',
        time,
        data: {
          id: def.id,
          name: def.name,
          ...(def.reward?.gold !== undefined ? { gold: def.reward.gold } : {}),
          ...(def.reward?.daoYun !== undefined ? { daoYun: def.reward.daoYun } : {}),
          ...(Object.keys(items).length > 0 ? { items } : {}),
        },
      });
    }
  }

  /**
   * 离线补偿结算（ADR-013 观察时补偿）：O(1) 算清欠账——
   * 完整轮次产出直接累加；副产出用 floor(期望) + 余数伯努利一次掷定，
   * 不逐轮回放。气血按脱战回满。只产出一条 offline-settled 汇总事件。
   */
  function settleOfflineInner(elapsedMs: number): void {
    if (elapsedMs <= 0) return;
    if (state.combat) {
      state.combat = null; // 离线不可战斗：视作离场休整，回满血由下方统一处理
      resetElemExpiry(); // 系别临时态不落盘，离线离场即散（#15）
    }
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
          const gear = makeGear(content, item.id, item.bonuses ?? {}, state.gearSeq, random, {
            rarity: rollRarity(content, random, bias),
            affix: aparams,
          });
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

    settleOffline(elapsedMs: number): void {
      settleOfflineInner(elapsedMs);
      evaluateAchievements();
    },

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
      evaluateAchievements(); // 成就评估在 tick 末尾统一进行（#9）
    },

    dispatch(action: GameAction): void {
      try {
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
            bossPhase: -1,
            summons: [],
          };
          resetElemExpiry(); // 开新战：系别临时态归零（不跨战团，#15）
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

        case 'gear:smelt': {
          // 熔炼（#14）：分解囊中装备得器屑。产出按稀有度档位 smelt 字段
          // （缺省 = 引擎基线 1）；器屑物品 id 归 config.gear.shardItem——
          // 未配置 = 该包无器屑经济，not-available 零降级路径。
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
          const shardItem = gparams.shardItem;
          if (!shardItem || !findItem(content, shardItem)) {
            reject(action.type, 'not-available');
            return;
          }
          const shards = Math.max(0, Math.floor(findRarity(content, gear.rarity)?.smelt ?? 1));
          state.gear = state.gear.filter((entry) => entry.uid !== uid);
          addItem(shardItem, shards);
          events.emit({
            type: 'gear:smelt',
            time,
            data: {
              uid,
              item: shardItem,
              shards,
              name: gearDisplayName(gear),
            },
          });
          return;
        }

        case 'gear:reforge': {
          // 重铸铭纹（#14）：消耗器屑重随单条铭纹的纹阶（数值随内容三阶表
          // tiers[tier] 变化），天花板由器胚 tierRange 数据锁死；仅器胚实例
          // 可重铸，佩戴中不可（与卖出同律）。
          const payload = action.payload as { uid?: unknown; index?: unknown } | undefined;
          const uid = readUidPayload(payload);
          const index = payload?.index;
          if (uid === undefined || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
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
          const inscription = gear.inscriptions?.[index];
          const blank = inscription ? findBlank(content, gear.itemId) : undefined;
          if (!inscription || !blank) {
            reject(action.type, 'no-inscription');
            return;
          }
          if (!gparams.shardItem || !findItem(content, gparams.shardItem)) {
            reject(action.type, 'not-available');
            return;
          }
          const cost = Math.max(0, Math.floor(gparams.reforgeCost));
          const owned = state.items[gparams.shardItem] ?? 0;
          if (owned < cost) {
            reject(action.type, 'no-shard', { cost: String(cost), owned: String(owned) });
            return;
          }
          // 纹阶重随：tierBoundsOf 数据锁死（与实例化掷阶/存档钳制同一来源）。
          const [tierMin, tierMax] = tierBoundsOf(blank);
          const tier = tierMin + Math.floor(random() * (tierMax - tierMin + 1));
          takeItem(gparams.shardItem, cost);
          const inscriptions = gear.inscriptions!.map((insc, i) =>
            i === index ? { ...insc, tier } : insc,
          );
          state.gear = state.gear.map((entry) =>
            entry.uid === uid ? { ...entry, inscriptions } : entry,
          );
          events.emit({
            type: 'gear:reforge',
            time,
            data: {
              uid,
              index,
              tier,
              inscriptionId: inscription.id,
              name: gearDisplayName(gear),
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
          // 瞬态清场走字段表（#42 D2）：活动散置（进度一并弃置）、战斗散去、
          // 秘境攻略作废（dungeonBest 为记录资产 default-keep 长存，#7）。
          clearRebirthTransient(state);
          state.daoYun += preview.gain;
          state.daoYunEarned += preview.gain;
          state.rebirths += 1;
          state.hp = hpCap(); // 新一世气血回满（上限已随重置/天赋重算；投影依赖归 game.ts，字段表外）
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
      } finally {
        // 早退路径（各 case 的 return）同样评估：finally 保证出口全覆盖（#9）。
        evaluateAchievements();
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
