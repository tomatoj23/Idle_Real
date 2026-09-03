/**
 * 回合战斗机制（issue #4）。
 *
 * 纯机制层：伤害公式 / 伤害档 / 词库抽取 / 战斗摘要（词库文本属内容包，
 * ADR-016 批 2 / 票 #019 收编；本文件内置的中文模板与兜底句属待清偿违规），
 * 不触碰游戏状态（状态机与事件在 game.ts）。随机一律走注入的 RNG
 * （ADR-013 三禁），时间常量用毫秒。
 *
 * 文案体系沿用旧版 CTEXT 语义（借鉴 SexyMUD ADR-0011）：
 * 出招句 + 受击者主语后果句独立成句，「」招式名，伤害档分池，
 * 致命一击门控（剩余生命=危 且 伤害=重/濒死）。
 * 引擎零内容感知：词库按内容包约定形状读取，缺节/非法一律安全兜底
 * （types.ts 战斗兜底约定：未注册招式回退拳脚）。
 */

/* ---------- 数值基线（旧版 data.js/game.js 沿革） ---------- */

/** 玩家攻击间隔（旧版 2.2s）。 */
export const PLAYER_ATTACK_INTERVAL = 2200;

/** 减伤常数：伤害 ×(1 − def/(def+K))。 */
export const DEFENSE_K = 120;

/** 伤害波动幅度（±10%）。 */
export const DAMAGE_VARIANCE = 0.1;

/** 暴击倍率。 */
export const CRIT_MULTIPLIER = 1.6;

/** 暴击率上限（百分点）。 */
export const CRIT_CAP = 75;

/** 危血线：剩余生命 ≤ 15% 视为「危」（致命一击门控）。 */
export const CRITICAL_HP_FRACTION = 0.15;

/** 开战气血门控与败北回血线（30%）。 */
export const LOW_HP_FRACTION = 0.3;

/** 自动嗑丹血线（50%）。 */
export const AUTO_EAT_HP_FRACTION = 0.5;

/** 胜利后休整（再战间隔）。 */
export const VICTORY_REST_MS = 1500;

/* ---------- 伤害解算 ---------- */

/** 一次伤害掷点：atk ×(0.9~1.1) ×减伤，下限 1。 */
export function calcDmg(atk: number, def: number, random: () => number): number {
  const variance = 1 - DAMAGE_VARIANCE + random() * DAMAGE_VARIANCE * 2;
  const mitigation = 1 - def / (def + DEFENSE_K);
  return Math.max(1, Math.round(atk * variance * mitigation));
}

/** 暴击 roll（critChancePct 百分点）。 */
export function rollCrit(critChancePct: number, random: () => number): boolean {
  return random() * 100 < critChancePct;
}

export type DamageTier = 'light' | 'mid' | 'heavy' | 'deadly';

/** 伤害档：相对期望伤害（已计防御减免）。 */
export function hitTierOf(dmg: number, atk: number, def: number): DamageTier {
  const expected = Math.max(1, atk * (1 - def / (def + DEFENSE_K)));
  const r = dmg / expected;
  return r < 0.95 ? 'light' : r < 1.05 ? 'mid' : r < 1.5 ? 'heavy' : 'deadly';
}

/** 剩余生命档（仅致命一击门控使用）。 */
export function isCriticalHp(hp: number, max: number): boolean {
  return max > 0 && hp / max <= CRITICAL_HP_FRACTION;
}

/* ---------- 通用词库抽取器 ---------- */

/**
 * 通用「过滤后随机抽取」：池非法（非数组/空/含非字符串）时过滤剔除，
 * 剔完为空返回 undefined，调用方自行兜底。所有词库抽取共用此入口。
 */
export function pickText(pool: unknown, random: () => number): string | undefined {
  if (!Array.isArray(pool)) return undefined;
  const valid = pool.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (valid.length === 0) return undefined;
  return valid[Math.floor(random() * valid.length) % valid.length];
}

/* ---------- 战斗文案 ---------- */

/** 战斗词库的透明视图（content.combatText 按形状读取）。 */
export interface CombatTextPools {
  readonly verbs?: unknown;
  readonly moves?: unknown;
  readonly openings?: unknown;
  readonly critIntro?: unknown;
  readonly cons?: unknown;
  readonly fatal?: unknown;
}

/** 文案生成入参：双方身份、数值与随机源。 */
export interface AttackTextArgs {
  /** 出招侧：玩家 / 敌人。 */
  readonly side: 'player' | 'enemy';
  /** 敌方名（玩家出招时的受击者 / 敌方出招时的主语）。 */
  readonly enemyName: string;
  /** 招式注册键：武器物品 id / 敌人 id / 'fist'。未注册回退 fist。 */
  readonly moveKey: string;
  /** 动词池键：sword/fist/claw/magic。未注册回退 fist。 */
  readonly verbStyle: string;
  /** 兵器展示名（玩家无武器为「拳脚」）。 */
  readonly weaponName: string;
  readonly dmg: number;
  readonly crit: boolean;
  /** 攻击者攻击力（伤害档基准）。 */
  readonly atk: number;
  /** 受击者防御。 */
  readonly defenderDef: number;
  /** 受击后剩余生命 / 上限。 */
  readonly defenderHp: number;
  readonly defenderMaxHp: number;
}

interface VerbLike {
  readonly v: unknown;
  readonly limbs: unknown;
}

function pickVerb(pools: CombatTextPools, style: string, random: () => number): { verb: string; limb: string } {
  const verbs = pools.verbs as Record<string, readonly VerbLike[]> | undefined;
  const list = verbs && typeof verbs === 'object' ? verbs[style] : undefined;
  const fallbackList = verbs && typeof verbs === 'object' ? verbs['fist'] : undefined;
  const entry = pickVerbEntry(list, random) ?? pickVerbEntry(fallbackList, random);
  if (entry) return entry;
  return { verb: '击', limb: '要害' }; // 词库全缺的最简兜底
}

function pickVerbEntry(list: unknown, random: () => number): { verb: string; limb: string } | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const entry = list[Math.floor(random() * list.length) % list.length] as VerbLike | undefined;
  if (!entry || typeof entry !== 'object') return undefined;
  const limb = pickText(entry.limbs, random);
  if (typeof entry.v !== 'string' || !limb) return undefined;
  return { verb: entry.v, limb };
}

/** 招式名抽取：moves[moveKey] 未注册回退 moves.fist（安全兜底约定）。 */
export function extractMoveName(pools: CombatTextPools, moveKey: string, random: () => number): string {
  const moves = pools.moves as Record<string, unknown> | undefined;
  const pool = moves && typeof moves === 'object' ? (moves[moveKey] ?? moves['fist']) : undefined;
  return pickText(pool, random) ?? '搏兔一击';
}

function tierText(pools: CombatTextPools, side: 'player' | 'enemy', tier: DamageTier, random: () => number): string | undefined {
  const cons = pools.cons as { hit?: unknown; hurt?: unknown } | undefined;
  if (!cons || typeof cons !== 'object') return undefined;
  const group = side === 'player' ? cons.hit : cons.hurt;
  const byTier = group && typeof group === 'object' ? (group as Record<string, unknown>)[tier] : undefined;
  return pickText(byTier, random);
}

function fatalText(pools: CombatTextPools, side: 'player' | 'enemy'): string | undefined {
  const fatal = pools.fatal as Record<string, unknown> | undefined;
  if (!fatal || typeof fatal !== 'object') return undefined;
  const text = fatal[side === 'player' ? 'hit' : 'hurt'];
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}

/**
 * 生成一次出招的完整文案：出招句 + 受击者主语后果句。
 * 门控：受击者残血（≤15%）且重/濒死 → fatal 专属词库（致命一击）。
 */
export function makeAttackText(
  pools: CombatTextPools,
  args: AttackTextArgs,
  random: () => number,
): string {
  const tier = hitTierOf(args.dmg, args.atk, args.defenderDef);
  const { verb, limb } = pickVerb(pools, args.verbStyle, random);
  const move = extractMoveName(pools, args.moveKey, random);

  let line: string;
  if (args.side === 'player') {
    if (tier === 'deadly' || args.crit) {
      line = `${pickText(pools.critIntro, random) ?? '你气机鼓荡'}——「${move}」倏然施出，${args.weaponName}${verb}向${args.enemyName}的${limb}！`;
    } else if (tier === 'heavy') {
      line = `${pickText(pools.openings, random) ?? '你灵机鼓荡'}——一招「${move}」，${args.weaponName}${verb}向${args.enemyName}的${limb}。`;
    } else {
      line = `你一招「${move}」，${args.weaponName}${verb}向${args.enemyName}的${limb}。`;
    }
  } else {
    line =
      tier === 'heavy' || tier === 'deadly'
        ? `${args.enemyName}凶性大发——「${move}」猛然施出，${verb}向你的${limb}！`
        : `${args.enemyName}一式「${move}」，${verb}向你的${limb}。`;
  }

  const critical = isCriticalHp(args.defenderHp, args.defenderMaxHp);
  const fatalGated = critical && (tier === 'heavy' || tier === 'deadly');
  const fatal = fatalGated ? fatalText(pools, args.side) : undefined;
  if (fatal !== undefined) {
    return line + fatal.replaceAll('{defender}', args.enemyName).replaceAll('{d}', String(args.dmg));
  }
  const cons = tierText(pools, args.side, tier, random);
  const fallback = args.side === 'player' ? '{defender}受创{d}点。' : '你受创{d}点。';
  return line + (cons ?? fallback).replaceAll('{defender}', args.enemyName).replaceAll('{d}', String(args.dmg));
}

/* ---------- 战斗摘要与同对手对照（调研合入 2026-09-02） ---------- */

/** 一场战斗的玩家伤害构成累计（战斗状态随档保存，中断可续）。 */
export interface RoundTally {
  rounds: number;
  crits: number;
  tiers: Readonly<Record<DamageTier, number>>;
}

export const emptyTally = (): RoundTally => ({ rounds: 0, crits: 0, tiers: { light: 0, mid: 0, heavy: 0, deadly: 0 } });

const TIER_FLAVOR: Readonly<Record<DamageTier, string>> = {
  light: '招式绵密，轻痕积胜',
  mid: '招招见血，稳中求进',
  heavy: '大开大合，重创连绵',
  deadly: '招招奔要害，锋芒毕露',
};

/**
 * 战后一行签名画像：由伤害构成（主导伤害档 + 会心数）产生，非纯数值统计。
 */
export function summarizeRounds(tally: RoundTally): string {
  const { tiers } = tally;
  let dominant: DamageTier = 'light';
  for (const tier of ['mid', 'heavy', 'deadly'] as const) {
    if (tiers[tier] > tiers[dominant]) dominant = tier;
  }
  const critPart = tally.crits > 0 ? ` · ${tally.crits} 次会心` : '';
  return `${tally.rounds} 合击倒 · ${TIER_FLAVOR[dominant]}${critPart}`;
}

/** 同对手上一战记录（lastEncounter 值形状）。 */
export interface EncounterRecord {
  /** 玩家出招合数。 */
  readonly rounds: number;
  readonly won: boolean;
  /** 战斗结束时的游戏内时间（毫秒）。 */
  readonly at: number;
}

/** 对照语：同对手再战的回合数/胜负对照；无从对照返回 undefined。 */
export function compareEncounterText(prev: EncounterRecord | undefined, rounds: number): string | undefined {
  if (!prev || typeof prev.rounds !== 'number' || prev.rounds <= 0) return undefined;
  if (!prev.won) return `前番不敌，今 ${rounds} 合雪耻`;
  if (rounds < prev.rounds) return `前番苦战 ${prev.rounds} 合，今 ${rounds} 合击倒`;
  if (rounds > prev.rounds) return `今番 ${rounds} 合方克，比前番 ${prev.rounds} 合多费周章`;
  return `与前番 ${rounds} 合如出一辙`;
}
