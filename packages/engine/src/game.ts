import { EventBus } from './events.js';
import { realClock } from './clock.js';
import { createRng } from './rng.js';
import {
  HP_REGEN_FRACTION_PER_SEC,
  MAX_LEVEL,
  levelFromXp,
} from './progression.js';
import {
  findActivity,
  findItem,
  findShopEntry,
  playerMaxHp,
  type ActivityView,
  type SkillView,
} from './contentView.js';
import {
  cloneState,
  initialState,
  restoreState,
  type GameState,
} from './state.js';
import type { Clock, GameAction, GameContent, SaveData } from './types.js';

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

  const state: GameState = options.save
    ? restoreState(content, options.save, options.seed ?? 1)
    : initialState(content, options.seed ?? 1);
  let time = options.save?.time ?? 0;

  const injectedRng = options.rng;
  let rng = createRng(state.rngSeed);
  const random = (): number => {
    if (injectedRng) return injectedRng();
    const value = rng.next();
    state.rngSeed = rng.state(); // 随机状态随档持久化（ADR-013）
    return value;
  };

  const hpCap = (): number => playerMaxHp(content, state.skills);
  const xpOf = (skillId: string): number => state.skills[skillId]?.xp ?? 0;
  const levelOf = (skillId: string): number => levelFromXp(xpOf(skillId));

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
    const before = levelFromXp(xpOf(skill.id));
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
    const after = levelFromXp(entry.xp);
    if (after > before && before < MAX_LEVEL) {
      if (!quiet) {
        events.emit({
          type: 'levelup',
          time,
          data: { skillId: skill.id, skillName: skill.name, level: Math.min(after, MAX_LEVEL) },
        });
      }
    }
  }

  function reject(actionType: string, reason: string, message: string): void {
    events.emit({ type: 'reject', time, data: { action: actionType, reason, message } });
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

  /** 单轮采集完成：产出 → 副产出（掷点）→ 修为。 */
  function completeActivityOnce(skill: SkillView, activity: ActivityView): void {
    addItem(activity.output.item, activity.output.count);
    emitLoot(activity.output.item, activity.output.count, 'activity');
    if (activity.byproduct && random() < activity.byproduct.chance) {
      addItem(activity.byproduct.item, 1);
      emitLoot(activity.byproduct.item, 1, 'byproduct');
    }
    grantExp(skill, activity.exp, false);
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

  /**
   * 离线补偿结算（ADR-013 观察时补偿）：O(1) 算清欠账——
   * 完整轮次产出直接累加；副产出用 floor(期望) + 余数伯努利一次掷定，
   * 不逐轮回放。气血按脱战回满。只产出一条 offline-settled 汇总事件。
   */
  function settleOffline(elapsedMs: number): void {
    const active = state.activity;
    if (!active || elapsedMs <= 0) return;
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
        ? [{ skillId: skill.id, skillName: skill.name, level: Math.min(after, MAX_LEVEL) }]
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
      // 脱战回血（本切片恒脱战；#4 战斗票接管"战斗中不回血"语义）。
      const cap = hpCap();
      if (state.hp < cap) {
        state.hp = Math.min(cap, state.hp + cap * HP_REGEN_FRACTION_PER_SEC * (dt / 1000));
      }
      settleActivity(dt);
      events.emit({ type: 'tick', time, data: { dt } });
    },

    dispatch(action: GameAction): void {
      switch (action.type) {
        case 'activity:start': {
          const payload = action.payload as { skillId?: unknown; index?: unknown } | undefined;
          if (
            !payload ||
            typeof payload.skillId !== 'string' ||
            typeof payload.index !== 'number' ||
            !Number.isInteger(payload.index) ||
            payload.index < 0
          ) {
            reject(action.type, 'bad-payload', '指令无效');
            return;
          }
          const found = findActivity(content, payload.skillId, payload.index);
          if (!found) {
            reject(action.type, 'not-found', '查无此法');
            return;
          }
          if (levelOf(found.skill.id) < found.activity.unlockLevel) {
            reject(
              action.type,
              'level',
              `修为不足，需 ${found.activity.unlockLevel} 层方可「${found.activity.name}」`,
            );
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
            reject(action.type, 'bad-payload', '指令无效');
            return;
          }
          const { itemId, count } = parsed;
          const item = findItem(content, itemId);
          if (!item) {
            reject(action.type, 'not-found', '查无此物');
            return;
          }
          const owned = state.items[itemId] ?? 0;
          if (count > owned) {
            reject(action.type, 'no-item', `乾坤袋中「${item.name}」不足（仅有 ${owned} 件）`);
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
            reject(action.type, 'bad-payload', '指令无效');
            return;
          }
          const { itemId, count } = parsed;
          const entry = findShopEntry(content, itemId);
          if (!entry) {
            reject(action.type, 'not-in-shop', '坊市未售此物');
            return;
          }
          const item = findItem(content, itemId);
          const cost = entry.price * count;
          if (state.gp < cost) {
            reject(action.type, 'no-gold', `灵石不足（需 ${cost}，现有 ${state.gp}）`);
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

        default:
          reject(action.type, 'unknown-action', '未知指令');
      }
    },

    snapshot(): SaveData {
      // GameState 无索引签名，与 GameContent 同理放宽为透明 Record（#2 先例）。
      return {
        version: 1,
        time,
        savedAt: clock.now(),
        state: cloneState(state) as unknown as Readonly<Record<string, unknown>>,
      };
    },
  };
}
