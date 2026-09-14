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
  findItem,
  findRecipe,
  findRarity,
  findShopEntry,
  findSkill,
  gearParamsOf,
  progressionParamsOf,
  recipesOf,
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
  fillTemplate,
  BASIC_KEY,
  pickText,
} from './combat.js';
import {
  gearContributions,
  gearName,
  gearSell,
  makeGear,
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
  type GameState,
} from './state.js';
import type {
  Clock,
  GameAction,
  GameContent,
  PlayerStatsView,
  SaveData,
} from './types.js';
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
  findDungeon,
  pickDungeonEnemyOf,
  type DungeonView,
} from './dungeon.js';
import { applyStatsEvent } from './stats.js';
import { achievementConditionMet, achievementsOf } from './achievements.js';
import { createCombatRun, makeCombatState } from './combatRun.js';
import type {
  AutoFoldRule,
  LedgerAuto,
  LedgerData,
  LedgerOrigin,
  LedgerSource,
} from './ledger.js';

/**
 * 离线结算最短门槛（旧版 game.js:430 同款 60s，保真收口 #62）：低于此值的
 * 时间差不算离线（关掉秒开不弹补偿、不触发休整回满，堵"切后台 5s 脱战+
 * 满血"漏洞）；后台节流的微欠账同样不追（旧版语义，几十秒产出玩家无感）。
 */
const OFFLINE_MIN_MS = 60_000;

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
  /**
   * 自动售卖/熔炼规则挂点（#39 D3）：入账即折——炼制产出/战斗掉落在入账
   * 前过此规则，命中则物品不进乾坤袋直接折灵石/器屑并发成对账本事件。
   * 缺省 no-op（零行为差异）；规则本体（阈值表/互斥/UI）归 #35/#36。
   */
  readonly autoFold?: AutoFoldRule;
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
  // 顶层 time 与 state 内层同律（坏档 = 新开局兜底）：非有限值拒收，防字符串
  // 档把 time += dt 变拼接、污染 buff 到期与 encounter.at 全部时间语义。
  let time =
    typeof options.save?.time === 'number' && Number.isFinite(options.save.time)
      ? options.save.time
      : 0;

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
    // 恢复后按完整属性投影钳气血（#41，唯一上限钳点）：state.ts 只做收编校验
    //（hp 行声明序在 gear 前、投影不可见），佩戴/增益/天赋投影出的上限在此
    // 统一生效——存档超顶（含装备抬升头寸）压回当前真实上限；只降不升，
    // 回满属回血/settleOffline 语义。
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
   * 系别临时态（elemExpiry）随 #51 收编 CombatRun——本处只保留签名解析
   * 这一面板读取器，过期时刻的存取全走 combatRun 窄门。
   */
  function attackSignature() {
    return signatureOf(content, weaponElement());
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

  /* ---------- 入账咽喉（#39，C1）：资产变更唯一收口——改态 + 发统一账本事件 ---------- */

  /** 归属上下文标注（origin 必带；offline 只在离线结算管线携带）。 */
  interface LedgerMeta {
    readonly origin: LedgerOrigin;
    readonly offline?: true;
  }

  const autoFold = options.autoFold; // 缺省 undefined = no-op 挂点（零行为差异）
  const META_IDLE: LedgerMeta = { origin: 'idle' };
  const META_USER: LedgerMeta = { origin: 'user' };
  const META_OFFLINE: LedgerMeta = { origin: 'idle', offline: true }; // 离线 = 挂机归段

  function emitLedger(data: LedgerData): void {
    events.emit({ type: 'ledger', time, data });
  }

  /** 账本事件公共尾：来源 + 归属上下文（来源记真实出处，折叠方式单独标 auto）。 */
  const ledgerBase = (source: LedgerSource, meta: LedgerMeta) => ({
    source,
    origin: meta.origin,
    ...(meta.offline ? { offline: true as const } : {}),
  });

  /** 折叠挂点判定（D3）：入账即折在咽喉内部，规则本体归 #35/#36。
   * 挂点按 CONTEXT「自动售卖/熔炼」收窄为配方（craft 产出）与敌人
   * （combat 掉落）两类——其余来源（商店/成就/层奖等）不咨询挂点。 */
  function foldDecisionOf(source: LedgerSource, itemId: string, rarity?: string): LedgerAuto | undefined {
    if (source !== 'craft' && source !== 'combat') return undefined;
    return autoFold?.({ source, itemId, ...(rarity !== undefined ? { rarity } : {}) });
  }

  /** 熔炼产出（器屑数，按稀有度 smelt 字段缺省 1）；无器屑经济 = undefined（不可熔）。 */
  function smeltYieldOf(rarity: string): { shardItem: string; shards: number } | undefined {
    const shardItem = gparams.shardItem;
    if (!shardItem || !findItem(content, shardItem)) return undefined;
    return { shardItem, shards: Math.max(0, Math.floor(findRarity(content, rarity)?.smelt ?? 1)) };
  }

  /**
   * 物品增减入账：正数 = 入袋（先过折叠挂点，命中即「入账即折」不进袋、
   * 发成对事件）；负数 = 出袋（调用方先验足量）。返回物品是否实际进了
   * 乾坤袋——并行期旧 loot 事件以此门控（折叠路径静默，D10/验收 4）。
   */
  function ledgerItem(itemId: string, count: number, source: LedgerSource, meta: LedgerMeta): boolean {
    if (count === 0) return false;
    const item = findItem(content, itemId);
    if (!item) return false; // 坏包防御：未知键不入账（包校验 xref 已拦，理论不可达）
    if (count > 0) {
      if (foldDecisionOf(source, itemId) === 'sell') {
        const gained = Math.max(0, item.sell) * count;
        state.gold += gained;
        // 成对事件（D10）：被折叠物品标记（count=0/value=0 会计不计）+ 折得灵石
        //——0 卖价物品折得为 0：不发零额 proceeds（与 ledgerGold「0 变化不入账」同律）。
        emitLedger({ ...ledgerBase(source, meta), kind: 'item', id: itemId, count: 0, value: 0, auto: 'sell' });
        if (gained > 0) {
          emitLedger({ ...ledgerBase(source, meta), kind: 'currency', id: 'gold', count: gained, value: 1, auto: 'sell' });
        }
        return false;
      }
      // 判 'smelt' 的普通物品无熔炼产出语义（器屑按稀有度档位，需装备实例）：
      // 防御性保持原样入袋（规则形状归 #35，正常不会对无稀有度物品判熔炼）。
      addItem(itemId, count);
      emitLedger({ ...ledgerBase(source, meta), kind: 'item', id: itemId, count, value: Math.max(0, item.sell) });
      return true;
    }
    if (!takeItem(itemId, -count)) return false;
    emitLedger({ ...ledgerBase(source, meta), kind: 'item', id: itemId, count, value: Math.max(0, item.sell) });
    return false;
  }

  /**
   * 装备实例入账：先过折叠挂点（入账即折——实例不进乾坤袋，成对事件 =
   * 标记 + 折得物），否则入袋。返回实例是否实际进了乾坤袋（旧 loot 门控）。
   * uid 序号由调用方先行入账（折叠实例亦作「发生过」记录，D10）。
   */
  function ledgerGearIncome(gear: GearInstance, source: LedgerSource, meta: LedgerMeta): boolean {
    const unitValue = gearSell(content, findItem(content, gear.itemId)?.sell ?? 0, gear.rarity);
    const marker = {
      ...ledgerBase(source, meta),
      kind: 'gear' as const,
      id: gear.itemId,
      uid: gear.uid,
      rarity: gear.rarity,
      count: 0,
      value: 0,
    };
    const auto = foldDecisionOf(source, gear.itemId, gear.rarity);
    if (auto === 'sell') {
      state.gold += unitValue;
      emitLedger({ ...marker, auto });
      emitLedger({ ...ledgerBase(source, meta), kind: 'currency', id: 'gold', count: unitValue, value: 1, auto });
      return false;
    }
    if (auto === 'smelt') {
      const smelt = smeltYieldOf(gear.rarity);
      if (smelt) {
        addItem(smelt.shardItem, smelt.shards);
        emitLedger({ ...marker, auto });
        emitLedger({
          ...ledgerBase(source, meta),
          kind: 'item',
          id: smelt.shardItem,
          count: smelt.shards,
          value: Math.max(0, findItem(content, smelt.shardItem)?.sell ?? 0),
          auto,
        });
        return false;
      }
      // 无器屑经济（config.gear.shardItem 未配置）：防御性保持原样入袋。
    }
    state.gear.push(gear);
    emitLedger({
      ...ledgerBase(source, meta),
      kind: 'gear',
      id: gear.itemId,
      uid: gear.uid,
      rarity: gear.rarity,
      count: 1,
      value: unitValue,
    });
    return true;
  }

  /** 装备出袋入账（bag 卖出/熔炼消费；uid 必在袋中，调用方已验）：count=-1。 */
  function ledgerGearRemoval(gear: GearInstance, source: LedgerSource, meta: LedgerMeta): void {
    state.gear = state.gear.filter((entry) => entry.uid !== gear.uid);
    emitLedger({
      ...ledgerBase(source, meta),
      kind: 'gear',
      id: gear.itemId,
      uid: gear.uid,
      rarity: gear.rarity,
      count: -1,
      value: gearSell(content, findItem(content, gear.itemId)?.sell ?? 0, gear.rarity),
    });
  }

  /** 灵石增减入账：value 恒 1（笔净额 = 灵石数本身）；0 变化不入账。 */
  function ledgerGold(delta: number, source: LedgerSource, meta: LedgerMeta): void {
    if (delta === 0) return;
    state.gold += delta;
    emitLedger({ ...ledgerBase(source, meta), kind: 'currency', id: 'gold', count: delta, value: 1 });
  }

  /** 道韵增减入账：无灵石等价（value=0，修行录单列）；双键同律——earned 只增不减。 */
  function ledgerDaoYun(delta: number, source: LedgerSource, meta: LedgerMeta): void {
    if (delta === 0) return;
    state.daoYun += delta;
    if (delta > 0) state.daoYunEarned += delta;
    emitLedger({ ...ledgerBase(source, meta), kind: 'currency', id: 'daoYun', count: delta, value: 0 });
  }

  /** 发放修为（名义额）：经全经验倍率（xpMult 消费点，#6）取整后入账，与
   * 采集特化倍率 gatherXp（调用方先行叠乘）自然组合。craft/combat/离线单发
   * 路径由此单点消费 xpMult。 */
  function grantExp(
    skill: SkillView,
    amount: number,
    quiet: boolean,
    ledger?: { source: LedgerSource; meta: LedgerMeta },
  ): number {
    if (!(amount > 0)) return 0;
    const granted = Math.round(amount * xpMultOf(playerContributions()));
    return grantExpExact(skill, granted, quiet, ledger);
  }

  /** 发放修为（精确额，不乘 xpMult）：每循环舍入口径的调用方（grantGatherExp/
   * settleCraftOffline）已在单轮粒度消费过倍率，整批传入防二次舍入——否则
   * 离线 round(N×单轮×xpMult) ≠ 在线 N×round(单轮×xpMult)，非整乘数分叉复活。
   * 返回实发值（倍率后取整）——离线事件载荷与实际入账同源。
   * ledger 缺省 = 不发账本事件；提供时无论 quiet 与否都发（修为账本事件是
   * 新协议面：离线结算走同一咽喉管线，offline 标注，#39 D6——quiet 只压旧
   * 形状 exp/levelup，保「离线单条 offline-settled」旧契约）。 */
  function grantExpExact(
    skill: SkillView,
    granted: number,
    quiet: boolean,
    ledger?: { source: LedgerSource; meta: LedgerMeta },
  ): number {
    if (!(granted > 0)) return 0;
    const before = levelFromXp(xpOf(skill.id), pparams);
    // 升级差额回血（旧版 game.js:212-216 语义，保真收口 #62）：旧上限须在
    // xp 写入前留档；仅跨级边缘才多算一次投影，高频路径零开销。
    const crossingLevel =
      levelFromXp(xpOf(skill.id) + granted, pparams) > before && before < pparams.maxLevel;
    const oldCap = crossingLevel ? hpCap() : null;
    const entry = state.skills[skill.id] ?? { xp: 0 };
    entry.xp += granted;
    state.skills[skill.id] = entry;
    if (ledger) {
      // 修为不折灵石（D1）：value=0 净额单列；count=实发值（带符号协议恒正入账）。
      emitLedger({ ...ledgerBase(ledger.source, ledger.meta), kind: 'exp', id: skill.id, count: granted, value: 0 });
    }
    if (!quiet) {
      events.emit({
        type: 'exp',
        time,
        data: { skillId: skill.id, skillName: skill.name, amount: granted },
      });
    }
    const after = levelFromXp(entry.xp, pparams);
    if (after > before && before < pparams.maxLevel) {
      // 上限涨多少血补多少（旧版保真，#62）：战斗中升级血条即时抬升，不再
      // 反跌；完整投影差额含装备/天赋恒定贡献（相消后恰为曲线差额）。
      if (oldCap !== null) state.hp += Math.max(0, hpCap() - oldCap);
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

  /**
   * 采集修为（二轮评审卡5 裁决）：口径 = 每循环舍入——gatherXp 特化乘数与
   * 全经验倍率 xpMult 都在单轮粒度消费（各自 round），恒定乘数下在线逐循环
   * 累加 ≡ 单轮实发 × N（离线 cycles=N 一次调），非整乘数不再 33/32 分叉；
   * 入账走咽喉管线（ledger exp 事件，离线 offline 标注）。
   */
  function grantGatherExp(
    skill: SkillView,
    activity: ActivityView,
    cycles: number,
    quiet: boolean,
    ledger: { source: LedgerSource; meta: LedgerMeta },
  ): number {
    const contribs = playerContributions();
    const gatherMult =
      aggregateStats({ gatherXp: 1 }, contribs, {}).gatherXp?.value ?? 1;
    const perCycle = Math.round(Math.round(activity.exp * gatherMult) * xpMultOf(contribs));
    return grantExpExact(skill, perCycle * cycles, quiet, ledger);
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
    if (ledgerItem(activity.output.item, activity.output.count, 'gather', META_IDLE)) {
      emitLoot(activity.output.item, activity.output.count, 'activity');
    }
    if (activity.byproduct && random() < activity.byproduct.chance) {
      if (ledgerItem(activity.byproduct.item, 1, 'gather', META_IDLE)) {
        emitLoot(activity.byproduct.item, 1, 'byproduct');
      }
    }
    grantGatherExp(skill, activity, 1, false, { source: 'gather', meta: META_IDLE });
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
      ledgerItem(matId, -count, 'craft', META_IDLE);
    }
    if (random() < craftSuccessRateOf(content, state.skills, recipe)) {
      grantCraftOutput(skill, recipe);
      grantExp(skill, recipe.exp, false, { source: 'craft', meta: META_IDLE });
    } else {
      const exp = Math.round(recipe.exp * Math.max(0, crparams.failExpRefund));
      grantExp(skill, exp, false, { source: 'craft', meta: META_IDLE });
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
      if (ledgerItem(item.id, recipe.output.count, 'craft', META_IDLE)) {
        emitLoot(item.id, recipe.output.count, 'craft');
      }
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
      if (ledgerGearIncome(gear, 'craft', META_IDLE)) {
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
      ledgerItem(consumableId, -1, 'eat', silent ? META_IDLE : META_USER);
      // 运行时兜底与 modifiers 侧 isUsable 同律：坏包负值/超界 percent 不致
      // 「吃丹掉血」或越顶回复（包校验是第一道关，此处只降伤害不修正数据）。
      const pct = Number.isFinite(item.heal.percent)
        ? Math.min(1, Math.max(0, item.heal.percent))
        : 0;
      const healed = Math.min(cap, state.hp + Math.round(cap * pct)) - state.hp;
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
      ledgerItem(consumableId, -1, 'eat', silent ? META_IDLE : META_USER);
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

  /* 战斗态构造单一来源（#44 D2，#51 随 CombatRun 迁驻 combatRun.ts 的
   * makeCombatState）：初入开团与再战重置共用一处构造，rounds/crits/tiers
   * 一律出自 emptyTally——手写 CombatState/tally 字面量保持清零（存档恢复
   * 逐项钳制除外，state.ts）。 */

  /** low-hp 线（cparams.lowHpFraction × 当前气血上限）：入场门控与再战/进层退避共用一条线（#44）。 */
  const isLowHp = (): boolean => state.hp < playerStats(hpContext()).maxHp * cparams.lowHpFraction;

  /**
   * 进入战斗单一序列（#44 D1）：low-hp 退避 → 清活动（战斗/采集互斥，发
   * activity-stop）→ 建战斗态（makeCombatState）→ 系别临时态归零 → 开战
   * note。入场不变量唯此一处断言；内容门控（等级/道韵/秘境钥匙）与敌人
   * 来源（野战直取 / 秘境抽敌按层缩放）为调用侧参数差异。
   * actionType 给出（dispatch 面）时 low-hp 代发 reject；层推进（tick 面）
   * 不传——血线已由 combatRun.step 的退避判定先行担保，此处复查恒过。
   * 返回 'low-hp' = 未成战（dispatch 面已代发 reject，调用侧直接收尾）。
   */
  function enterCombat(enemy: EnemyView, actionType?: string): 'ok' | 'low-hp' {
    if (isLowHp()) {
      if (actionType !== undefined) reject(actionType, 'low-hp');
      return 'low-hp';
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
    state.combat = makeCombatState(enemy.id, enemy.hp);
    combatRun.resetProcs(); // 开新战：系别临时态归零（不跨战团，#15）
    emitNote(noteFrom('start', { enemy: enemy.name }), enemy.id);
    return 'ok';
  }

  /* ---------- CombatRun 装配（#51 D2）：deps = 读取器集合 + 咽喉/秘境窄门 ---------- */

  /**
   * 战斗推进的依赖注入（D2）：面板类读取器每次调用现读（战斗中吃丹/换装备
   * 即时生效，禁快照值）；咽喉窄面把战斗路径的入账恒定为 idle 归段；秘境与
   * 停战序列留在 game.ts（DungeonRun 归 #52），此处只递窄门回调。此后
   * 战斗时序变量（pt/et/respT/ehp/伤档/bossPhase/召唤槽/系别临时态）的
   * 读写全部收进 combatRun，game.ts 不再直接操作。
   */
  const combatRun = createCombatRun({
    content,
    cparams,
    combatText,
    random,
    now: () => time,
    emit: (event) => events.emit(event),
    note: noteFrom,
    combat: {
      get: () => state.combat,
      set: (next) => {
        state.combat = next;
      },
    },
    panel: {
      hp: () => state.hp,
      setHp: (value) => {
        state.hp = value;
      },
      maxHp: () => hpCap(),
      lowHp: isLowHp,
      battleStats: combatStats,
      moveKey: weaponMoveKey,
      element: weaponElement,
      verbStyle: playerVerbStyle,
      weaponName: () => wornWeapon()?.item.name ?? basicName,
      signature: attackSignature,
    },
    flags: {
      autoFight: () => state.autoFight,
      autoEat: () => state.autoEat,
    },
    ledger: {
      gold: (delta, source) => ledgerGold(delta, source, META_IDLE),
      item: (itemId, count, source) => ledgerItem(itemId, count, source, META_IDLE),
      gearIncome: (gear, source) => ledgerGearIncome(gear, source, META_IDLE),
      exp: (skill, amount) => grantExp(skill, amount, false, { source: 'combat', meta: META_IDLE }),
      daoYun: (delta, source) => ledgerDaoYun(delta, source, META_IDLE),
    },
    combatSkill: () => combatSkill(),
    gearSeq: {
      next: () => state.gearSeq + 1,
      commit: (uid) => {
        state.gearSeq = uid;
      },
    },
    encounter: {
      prevOf: (enemyId) => state.lastEncounter[enemyId],
      record: (enemyId, rounds, won) => {
        state.lastEncounter[enemyId] = { rounds, won, at: time };
      },
    },
    dungeon: {
      current: () => state.dungeon,
      advance: advanceDungeonFloor,
      leave: leaveDungeon,
    },
    stopCombat: (note) => stopCombat(note),
    eatSilent: (itemId) => eatConsumable(itemId, true),
    findHealConsumable: () =>
      Object.keys(state.items).find((itemId) => {
        if (!((state.items[itemId] ?? 0) > 0)) return false;
        const item = findItem(content, itemId);
        return item?.type === 'consumable' && item.heal !== undefined;
      }),
  });

  /* ---------- 秘境（#7）：层序列战斗复用既有战斗状态机 ---------- */

  /* 战斗中的敌人解析（resolveEnemy）与召唤物投影（minionViewOf）随 #51
   * 内聚进 combatRun——秘境层倍率在前、Boss 阶段修正在后的单点组合，
   * 战斗推进与快照投影共用一份（禁第二份缩放组合）。 */

  /**
   * 进入指定层：low-hp 复查 → 加权抽敌 → 以层倍率投影的气血 → enterCombat
   * 单序列（战斗状态机与解算零分叉，#44）。层表空/敌人全缺失 = 'no-layer'
   * （防御路径，包校验已拦）。low-hp 复查先于抽敌（isLowHp 同一谓词，非第
   * 二份血线式）：拒绝路径不得有可观察副作用——先抽敌会烧一次 RNG（种子随
   * 档持久，ADR-013），被拒动作无声改变后续随机流，破坏同种子回放确定性。
   */
  function enterDungeonFloor(
    dungeon: DungeonView,
    floor: number,
    actionType?: string,
  ): 'ok' | 'no-layer' | 'low-hp' {
    if (isLowHp()) {
      if (actionType !== undefined) reject(actionType, 'low-hp');
      return 'low-hp';
    }
    const enemy = pickDungeonEnemyOf(content, dungeon, floor, random);
    if (!enemy) return 'no-layer';
    const scaled = dungeonFloorEnemyOf(content, dungeon.id, floor, enemy.id) ?? enemy;
    return enterCombat(scaled, actionType);
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
    if (enterDungeonFloor(dungeon, run.floor) !== 'ok') {
      // 层表空/敌人全缺失：防御离境（包校验已拦，引擎不崩；low-hp 为不可达
      // 复查位——combatRun.step 的退避判定先行担保，两支同样就地离境）。
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

  /* 玩家一击（集火选靶）/ 敌方一击 / victory / defeat / settleCombat 逐轮
   * 循环已随 #51 整体迁驻 combatRun.ts（CombatRun.step 窄门）——game.ts
   * 对战斗时序变量的直接引用就此清零（验收 1）。 */

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
        ledgerGold(def.reward.gold ?? 0, 'achievement', META_IDLE);
        ledgerDaoYun(def.reward.daoYun ?? 0, 'achievement', META_IDLE);
        for (const stack of def.reward.items ?? []) {
          // 物品须存在（包校验 xref 已保证；引擎对坏包防御：静默跳过不建孤儿键）。
          if (!findItem(content, stack.item)) continue;
          if (ledgerItem(stack.item, stack.count, 'achievement', META_IDLE)) {
            items[stack.item] = (items[stack.item] ?? 0) + stack.count;
          }
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
    // 与 tick 同律（Number.isFinite 门）：NaN/Infinity 不设防会沿 total→cycles
    // 污染 active.progress（活动永久卡死）与物品计数（NaN 落盘序列化为 null，
    // 恢复侧丢弃 = 物品凭空消失）。
    // 60s 最短结算门槛（旧版 game.js:430 同款，保真收口 #62）：关掉秒开不弹
    // "离线归来"、不触发休整回满（否则"打不过就切后台 5s"= 脱战+满血漏洞）。
    // 后台节流欠账 < 60s 不追亦同旧版语义（几十秒产出，玩家无感）。
    if (!Number.isFinite(elapsedMs) || elapsedMs < OFFLINE_MIN_MS) return;
    if (state.combat) {
      state.combat = null; // 离线不可战斗：视作离场休整
      combatRun.resetProcs(); // 系别临时态不落盘，离线离场即散（#15）
    }
    if (state.dungeon) state.dungeon = null; // 秘境不可离线续跑：就地离境（最高层已随进层登记，#7）
    // 休整回满血统一在此一次（战斗中离线时 activity 必为 null——开战已清采集，
    // 不回满则残血横穿整个离线期，与"气血按脱战回满"契约相悖）。
    state.hp = hpCap();
    // 离线上限（offlineCap 消费点，#6/#59）：基线 24h（BASE_OFFLINE_CAP_MS，
    // 恢复旧版原型丢失的 8h 上限语义，用户裁决 24h）+ Σflat 毫秒；超出上限
    // 的部分不入账（上限的语义本体）。真实离开时长在钳制前留档——事件双报
    //（awaySeconds=离开 / seconds=结算），钳制发生时壳层区分展示，防结算
    // 时长冒充离开时长误导（挂机 20h 只显示"离线 1 时"事故）。
    const cap = offlineCapOf(playerContributions());
    const awayMs = elapsedMs;
    const capped = cap > 0 && elapsedMs > cap;
    if (capped) elapsedMs = cap;
    const active = state.activity;
    if (!active) return;
    const skill = findSkill(content, active.skillId);
    if (!skill) {
      state.activity = null;
      return;
    }
    if (skill.kind === 'craft') {
      settleCraftOffline(active, skill, elapsedMs, {
        awaySeconds: Math.round(awayMs / 1000),
        capped,
      });
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

    if (cycles <= 0) return;
    const items: Record<string, number> = {};
    if (ledgerItem(activity.output.item, activity.output.count * cycles, 'gather', META_OFFLINE)) {
      items[activity.output.item] = activity.output.count * cycles;
    }

    if (activity.byproduct) {
      const expected = cycles * activity.byproduct.chance;
      const whole = Math.floor(expected);
      let bonus = whole;
      if (whole < cycles && random() < expected - whole) bonus += 1; // 余数无偏掷定
      if (bonus > 0) {
        if (ledgerItem(activity.byproduct.item, bonus, 'gather', META_OFFLINE)) {
          items[activity.byproduct.item] = bonus;
        }
      }
    }

    // 采集修为走 grantGatherExp 单点（每循环舍入口径，与在线逐轮对拍，
    // 二轮评审卡5）；xpMult 由 grantExp 单点消费——离线/在线语义对称。
    const before = levelFromXp(xpOf(skill.id));
    const expTotal = grantGatherExp(skill, activity, cycles, true, {
      source: 'gather',
      meta: META_OFFLINE,
    });
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
        awaySeconds: Math.round(awayMs / 1000),
        capped,
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
  function settleCraftOffline(
    active: ActivityState,
    skill: SkillView,
    elapsedMs: number,
    away: { awaySeconds: number; capped: boolean },
  ): void {
    const recipe = findRecipe(content, active.index);
    if (!recipe || recipe.skill !== skill.id) {
      state.activity = null;
      return;
    }
    const total = active.progress + elapsedMs;
    const cycles = Math.floor(total / recipe.interval);
    active.progress = total % recipe.interval;

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
      ledgerItem(matId, -(need * attempts), 'craft', META_OFFLINE);
    }

    const items: Record<string, number> = {};
    const item = findItem(content, recipe.output.item);
    if (item && successes > 0) {
      if (item.type !== 'equip') {
        if (ledgerItem(item.id, recipe.output.count * successes, 'craft', META_OFFLINE)) {
          items[item.id] = recipe.output.count * successes;
        }
      } else {
        const bias = levelOf(skill.id) * crparams.rarityBiasPerLevel;
        // 装备产出按 output.count 逐件掷定（与在线 grantCraftOutput 同语义）；
        // 走同一入账咽喉（在线/离线对称，#39 D6：此前离线装备无任何事件）。
        const instances = successes * recipe.output.count;
        let kept = 0;
        for (let i = 0; i < instances; i++) {
          state.gearSeq += 1;
          const gear = makeGear(content, item.id, item.bonuses ?? {}, state.gearSeq, random, {
            rarity: rollRarity(content, random, bias),
            affix: aparams,
          });
          if (ledgerGearIncome(gear, 'craft', META_OFFLINE)) kept += 1;
        }
        if (kept > 0) items[item.id] = kept;
      }
    }

    // 每循环舍入口径（与在线逐轮恒等对拍）：xpMult 与失败返还都在单轮粒度
    // round 后按轮数聚合（grantExpExact 收整批，防总额二次舍入分叉）。
    const xpMult = xpMultOf(playerContributions());
    const failPerRound = Math.round(recipe.exp * Math.max(0, crparams.failExpRefund));
    const expBase =
      successes * Math.round(recipe.exp * xpMult) + failures * Math.round(failPerRound * xpMult);
    const before = levelFromXp(xpOf(skill.id));
    // 事件载荷 = 实发值（离线/在线对称）。
    const expTotal = grantExpExact(skill, expBase, true, { source: 'craft', meta: META_OFFLINE });
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
        awaySeconds: away.awaySeconds,
        capped: away.capped,
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

  /* ---------- 快照视图投影（#40）：敌方/召唤物/逐活动间隔，壳层零公式复算 ---------- */

  /* 敌方投影（enemyProjection）与召唤物视图组（minionProjections）随 #51
   * 迁驻 combatRun（resolveEnemy/minionViewOf 内聚后的同一扇投影门）：
   * 浅拷语义不变——槽位态/视图脱离活状态与 content 引用，快照自持。 */

  /**
   * 全活动有效轮间隔映射：键 = `skillId:index`（壳层活动卡寻址同式）。
   * 采集按 gatherSpeed 缩放（与 settleActivity/settleOffline 同调
   * effectiveIntervalOf，禁第二份缩放式）；craft 动作是 recipes
   * （index = 包内下标），为配方原值（与 runningIntervalOf 旧口径一致）。
   */
  function activityIntervalsOf(): Record<string, number> {
    const speed = gatherSpeedOf(playerContributions());
    const out: Record<string, number> = {};
    for (const skill of skillsOf(content)) {
      if (skill.kind === 'craft') {
        recipesOf(content).forEach((recipe: RecipeView, index: number) => {
          if (recipe.skill === skill.id) out[`${skill.id}:${index}`] = recipe.interval;
        });
        continue;
      }
      (skill.activities ?? []).forEach((activity: ActivityView, index: number) => {
        out[`${skill.id}:${index}`] = effectiveIntervalOf(activity.interval, speed);
      });
    }
    return out;
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
        // 战斗中：不回血不采药，由战斗循环推进（#4 接管战斗语义；#51 起经
        // CombatRun.step 窄门驱动，战斗时序变量归 combatRun 所有）。
        combatRun.step(dt);
      } else {
        // 脱战回血。
        const cap = hpCap();
        if (state.hp > cap) {
          // 上限收缩压回（maxHp 修饰 buff 到期发生在属性投影读时，无伴随钳点；
          // regen 每 tick 必到，是自然的自愈位——否则超顶滞留至下次穿卸/重置）。
          state.hp = cap;
        } else if (state.hp < cap) {
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
          ledgerItem(itemId, -count, 'sell', META_USER);
          const gained = item.sell * count;
          ledgerGold(gained, 'sell', META_USER);
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
          ledgerGold(-cost, 'buy', META_USER);
          ledgerItem(itemId, count, 'buy', META_USER);
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
          // low-hp 退避 → 清活动 → 建战斗态 → 开战 note：入场单序列（#44）。
          enterCombat(enemy, action.type);
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

        case 'visit:begin':
        case 'visit:end': {
          // 访问段信号（#39 D9）：壳层交互页切进/切出时派发，引擎纯转发
          // EventBus 事件、不持段状态（段开闭与配对归壳层，段状态归 #33）。
          const payload = action.payload as { page?: unknown } | undefined;
          const page = payload?.page;
          if (typeof page !== 'string' || page.length === 0) {
            reject(action.type, 'bad-payload');
            return;
          }
          events.emit({ type: action.type, time, data: { page } });
          return;
        }

        case 'dungeon:enter': {
          // 秘境入门（#7）：定义 → 幂等/互斥 → 门控（道韵/钥匙，判定与 UI 同源
          // dungeonGateOf）→ 自第 1 层走 enterCombat 入场单序列（low-hp 退避/
          // 清活动/建战斗态/开战 note，#44）→ 进层即登记最高层 + dungeon:enter。
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
          const entered = enterDungeonFloor(dungeon, 1, action.type);
          if (entered !== 'ok') {
            // low-hp 已由序列代发 reject；层表空/敌人全缺失 = 防御路径
            // （包校验已拦，引擎不崩），此处补 no-layer 拒绝。
            if (entered === 'no-layer') reject(action.type, 'no-layer');
            return;
          }
          state.dungeon = { dungeonId: dungeon.id, floor: 1 };
          state.dungeonBest[dungeon.id] = Math.max(state.dungeonBest[dungeon.id] ?? 0, 1);
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
          ledgerGearRemoval(gear, 'sell', META_USER);
          ledgerGold(gained, 'sell', META_USER);
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
          // 熔炼产出公式单一来源（smeltYieldOf，与折叠路径同式）：无器屑经济
          // = not-available 零降级路径。
          const smelt = smeltYieldOf(gear.rarity);
          if (!smelt) {
            reject(action.type, 'not-available');
            return;
          }
          ledgerGearRemoval(gear, 'smelt', META_USER);
          ledgerItem(smelt.shardItem, smelt.shards, 'smelt', META_USER);
          events.emit({
            type: 'gear:smelt',
            time,
            data: {
              uid,
              item: smelt.shardItem,
              shards: smelt.shards,
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
          ledgerItem(gparams.shardItem, -cost, 'reforge', META_USER);
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
          ledgerDaoYun(preview.gain, 'rebirth', META_USER);
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
          ledgerDaoYun(-node.cost, 'talent', META_USER);
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
      return {
        version: 1,
        time,
        savedAt: clock.now(),
        state: cloneState(state) as unknown as Readonly<Record<string, unknown>>,
        // 属性面板（#4 验收：佩戴稀有度武器 → snapshot 反映倍率+词条）。
        stats: playerStats(),
        // 战斗/活动视图投影（#40 D1/D2：字段恒在，壳层零公式复算；一次取值
        // = 一帧完整视图，无独立 getter 的半新半旧帧问题）。展示投影非存档
        // 必需，恢复侧忽略。
        enemy: combatRun.enemyProjection(),
        minions: combatRun.minionProjections(),
        activityIntervals: activityIntervalsOf(),
      };
    },
  };
}
