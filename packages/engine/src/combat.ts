/**
 * 回合战斗机制（issue #4；#019 批 2 文案收编后零内置文案）。
 *
 * 纯机制层：伤害公式 / 伤害档 / 词库抽取 / 战斗摘要。文案词库全部来自
 * 内容包（combatText 十键：词库 + 句式模板 + 系统 note + 战后摘要 +
 * 对照语，ADR-016 / 票 #019），不触碰游戏状态（状态机与事件在 game.ts）。
 * 随机一律走注入的 RNG（ADR-013 三禁），时间常量用毫秒。
 *
 * 文案体系沿用旧版 CTEXT 语义（借鉴 SexyMUD ADR-0011）：
 * 出招句 + 受击者主语后果句独立成句，「」招式名，伤害档分池，
 * 致命一击门控（剩余生命=危 且 伤害=重/濒死）。
 * 引擎零内容感知：词库按内容包约定形状读取，缺节/非法一律安全兜底
 * （types.ts 战斗兜底约定：未注册招式回退拳脚）。兜底值一律**非文案占位**
 * （ADR-016 裁决 ④：键名回显或空串跳过），引擎不内置任何中文句子。
 */

/* ---------- 数值机制参数（#020 批 3：引擎基线 + config.combat 覆盖） ---------- */

/**
 * 伤害解算机制参数：config.combat 同名字段覆盖引擎基线
 * （ADR-016 裁决 ① 分策）。本接口只承载 combat.ts 函数体消费的字段
 * （减伤/波动/伤害档阈值/危血线）；间隔/暴击倍率等由 game.ts 直接读
 * contentView 的战斗参数视图。
 */
export interface DamageMechanics {
  /** 减伤常数：伤害 ×(1 − def/(def+K))。 */
  readonly defenseK: number;
  /** 伤害波动幅度（乘数 1−v ~ 1+v）。 */
  readonly damageVariance: number;
  /** 伤害档阈值：相对期望伤害 < 此值 = light。 */
  readonly tierLightMax: number;
  readonly tierMidMax: number;
  /** 伤害档阈值：≥ 此值 = deadly。 */
  readonly tierHeavyMax: number;
  /** 危血线：剩余生命 ≤ 该比例视为「危」（致命一击门控）。 */
  readonly criticalHpFraction: number;
}

/** 引擎基线（旧版 data.js 沿革）；config 缺省时使用。 */
export const BASE_DAMAGE_MECHANICS: DamageMechanics = {
  defenseK: 120,
  damageVariance: 0.1,
  tierLightMax: 0.95,
  tierMidMax: 1.05,
  tierHeavyMax: 1.5,
  criticalHpFraction: 0.15,
};

/* ---------- 伤害解算 ---------- */

/** 一次伤害掷点：atk ×(1−v~1+v) ×减伤，下限 1。 */
export function calcDmg(
  atk: number,
  def: number,
  random: () => number,
  m: DamageMechanics = BASE_DAMAGE_MECHANICS,
): number {
  const variance = 1 - m.damageVariance + random() * m.damageVariance * 2;
  const mitigation = 1 - def / (def + m.defenseK);
  return Math.max(1, Math.round(atk * variance * mitigation));
}

/** 暴击 roll（critChancePct 百分点）。 */
export function rollCrit(critChancePct: number, random: () => number): boolean {
  return random() * 100 < critChancePct;
}

export type DamageTier = 'light' | 'mid' | 'heavy' | 'deadly';

/** 伤害档：相对期望伤害（已计防御减免）。 */
export function hitTierOf(
  dmg: number,
  atk: number,
  def: number,
  m: DamageMechanics = BASE_DAMAGE_MECHANICS,
): DamageTier {
  const expected = Math.max(1, atk * (1 - def / (def + m.defenseK)));
  const r = dmg / expected;
  return r < m.tierLightMax ? 'light' : r < m.tierMidMax ? 'mid' : r < m.tierHeavyMax ? 'heavy' : 'deadly';
}

/** 剩余生命档（仅致命一击门控使用）。 */
export function isCriticalHp(hp: number, max: number, m: DamageMechanics = BASE_DAMAGE_MECHANICS): boolean {
  return max > 0 && hp / max <= m.criticalHpFraction;
}

/* ---------- 通用词库抽取器 ---------- */

/**
 * 引擎战斗兜底键（ADR-010 安全兜底约定：未注册招式/动词池一律回退拳脚）。
 * 内容包校验保证 moves[FIST_KEY] 与 verbs[FIST_KEY] 恒在（#021 批 4：动词池
 * 键域开放后仅 fist 恒需）；引擎内所有 fist 兜底取值统一引用本常量。
 */
export const FIST_KEY = 'fist';

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

/**
 * 模板槽位填充：把 `{key}` 槽替换为 vars[key]。值为空串即跳过该槽
 * （ADR-016 裁决 ④ 防御路径：缺词库时槽位退化，不造句）。
 */
export function fillTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

/** 战斗词库的透明视图（content.combatText 按形状读取）。 */
export interface CombatTextPools {
  readonly verbs?: unknown;
  readonly moves?: unknown;
  readonly openings?: unknown;
  readonly critIntro?: unknown;
  readonly cons?: unknown;
  readonly fatal?: unknown;
  /** 出招句式模板池（#019：playerLight/playerHeavy/playerCrit/enemyLight/enemyHeavy）。 */
  readonly templates?: unknown;
  /** 系统 note 叙事池（#019，game.ts 消费）。 */
  readonly notes?: unknown;
  /** 战后摘要池（#019：tiers + base/crit 模板）。 */
  readonly summary?: unknown;
  /** 同对手对照语池（#019：revenge/faster/slower/even）。 */
  readonly compare?: unknown;
}

/** 文案生成入参：双方身份、数值与随机源。 */
export interface AttackTextArgs {
  /** 出招侧：玩家 / 敌人。 */
  readonly side: 'player' | 'enemy';
  /** 敌方名（玩家出招时的受击者 / 敌方出招时的主语）。 */
  readonly enemyName: string;
  /** 招式注册键：武器物品 id / 敌人 id / 'fist'。未注册回退 fist。 */
  readonly moveKey: string;
  /** 动词池键（开放键域，#021 批 4）：内容声明，未注册回退 fist。 */
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
  const fallbackList = verbs && typeof verbs === 'object' ? verbs[FIST_KEY] : undefined;
  const entry = pickVerbEntry(list, random) ?? pickVerbEntry(fallbackList, random);
  if (entry) return entry;
  // 词库全缺：非文案占位（键名回显，ADR-016 裁决 ④），不内置中文兜底句。
  return { verb: 'v', limb: 'limb' };
}

function pickVerbEntry(list: unknown, random: () => number): { verb: string; limb: string } | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const entry = list[Math.floor(random() * list.length) % list.length] as VerbLike | undefined;
  if (!entry || typeof entry !== 'object') return undefined;
  const limb = pickText(entry.limbs, random);
  if (typeof entry.v !== 'string' || !limb) return undefined;
  return { verb: entry.v, limb };
}

/** 招式名抽取：moves[moveKey] 未注册回退 moves.fist（安全兜底约定）；全缺回显注册键。 */
export function extractMoveName(pools: CombatTextPools, moveKey: string, random: () => number): string {
  const moves = pools.moves as Record<string, unknown> | undefined;
  const pool = moves && typeof moves === 'object' ? (moves[moveKey] ?? moves[FIST_KEY]) : undefined;
  // 兜底：键名回显（ADR-016 裁决 ④），不再冻结默认包招式名。
  return pickText(pool, random) ?? moveKey;
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

/** 模板池抽取：templates[key] 非法/缺失返回 undefined（防御路径）。 */
function pickTemplate(pools: CombatTextPools, key: string, random: () => number): string | undefined {
  const templates = pools.templates as Record<string, unknown> | undefined;
  const pool = templates && typeof templates === 'object' ? templates[key] : undefined;
  return pickText(pool, random);
}

/**
 * 生成一次出招的完整文案：出招句（templates 模板出池，#019）+
 * 受击者主语后果句。门控：受击者残血（≤15%）且重/濒死 → fatal 专属词库。
 * 全部词库缺失时退化为非文案占位（伤害数字），绝不内置中文句子。
 */
export function makeAttackText(
  pools: CombatTextPools,
  args: AttackTextArgs,
  random: () => number,
  m: DamageMechanics = BASE_DAMAGE_MECHANICS,
): string {
  const tier = hitTierOf(args.dmg, args.atk, args.defenderDef, m);
  const { verb, limb } = pickVerb(pools, args.verbStyle, random);
  const move = extractMoveName(pools, args.moveKey, random);

  // 模板选择：玩家 crit/deadly 走暴击起势句、heavy 走起势句；妖物 heavy/deadly 同池。
  const isPlayer = args.side === 'player';
  const templateKey = isPlayer
    ? tier === 'deadly' || args.crit
      ? 'playerCrit'
      : tier === 'heavy'
        ? 'playerHeavy'
        : 'playerLight'
    : tier === 'heavy' || tier === 'deadly'
      ? 'enemyHeavy'
      : 'enemyLight';
  const template = pickTemplate(pools, templateKey, random);
  const line = template
    ? fillTemplate(template, {
        move,
        weapon: args.weaponName,
        verb,
        limb,
        defender: args.enemyName,
        enemy: args.enemyName,
        // 起势槽：缺词库时空串跳过（裁决 ④），不造兜底句。
        opening: tier === 'heavy' && isPlayer ? (pickText(pools.openings, random) ?? '') : '',
        critIntro: tier === 'deadly' || args.crit ? (pickText(pools.critIntro, random) ?? '') : '',
      })
    : '';

  const critical = isCriticalHp(args.defenderHp, args.defenderMaxHp, m);
  const fatalGated = critical && (tier === 'heavy' || tier === 'deadly');
  const fatal = fatalGated ? fatalText(pools, args.side) : undefined;
  const tail = fatal !== undefined
    ? fatal.replaceAll('{defender}', args.enemyName).replaceAll('{d}', String(args.dmg))
    : // 后果池缺失：退化 `{d}` 裸伤害占位（裁决 ④），不再内置中文模板。
      (tierText(pools, args.side, tier, random) ?? '{d}')
        .replaceAll('{defender}', args.enemyName)
        .replaceAll('{d}', String(args.dmg));
  const full = line + tail;
  return full === '' ? String(args.dmg) : full;
}

/* ---------- 战斗摘要与同对手对照（调研合入 2026-09-02） ---------- */

/** 一场战斗的玩家伤害构成累计（战斗状态随档保存，中断可续）。 */
export interface RoundTally {
  rounds: number;
  crits: number;
  tiers: Readonly<Record<DamageTier, number>>;
}

export const emptyTally = (): RoundTally => ({ rounds: 0, crits: 0, tiers: { light: 0, mid: 0, heavy: 0, deadly: 0 } });

/**
 * 战后一行签名画像（模板出池，#019）：由伤害构成（主导伤害档 + 会心数）
 * 从 summary.tiers 取画句，套 base/crit 整行模板。
 * summary 节缺失时退化为纯轮数（非文案占位，裁决 ④）。
 */
export function summarizeRounds(
  tally: RoundTally,
  pools: CombatTextPools | undefined,
  random: () => number,
): string {
  const { tiers } = tally;
  let dominant: DamageTier = 'light';
  for (const tier of ['mid', 'heavy', 'deadly'] as const) {
    if (tiers[tier] > tiers[dominant]) dominant = tier;
  }
  const summary = pools?.summary as
    | { tiers?: Record<string, unknown>; base?: unknown; crit?: unknown }
    | undefined;
  const template = pickText(tally.crits > 0 ? summary?.crit : summary?.base, random);
  if (template === undefined) return String(tally.rounds);
  const flavor = pickText(summary?.tiers?.[dominant], random) ?? '';
  return fillTemplate(template, {
    rounds: String(tally.rounds),
    flavor,
    crits: String(tally.crits),
  });
}

/** 同对手上一战记录（lastEncounter 值形状）。 */
export interface EncounterRecord {
  /** 玩家出招合数。 */
  readonly rounds: number;
  readonly won: boolean;
  /** 战斗结束时的游戏内时间（毫秒）。 */
  readonly at: number;
}

/**
 * 对照语（模板出池，#019）：同对手再战的回合数/胜负对照。
 * 无从对照或 compare 节缺失（防御路径）返回 undefined——对照语是增强
 * 信息，事件侧省略即可，不造兜底句。
 */
export function compareEncounterText(
  prev: EncounterRecord | undefined,
  rounds: number,
  pools: CombatTextPools | undefined,
  random: () => number,
): string | undefined {
  if (!prev || typeof prev.rounds !== 'number' || prev.rounds <= 0) return undefined;
  const compare = pools?.compare as Record<string, unknown> | undefined;
  if (!compare || typeof compare !== 'object') return undefined;
  const key = !prev.won ? 'revenge' : rounds < prev.rounds ? 'faster' : rounds > prev.rounds ? 'slower' : 'even';
  const template = pickText(compare[key], random);
  if (template === undefined) return undefined;
  return fillTemplate(template, { rounds: String(rounds), prev: String(prev.rounds) });
}
