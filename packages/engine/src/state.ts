/**
 * 状态树（issue #3）：skills（修为）/ items（乾坤袋）/ gp（灵石）
 * + 活动进度、气血、RNG 种子。
 *
 * ADR-013：未显式写入的字段不落盘——恢复时只按已知键规范化收编；
 * 未知顶层键透明透传（向后兼容未来节的存档）。
 */
import type { GameContent, SaveData } from './types.js';
import { findActivity, playerMaxHp, skillsOf } from './contentView.js';
import type { Contribution } from './modifiers.js';

export interface SkillProgress {
  xp: number;
}

export interface ActivityState {
  skillId: string;
  index: number;
  /** 存档时的活动名：恢复时校验下标指向的活动与其一致（ADR-015 稳定引用；活动 id 待 #16 引入）。 */
  name: string;
  /** 当前轮已推进的毫秒数（断点续采/离线结算的基准）。 */
  progress: number;
}

export interface GameState {
  /** 灵石。 */
  gp: number;
  /** 当前气血（上限由斗法修为推导，见 playerMaxHp，不落盘上限值）。 */
  hp: number;
  /** 乾坤袋：物品 id → 数量（不留 0 值键）。 */
  items: Record<string, number>;
  /** 修为：技能 id → 累计经验。 */
  skills: Record<string, SkillProgress>;
  /** 进行中的采集活动；null = 未修行。 */
  activity: ActivityState | null;
  /** PRNG 状态（确定性纪律：随机状态随档持久化）。 */
  rngSeed: number;
}

const RESERVED_KEYS = new Set(['gp', 'hp', 'items', 'skills', 'activity', 'rngSeed']);

export function initialState(
  content: GameContent,
  seed: number,
  contributions: readonly Contribution[] = [],
): GameState {
  const skills: Record<string, SkillProgress> = {};
  for (const skill of skillsOf(content)) {
    skills[skill.id] = { xp: 0 };
  }
  return {
    gp: 0,
    hp: playerMaxHp(content, skills, contributions),
    items: {},
    skills,
    activity: null,
    rngSeed: seed >>> 0,
  };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 从存档恢复状态：已知键逐项校验规范化，未知键透传保留。
 * 形状/内容引用无效的活动直接弃置（内容包已变更时防崩）。
 */
export function restoreState(
  content: GameContent,
  save: SaveData,
  fallbackSeed: number,
  contributions: readonly Contribution[] = [],
): GameState {
  const raw = save.state;
  const seed = isObj(raw) ? safeNumber(raw.rngSeed, fallbackSeed) >>> 0 : fallbackSeed >>> 0;
  const state = initialState(content, seed, contributions);

  // 透明收编未知顶层键（跳过原型污染键），已知键随后覆盖。
  if (isObj(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      (state as unknown as Record<string, unknown>)[key] = value;
    }
  }

  if (isObj(raw)) {
    state.gp = Math.max(0, Math.floor(safeNumber(raw.gp, 0)));
    const cap = playerMaxHp(content, state.skills, contributions);
    state.hp = Math.min(cap, Math.max(0, safeNumber(raw.hp, cap)));

    if (isObj(raw.items)) {
      for (const [id, count] of Object.entries(raw.items)) {
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
          state.items[id] = Math.floor(count);
        }
      }
    }

    if (isObj(raw.skills)) {
      for (const [id, progress] of Object.entries(raw.skills)) {
        // 只收编内容包已知技能；内容已移除的技能不入盘。
        if (!(id in state.skills) || !isObj(progress)) continue;
        const xp = progress.xp;
        if (typeof xp === 'number' && Number.isFinite(xp) && xp >= 0) {
          state.skills[id] = { xp };
        }
      }
    }

    const act = raw.activity;
    if (
      isObj(act) &&
      typeof act.skillId === 'string' &&
      typeof act.index === 'number' &&
      Number.isInteger(act.index) &&
      act.index >= 0 &&
      typeof act.name === 'string' &&
      typeof act.progress === 'number' &&
      Number.isFinite(act.progress) &&
      act.progress >= 0
    ) {
      // 稳定引用校验：下标指向的活动必须与存档记录同名，
      // 内容重排/改名时宁可弃置也不静默换目标（ADR-015）。
      const def = findActivity(content, act.skillId, act.index);
      if (def && def.activity.name === act.name) {
        state.activity = {
          skillId: act.skillId,
          index: act.index,
          name: act.name,
          progress: act.progress,
        };
      }
    }
  }

  return state;
}

/** 深拷贝状态树（snapshot 用；避免依赖 structuredClone 的 lib 约束）。 */
export function cloneState(state: GameState): GameState {
  const skills: Record<string, SkillProgress> = {};
  for (const [id, progress] of Object.entries(state.skills)) {
    skills[id] = { xp: progress.xp };
  }
  return {
    ...state,
    items: { ...state.items },
    skills,
    activity: state.activity ? { ...state.activity } : null,
  };
}
