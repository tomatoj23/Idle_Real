/**
 * 秘境分层爬塔（#7）。
 *
 * 引擎零内容感知：dungeons 节按约定形状读取（contentView/rebirth 同款
 * 安全兜底），缺节 = 该题材无秘境玩法（dungeonsOf 返回空表，消费点静默降级）。
 *
 * 归属划界（ADR-017：机制归引擎，参数归 content）：
 * - 机制归引擎：层序列战斗（胜利推进/败退离境）、层表解析、层敌人加权
 *   抽取、层倍率投影、进入门控判定、最高层记录（state.dungeonBest）；
 * - 参数归 content：秘境定义（floors/entry/layers）、敌人权重、层数倍率、
 *   层奖励（gold/daoYun/items）、推荐战力区间（软提示字段，引擎不消费）。
 *
 * 与转生联动（票面）：层奖励 daoYun 入账走 daoYun + daoYunEarned 双键
 * （与 rebirth 同律——花掉不回锁），深层秘境为兵解提供动力。
 *
 * 秘境攻略状态机（#52，架构二轮卡 7b）：进出/推进/层奖励入账住本模块
 * DungeonRun（createDungeonRun，#51 CombatRun 同款读取器装配）——
 * state.dungeon 的导航读写门，战斗接入与停战序列经窄门回调（#44 接缝）；
 * 离线/兵解的整态清置归 game.ts 生命周期（同 state.combat 先例）。
 */

import type { CombatEntryAction, GameContent, GameEvent } from './types.js';
import type { RejectFn } from './reject.js';
import type { DungeonState } from './state.js';
import { findEnemy, type EnemyView } from './contentView.js';
import { weightedPick } from './rng.js';

/* ---------- 内容视图（按形状读取，缺节/缺字段安全兜底） ---------- */

/** 层数段/推荐战力区间（min ≤ max，方向性由包校验保证）。 */
export interface DungeonFloorRangeView {
  readonly min: number;
  readonly max: number;
}

/** 层敌人权重行：enemy 引用包内 enemies 节（包校验 xref）。 */
export interface DungeonEnemyEntryView {
  readonly enemy: string;
  readonly weight: number;
}

/** 层奖励：通关该层时入账（每轮推塔重复可得——挂机长线消耗方）。 */
export interface DungeonRewardView {
  readonly gold?: number;
  readonly daoYun?: number;
  readonly items?: readonly { readonly item: string; readonly count: number }[];
}

/** 层数倍率：相对敌人定义值的缩放（缺省字段 = 原值）。 */
export interface DungeonMultView {
  readonly hp?: number;
  readonly atk?: number;
  readonly def?: number;
  readonly gold?: number;
  readonly exp?: number;
}

/** 层表行：层数段 + 敌人权重池 + 倍率 + 层奖励 + 推荐战力（软提示）。 */
export interface DungeonLayerView {
  readonly floor: DungeonFloorRangeView;
  readonly enemies: readonly DungeonEnemyEntryView[];
  readonly mult?: DungeonMultView;
  readonly rewards?: DungeonRewardView;
  readonly recommendedPower?: DungeonFloorRangeView;
}

/** 进入条件（皆可选，缺省 = 自由进入）：道韵门槛（按累计道韵）/ 钥匙道具（须持有）。 */
export interface DungeonEntryView {
  readonly daoYun?: number;
  readonly key?: string;
}

/** 秘境定义（content 包 dungeons 节条目）。 */
export interface DungeonView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  /** 总层数：攻略生命周期（层表须覆盖 1..floors，包校验强制）。 */
  readonly floors: number;
  readonly entry?: DungeonEntryView;
  readonly layers: readonly DungeonLayerView[];
}

/** 秘境列表：缺节/形状非法 → 空表（安全兜底，绝不因内容缺失崩溃）。 */
export function dungeonsOf(content: GameContent): readonly DungeonView[] {
  const dungeons = (content as { dungeons?: unknown }).dungeons;
  return Array.isArray(dungeons) ? (dungeons as DungeonView[]) : [];
}

/** 按秘境 id 取定义；未注册（坏引用/包变更）返回 undefined。 */
export function findDungeon(content: GameContent, dungeonId: string): DungeonView | undefined {
  return dungeonsOf(content).find((dungeon) => dungeon.id === dungeonId);
}

/**
 * 层表解析：返回 floor 命中的第一行（min ≤ floor ≤ max）。
 * 覆盖完整性由包校验把关；运行时未命中（防御路径）返回 undefined。
 */
export function dungeonLayerOf(dungeon: DungeonView, floor: number): DungeonLayerView | undefined {
  for (const layer of dungeon.layers ?? []) {
    const { min, max } = layer?.floor ?? {};
    if (typeof min === 'number' && typeof max === 'number' && floor >= min && floor <= max) {
      return layer;
    }
  }
  return undefined;
}

/**
 * 层数倍率投影（引擎单一来源，战斗结算与 UI 展示同调，禁壳内复制缩放式）：
 * 层表 mult 逐字段投影到敌人定义（round 取整，hp/atk 下限 1）；未声明字段
 * = 原值。返回新视图，不污染内容包；秘境/敌人未注册（防御路径）返回 undefined。
 */
export function dungeonFloorEnemyOf(
  content: GameContent,
  dungeonId: string,
  floor: number,
  enemyId: string,
): EnemyView | undefined {
  const dungeon = findDungeon(content, dungeonId);
  const base = findEnemy(content, enemyId);
  if (!dungeon || !base) return undefined;
  const mult = dungeonLayerOf(dungeon, floor)?.mult ?? {};
  const apply = (value: number, m: number | undefined, min: number): number =>
    m !== undefined && Number.isFinite(m) && m > 0 ? Math.max(min, Math.round(value * m)) : value;
  return {
    ...base,
    hp: apply(base.hp, mult.hp, 1),
    atk: apply(base.atk, mult.atk, 1),
    def: apply(base.def, mult.def, 0),
    gold: base.gold
      ? { min: apply(base.gold.min, mult.gold, 0), max: apply(base.gold.max, mult.gold, 0) }
      : base.gold,
    exp: apply(base.exp, mult.exp, 0),
  };
}

/**
 * 层敌人加权抽取（随机一律走注入 RNG，ADR-013）：权重行按占比归一化掷点
 * （weightedPick 单一来源，#30 召唤抽签同式）；权重全非法/敌人全缺失
 * → undefined（调用方安全离境，绝不抛错）。
 */
export function pickDungeonEnemyOf(
  content: GameContent,
  dungeon: DungeonView,
  floor: number,
  random: () => number,
): EnemyView | undefined {
  const layer = dungeonLayerOf(dungeon, floor);
  const pool: Array<{ enemy: EnemyView; weight: number }> = [];
  for (const entry of layer?.enemies ?? []) {
    const enemy = findEnemy(content, entry?.enemy ?? '');
    if (enemy) pool.push({ enemy, weight: entry.weight });
  }
  return weightedPick(pool, (row) => row.weight, random)?.enemy;
}

/* ---------- 数值守卫与进入门控（判定侧单一来源，N1/N4 收敛先例） ---------- */

/**
 * 数值奖励守卫（#52 D2 单一来源）：content 声明的数值须为有限且严格大于
 * min 的 number 才算数，否则 undefined（调用方按语义回落 0 / 拒绝）。守卫
 * 语义差异以 min 显式参数呈现（奖励额/门槛类 min=0），禁再手写同款比较链
 * ——层奖励入账三路（gold/items/daoYun）与 dungeonGateOf 门槛共用此一处。
 */
export function finiteAbove(value: unknown, min: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > min ? value : undefined;
}

/** 进入门控视图：锁定判定与展示所需门槛（与引擎 dungeon:enter 判定同源）。 */
export interface DungeonGateView {
  /** 累计道韵不足或钥匙未持 → 锁定（引擎 dungeon:enter 拒绝同一判定）。 */
  readonly locked: boolean;
  /** 锁因归一（#7 评审收敛）：true = 道韵维度未过（locked 文案槽 {daoYun}）；false 且 locked = 钥匙维度（no-key 文案槽 {item}）。 */
  readonly daoYunLocked: boolean;
  /** 展示用最低累计道韵（entry.daoYun；未登记 = 0）。 */
  readonly requiredDaoYun: number;
  /** 钥匙道具 id（entry.key；未登记 = undefined）。 */
  readonly keyItem?: string;
  /** 钥匙持有判定（未登记钥匙 = true）。 */
  readonly keyOwned: boolean;
}

/**
 * 秘境进入门控（引擎单一来源）：UI 锁定态展示一律调此函数，禁另写比较式
 * （enemyGateOf/rebirthGateOf 同款收敛）。秘境未注册按锁定兜底（渲染防御
 * 路径，与 dispatch 侧 not-found 兜底语义一致）。
 */
export function dungeonGateOf(
  content: GameContent,
  dungeonId: string,
  ctx: { readonly daoYunEarned: number; readonly items: Readonly<Record<string, number>> },
): DungeonGateView {
  const dungeon = findDungeon(content, dungeonId);
  if (!dungeon) {
    return { locked: true, daoYunLocked: false, requiredDaoYun: 0, keyOwned: false };
  }
  const rawDaoYun = dungeon.entry?.daoYun;
  const requiredDaoYun = finiteAbove(rawDaoYun, 0) ?? 0;
  const rawKey = dungeon.entry?.key;
  const keyItem = typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : undefined;
  const keyOwned = keyItem === undefined || (ctx.items[keyItem] ?? 0) >= 1;
  const daoYunLocked = ctx.daoYunEarned < requiredDaoYun;
  return {
    locked: daoYunLocked || !keyOwned,
    daoYunLocked,
    requiredDaoYun,
    ...(keyItem !== undefined ? { keyItem } : {}),
    keyOwned,
  };
}

/* ---------- DungeonRun（#52，架构二轮卡 7b）：秘境攻略状态机的拥有者 ---------- */

/**
 * DungeonRun 依赖面（#51 CombatRun 同款读取器集合）：闭包变量全部显式注入。
 * 战斗接入与停战序列是窄门回调（enterCombat 单序列 / stopCombat 住 game.ts，
 * #44 接缝）；入账走咽喉窄面（层奖励三路的 'dungeon' 来源绑定在装配侧）；
 * 攻略指针与最高层记录经存取句柄读写（GameState 持久形状零变化，D3）。
 */
export interface DungeonRunDeps {
  /** 内容包（秘境定义/层表/敌人池读取）。 */
  readonly content: GameContent;
  /** 注入随机源（ADR-013：层抽敌掷点走此源）。 */
  readonly random: () => number;
  /** 游戏内时间（毫秒）：事件戳。 */
  readonly now: () => number;
  /** 事件出口（dungeon:enter/leave/clear/floor 由本模块组完整 payload）。 */
  readonly emit: (event: GameEvent) => void;
  /** 系统 note 文案读取器（顶层通关 note；池缺失回显键，#019）。 */
  readonly note: (key: string, vars?: Readonly<Record<string, string>>) => string;
  /** 拒绝事件出口（enterFloor low-hp 复查代发；文案与 dispatch 面同源，#75 项 4 逐动作编译收口）。 */
  readonly reject: RejectFn;
  /** low-hp 血线读取器（与入场门控同一条线，#44 isLowHp 单一谓词）。 */
  readonly lowHp: () => boolean;
  /** 开战单序列窄门（enterCombat：low-hp 复查/清活动/建战斗态/开战 note）。 */
  readonly beginCombat: (enemy: EnemyView, actionType?: CombatEntryAction) => 'ok' | 'low-hp';
  /** 停战序列窄门（顶层通关/防御离境：撤退 note + 清战斗态 + 离境）。 */
  readonly stopCombat: (note?: string) => void;
  /** 攻略指针存取句柄：GameState.dungeon 的导航读写门（离线/兵解整态清置
   * 除外，归 game.ts 生命周期——同 state.combat 先例）。 */
  readonly run: {
    get(): DungeonState | null;
    set(next: DungeonState | null): void;
  };
  /** 最高层记录（GameState.dungeonBest，记录资产）：进层即登记，离境/兵解不清。 */
  readonly best: {
    of(dungeonId: string): number;
    /** 登记到达层；实现侧保底 max（只升不降），调用方传原始层号。 */
    record(dungeonId: string, floor: number): void;
  };
  /** 入账咽喉窄面（#39）：层奖励三路，credit sink 参数化（D1）。 */
  readonly credit: {
    gold(delta: number): void;
    /** 物品入袋（折叠挂点在内）；返回是否实际入袋（载荷记实入袋口径）。 */
    item(itemId: string, count: number): boolean;
    daoYun(delta: number): void;
  };
}

/** DungeonRun 对外窄门：攻略导航（进出/推进）+ 层奖励胜利入账单一门 + 指针读。 */
export interface DungeonRun {
  /** 当前攻略（无 = null）：combatRun 敌投影/掉落筛层与停战序消费。 */
  current(): DungeonState | null;
  /** 开攻略（dispatch 门控放行后消费）：登记攻略 + 最高层 + dungeon:enter。 */
  begin(dungeon: DungeonView): void;
  /**
   * 进入指定层：low-hp 复查（先于抽敌——先抽敌会烧一次 RNG，被拒动作不得
   * 无声改变后续随机流，ADR-013）→ 加权抽敌 → 层倍率投影 → 开战单序列。
   * 层表空/敌人全缺失 = 'no-layer'（防御路径，包校验已拦）。
   */
  enterFloor(dungeon: DungeonView, floor: number, actionType?: CombatEntryAction): 'ok' | 'no-layer' | 'low-hp';
  /** 离境（幂等）：清攻略 + dungeon:leave 事件（最高层已随进层实时登记）。 */
  leave(): void;
  /**
   * 层推进（胜利休整到期消费，#7）：顶层已清 → 通关离境；否则层号 +1、
   * 登记最高层、抽敌开战下一层。层奖励已在 victory 入账（creditFloorRewards），
   * 此处只决定去留；层表空/敌人全缺失 = 防御离境（绝不抛错卡死）。
   */
  advance(): void;
  /**
   * 胜利入账单一门（D1）——「通关一层给什么」在本模块一处可读：层表 rewards
   * 逐项过 finite 守卫（finiteAbove 单一来源，D2）入账 + dungeon:floor 事件；
   * 无攻略 = no-op。道韵双键同律（daoYunEarned 只增不减——花掉不回锁，深层
   * 秘境供养兵解）；credit.item 拒收（坏引用/折叠）不入 items 载荷。
   */
  creditFloorRewards(): void;
}

/** DungeonRun 工厂：闭包持有 deps，返回窄门（CombatRun 同款装配形态）。 */
export function createDungeonRun(deps: DungeonRunDeps): DungeonRun {
  const { content, random, now, emit } = deps;

  /** 秘境展示名（未注册回显 id，防御路径；离境/层奖励两处共用）。 */
  const dungeonNameOf = (dungeonId: string): string =>
    findDungeon(content, dungeonId)?.name ?? dungeonId;

  function enterFloor(
    dungeon: DungeonView,
    floor: number,
    actionType?: CombatEntryAction,
  ): 'ok' | 'no-layer' | 'low-hp' {
    if (deps.lowHp()) {
      if (actionType !== undefined) deps.reject(actionType, 'low-hp');
      return 'low-hp';
    }
    const enemy = pickDungeonEnemyOf(content, dungeon, floor, random);
    if (!enemy) return 'no-layer';
    const scaled = dungeonFloorEnemyOf(content, dungeon.id, floor, enemy.id) ?? enemy;
    return deps.beginCombat(scaled, actionType);
  }

  function current(): DungeonState | null {
    return deps.run.get();
  }

  function begin(dungeon: DungeonView): void {
    deps.run.set({ dungeonId: dungeon.id, floor: 1 });
    deps.best.record(dungeon.id, 1);
    emit({
      type: 'dungeon:enter',
      time: now(),
      data: { dungeonId: dungeon.id, dungeonName: dungeon.name, floor: 1, floors: dungeon.floors },
    });
  }

  function leave(): void {
    const run = deps.run.get();
    if (!run) return;
    deps.run.set(null);
    emit({
      type: 'dungeon:leave',
      time: now(),
      data: {
        dungeonId: run.dungeonId,
        dungeonName: dungeonNameOf(run.dungeonId),
        floor: run.floor,
        best: Math.max(deps.best.of(run.dungeonId), run.floor),
      },
    });
  }

  function advance(): void {
    const run = deps.run.get();
    if (!run) return;
    const dungeon = findDungeon(content, run.dungeonId);
    if (!dungeon) {
      deps.run.set(null); // 内容包已变更：安全弃置
      return;
    }
    if (run.floor >= dungeon.floors) {
      deps.run.set(null);
      emit({
        type: 'dungeon:clear',
        time: now(),
        data: { dungeonId: dungeon.id, dungeonName: dungeon.name, floors: dungeon.floors },
      });
      deps.stopCombat(deps.note('retreatVictory'));
      return;
    }
    const nextFloor = run.floor + 1;
    deps.run.set({ dungeonId: run.dungeonId, floor: nextFloor });
    deps.best.record(run.dungeonId, nextFloor);
    if (enterFloor(dungeon, nextFloor) !== 'ok') {
      // 层表空/敌人全缺失：防御离境（包校验已拦，引擎不崩；low-hp 为不可达
      // 复查位——combatRun.step 的退避判定先行担保，两支同样就地离境）。
      deps.run.set(null);
      deps.stopCombat();
    }
  }

  function creditFloorRewards(): void {
    const loc = deps.run.get();
    if (!loc) return;
    const dungeon = findDungeon(content, loc.dungeonId);
    const rewards = dungeon ? dungeonLayerOf(dungeon, loc.floor)?.rewards : undefined;
    const goldReward = Math.floor(finiteAbove(rewards?.gold, 0) ?? 0);
    deps.credit.gold(goldReward);
    const items: Record<string, number> = {};
    for (const stack of rewards?.items ?? []) {
      const count = finiteAbove(stack?.count, 0);
      if (typeof stack?.item === 'string' && count !== undefined) {
        if (deps.credit.item(stack.item, Math.floor(count))) {
          items[stack.item] = (items[stack.item] ?? 0) + Math.floor(count);
        }
      }
    }
    const daoYunReward = Math.floor(finiteAbove(rewards?.daoYun, 0) ?? 0);
    deps.credit.daoYun(daoYunReward);
    emit({
      type: 'dungeon:floor',
      time: now(),
      data: {
        dungeonId: loc.dungeonId,
        dungeonName: dungeonNameOf(loc.dungeonId),
        floor: loc.floor,
        floors: dungeon?.floors ?? 0,
        gold: goldReward,
        daoYun: daoYunReward,
        items,
      },
    });
  }

  return { current, begin, enterFloor, leave, advance, creditFloorRewards };
}
