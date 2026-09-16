/**
 * 修行录记录资产（#33）：行为段聚合账本 + 流量计数器 + 锚点。
 *
 * 词汇依据：CONTEXT.md「修行录」「锚点」「入账咽喉」（2026-09-11）——条目粒度
 * = 行为段（起止墙钟 + 动作次数 + 收获/损耗聚合），不记逐件流水；资产数字
 * 唯一来源 = type='ledger' 账本事件（#39 票评：victory.drops 等旧形状并行期
 * 双算，仅供场次/胜负摘要）；锚点净收获 = 累计流量计数器快照差值（O(1)、
 * 环形淘汰无害，ADR-013 纪律）。
 *
 * 确定性纪律边界（#33 五轮审计 B）：GameState 首次引入墙钟数据（条目/锚点
 * 时间戳）——合规边界 = 注入钟产生、仅记录元数据、不参与任何机制解算。
 *
 * 条目引用全存 id（物品/技能/敌人/货币键），零展示名——内容包变更后历史
 * 条目由壳层查表渲染、查无回显 id（ADR-015 稳定引用的渲染侧兜底）。
 * 条目一经闭段写入即不可变：cloneState 的 records 走「数组浅拷 + WeakMap
 * 缓存克隆」（追加时换引用，流水不变时连续快照零增量克隆，五轮审计 A）。
 */
import type { GameEvent } from './types.js';
import type { LedgerAuto, LedgerData, LedgerKind, LedgerSource } from './ledger.js';
import { LEDGER_SOURCES } from './ledger.js';

/** 环形缓冲上限（票面约定约 500 条；明细定位 = 最近流水，汇总正确性不压在它身上）。 */
export const JOURNAL_CAP = 500;

/** 条目明细行：ledger 载荷的段内聚合行（闭段后冻结为只读）。 */
export interface JournalLine {
  readonly source: LedgerSource;
  readonly kind: LedgerKind;
  readonly id: string;
  /** 带符号净额（增正减负；折叠标记行恒 0，纯展示）。 */
  readonly count: number;
  /** 灵石等价净额 Σ(value×count)（value=入账时冻结单价）。 */
  readonly gold: number;
  /** 装备行稀有度档位键。 */
  readonly rarity?: string;
  /** 折叠方式（入账即折的成对行）。 */
  readonly auto?: LedgerAuto;
}

/** 开放段明细行（聚合累计中的可变形态）。 */
export interface OpenLine {
  source: LedgerSource;
  kind: LedgerKind;
  id: string;
  count: number;
  gold: number;
  rarity?: string;
  auto?: LedgerAuto;
}

/** 闭段条目公共底座：单调流水序号 + 起止墙钟（注入钟，仅元数据）。 */
export interface JournalRecordBase {
  readonly seq: number;
  readonly t0: number;
  readonly t1: number;
}

/** 战斗段：连续战斗（含 auto-fight/换敌）并作一段；闭段于开始另一行为/存档/离线。 */
export interface CombatRecord extends JournalRecordBase {
  readonly kind: 'combat';
  readonly enemyIds: readonly string[];
  readonly wins: number;
  readonly losses: number;
  readonly exp: number;
  readonly lines: readonly JournalLine[];
}

/** 采集段。activityName 随档（活动无 id，#16 前以名为稳定引用，state.activity 同律）。 */
export interface GatherRecord extends JournalRecordBase {
  readonly kind: 'gather';
  readonly skillId: string;
  readonly activityName?: string;
  readonly cycles: number;
  readonly exp: number;
  readonly lines: readonly JournalLine[];
}

/** 炼制段（cycles = 成功轮数；失败轮数另计）。 */
export interface CraftRecord extends JournalRecordBase {
  readonly kind: 'craft';
  readonly skillId: string;
  readonly activityName?: string;
  readonly cycles: number;
  readonly fails: number;
  readonly exp: number;
  readonly lines: readonly JournalLine[];
}

/** 秘境段：记通关次数与段内最深到达层；段内多场战斗不另开段（胜负不单列）。 */
export interface DungeonRecord extends JournalRecordBase {
  readonly kind: 'dungeon';
  readonly dungeonId: string;
  /** 通关次数（dungeon:clear）。 */
  readonly cleared: number;
  /** 段内最深到达层（未通关记「xx层→xx层」的右端）。 */
  readonly deepest: number;
  readonly lines: readonly JournalLine[];
}

/** 访问段（坊市/乾坤袋）：开页至离开记一笔，期间全部 user 操作并作一段；零操作不留痕。 */
export interface VisitRecord extends JournalRecordBase {
  readonly kind: 'visit';
  readonly page: string;
  readonly lines: readonly JournalLine[];
}

/** 离线段：一次离线结算并作一段（offline 语义标注；折叠事件已按来源聚合，防灌爆环形缓冲）。 */
export interface OfflineRecord extends JournalRecordBase {
  readonly kind: 'offline';
  readonly skillId: string;
  readonly activityName?: string;
  readonly seconds: number;
  /** 真实离开时长（秒；离线上限钳制时 ≠ seconds，展示区分双口径）。 */
  readonly awaySeconds?: number;
  readonly cycles: number;
  readonly exp: number;
  readonly capped: boolean;
  readonly levels: readonly OfflineLevelRow[];
  readonly lines: readonly JournalLine[];
}

export interface OfflineLevelRow {
  readonly skillId: string;
  readonly level: number;
}

/** 点条目：无开放访问段时的单点手动动作（同拍同源多笔 ledger 聚合为一条，count=件数语义）。 */
export interface PointRecord extends JournalRecordBase {
  readonly kind: 'point';
  readonly source: LedgerSource;
  readonly lines: readonly JournalLine[];
}

/** 升级点条目（ledger exp 只进计数器与段聚合，升级事件独立成条）。 */
export interface LevelupRecord extends JournalRecordBase {
  readonly kind: 'levelup';
  readonly skillId: string;
  readonly level: number;
}

/** 成就点条目（奖励数字从事件载荷；achievement 来源的 ledger 只进计数器防双条目）。 */
export interface AchievementRecord extends JournalRecordBase {
  readonly kind: 'achievement';
  readonly id: string;
  readonly gold?: number;
  readonly daoYun?: number;
  readonly items?: Readonly<Record<string, number>>;
}

/** 兵解篇章标记条目（流水保留的篇章锚；锚点与开放段由引擎在兵解时处置）。 */
export interface RebirthRecord extends JournalRecordBase {
  readonly kind: 'rebirth';
  readonly daoYun: number;
  readonly totalXp: number;
  readonly rebirths: number;
}

export type JournalRecord =
  | CombatRecord
  | GatherRecord
  | CraftRecord
  | DungeonRecord
  | VisitRecord
  | OfflineRecord
  | PointRecord
  | LevelupRecord
  | AchievementRecord
  | RebirthRecord;

/* ---------- 开放段（进行中聚合态，随档保存） ---------- */

export interface CombatOpen {
  kind: 'combat';
  t0: number;
  enemyIds: string[];
  wins: number;
  losses: number;
  exp: number;
  lines: OpenLine[];
}

export interface GatherOpen {
  kind: 'gather';
  t0: number;
  skillId: string;
  activityName?: string;
  cycles: number;
  exp: number;
  lines: OpenLine[];
}

export interface CraftOpen {
  kind: 'craft';
  t0: number;
  skillId: string;
  activityName?: string;
  cycles: number;
  fails: number;
  exp: number;
  lines: OpenLine[];
}

export interface DungeonOpen {
  kind: 'dungeon';
  t0: number;
  dungeonId: string;
  cleared: number;
  deepest: number;
  lines: OpenLine[];
}

export interface VisitOpen {
  kind: 'visit';
  t0: number;
  page: string;
  lines: OpenLine[];
}

export type JournalOpen = CombatOpen | GatherOpen | CraftOpen | DungeonOpen | VisitOpen;

/**
 * 开放段容器（#33 复审修正）：行为段与访问段**分槽并存**——「访问段不闭任何
 * 行为段」（CONTEXT 词汇：战斗中进袋操作时战斗段必须持续，并行是常态）。
 */
export interface JournalOpenState {
  /** 行为段（战斗/采集/炼制/秘境；同一时刻至多一段——行为互斥）。 */
  behavior: JournalOpen | null;
  /** 访问段（坊市/乾坤袋；与行为段并行）。 */
  visit: VisitOpen | null;
}

export const emptyOpenState = (): JournalOpenState => ({ behavior: null, visit: null });

/* ---------- 持久字段形态（GameState.journal / journalOpen / ledgerCounters / journalAnchor） ---------- */

/** 流水容器：环形条目 + 流水序号（单调递增，淘汰不回退；增量渲染定位用）。 */
export interface JournalState {
  readonly records: readonly JournalRecord[];
  readonly seq: number;
}

/** 锚点：墙钟时刻 + 计数器快照；净收获 = 当前计数器 − 快照（重设即换基准）。 */
export interface JournalAnchor {
  readonly at: number;
  readonly snap: Readonly<Record<string, number>>;
}

/* ---------- 计数器与聚合纯函数 ---------- */

/** 流量计数器键：`kind:id:source`（分向累计 Σcount 带符号；id 形态由 schema 键形态保证无冒号）。 */
export function counterKeyOf(data: Pick<LedgerData, 'kind' | 'id' | 'source'>): string {
  return `${data.kind}:${data.id}:${data.source}`;
}

/** 明细行聚合键：来源 × kind × id × 稀有度 × 折叠方式（段内分项粒度）。 */
function lineKeyOf(line: Pick<LedgerData, 'source' | 'kind' | 'id' | 'rarity' | 'auto'>): string {
  return `${line.source}|${line.kind}|${line.id}|${line.rarity ?? ''}|${line.auto ?? ''}`;
}

/** 流量计数器累计（开放键；count=0 的折叠标记行不建键防灌键）。 */
export function bumpCounter(counters: Record<string, number>, data: LedgerData): void {
  if (data.count === 0) return;
  const key = counterKeyOf(data);
  counters[key] = (counters[key] ?? 0) + data.count;
}

/** 明细行聚合（就地累计；同键行 count/gold 累加，value 冻结口径体现在 gold 累计）。 */
export function appendLine(lines: OpenLine[], data: LedgerData): void {
  const key = lineKeyOf(data);
  for (const line of lines) {
    if (lineKeyOf(line) === key) {
      line.count += data.count;
      line.gold += data.value * data.count;
      return;
    }
  }
  lines.push({
    source: data.source,
    kind: data.kind,
    id: data.id,
    count: data.count,
    gold: data.value * data.count,
    ...(data.rarity !== undefined ? { rarity: data.rarity } : {}),
    ...(data.auto !== undefined ? { auto: data.auto } : {}),
  });
}

/** 冻结开放段行为只读明细行。 */
function freezeLines(lines: readonly OpenLine[]): JournalLine[] {
  return lines.map((line) => ({ ...line }));
}

/** 零数据段判空（不留痕）：闭段时无动作无账目的段丢弃。 */
function isEmptyOpen(open: JournalOpen): boolean {
  switch (open.kind) {
    case 'combat':
      return open.wins === 0 && open.losses === 0 && open.exp === 0 && open.lines.length === 0;
    case 'gather':
    case 'craft':
      return open.cycles === 0 && open.exp === 0 && open.lines.length === 0;
    case 'dungeon':
      return open.cleared === 0 && open.deepest === 0 && open.lines.length === 0;
    case 'visit':
      return open.lines.length === 0;
  }
}

/** 闭段成条（t1 = 闭段墙钟，seq = 流水序号）；零数据段返回 null 不留痕。 */
export function closeOpen(open: JournalOpen, t1: number, seq: number): JournalRecord | null {
  if (isEmptyOpen(open)) return null;
  const base = { seq, t0: open.t0, t1 };
  switch (open.kind) {
    case 'combat':
      return {
        ...base,
        kind: 'combat',
        enemyIds: [...open.enemyIds],
        wins: open.wins,
        losses: open.losses,
        exp: open.exp,
        lines: freezeLines(open.lines),
      };
    case 'gather':
      return {
        ...base,
        kind: 'gather',
        skillId: open.skillId,
        ...(open.activityName !== undefined ? { activityName: open.activityName } : {}),
        cycles: open.cycles,
        exp: open.exp,
        lines: freezeLines(open.lines),
      };
    case 'craft':
      return {
        ...base,
        kind: 'craft',
        skillId: open.skillId,
        ...(open.activityName !== undefined ? { activityName: open.activityName } : {}),
        cycles: open.cycles,
        fails: open.fails,
        exp: open.exp,
        lines: freezeLines(open.lines),
      };
    case 'dungeon':
      return {
        ...base,
        kind: 'dungeon',
        dungeonId: open.dungeonId,
        cleared: open.cleared,
        deepest: open.deepest,
        lines: freezeLines(open.lines),
      };
    case 'visit':
      return { ...base, kind: 'visit', page: open.page, lines: freezeLines(open.lines) };
  }
}

/* ---------- 锚点净收获投影（壳零公式复算的引擎面） ---------- */

export interface AnchorNetRow {
  readonly kind: LedgerKind;
  readonly id: string;
  /** 带符号净收获（得失相抵后非零才输出）。 */
  readonly count: number;
}

const NET_KIND_ORDER: Readonly<Record<LedgerKind, number>> = {
  currency: 0,
  item: 1,
  gear: 2,
  exp: 3,
};

/** 锚点以来净收获：当前计数器 − 锚点快照，来源维度合并到 (kind,id)；O(键数)。 */
export function journalAnchorNet(
  counters: Readonly<Record<string, number>>,
  anchor: JournalAnchor | null,
): AnchorNetRow[] {
  if (!anchor) return [];
  const diff = new Map<string, number>();
  const bump = (key: string, delta: number): void => {
    // 键归一到 `kind:id`（来源维度合并；折叠键形态防御跳过）。
    const sep1 = key.indexOf(':');
    const sep2 = key.indexOf(':', sep1 + 1);
    if (sep1 < 0 || sep2 < 0) return;
    const merged = key.slice(0, sep2);
    diff.set(merged, (diff.get(merged) ?? 0) + delta);
  };
  for (const [key, value] of Object.entries(counters)) bump(key, value);
  for (const [key, value] of Object.entries(anchor.snap)) bump(key, -value);
  const rows: AnchorNetRow[] = [];
  for (const [key, count] of diff) {
    if (count === 0) continue;
    const sep1 = key.indexOf(':');
    rows.push({ kind: key.slice(0, sep1) as LedgerKind, id: key.slice(sep1 + 1), count });
  }
  rows.sort(
    (a, b) =>
      NET_KIND_ORDER[a.kind] - NET_KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return rows;
}

/* ---------- cloneState 消费（追加时换引用 + 缓存克隆复用，五轮审计 A） ---------- */

const recordsCloneCache = new WeakMap<readonly JournalRecord[], readonly JournalRecord[]>();

/** 流水容器克隆：records 数组浅拷（条目不可变 → 隔离等价深拷）+ 缓存复用。 */
export function cloneJournal(value: JournalState): JournalState {
  let records = recordsCloneCache.get(value.records);
  if (!records) {
    records = value.records.slice();
    recordsCloneCache.set(value.records, records);
  }
  return { records: records as JournalRecord[], seq: value.seq };
}

/** 开放段克隆（聚合态可变 → 逐层真拷）。 */
export function cloneOpenValue(value: JournalOpen): JournalOpen {
  const lines = value.lines.map((line) => ({ ...line }));
  if (value.kind === 'combat') return { ...value, enemyIds: [...value.enemyIds], lines };
  return { ...value, lines };
}

/** 开放段容器克隆：行为段/访问段各自真拷。 */
export function cloneJournalOpen(value: JournalOpenState): JournalOpenState {
  return {
    behavior: value.behavior ? cloneOpenValue(value.behavior) : null,
    visit: value.visit ? (cloneOpenValue(value.visit) as VisitOpen) : null,
  };
}

/** 锚点克隆（快照表浅拷即深拷——值全为 number）。 */
export function cloneJournalAnchor(value: JournalAnchor | null): JournalAnchor | null {
  return value ? { at: value.at, snap: { ...value.snap } } : null;
}

/* ---------- 存档消毒恢复（显式路径，禁透明收编——三轮审计 A 硬要求） ---------- */

/** 计数器键形态：kind 枚举 × id 键形态 × 来源闭集（防垃圾键/原型污染向量）。 */
const COUNTER_KEY_RE = new RegExp(
  `^(item|gear|currency|exp):[a-z][a-zA-Z0-9_]*:(${LEDGER_SOURCES.join('|')})$`,
);

const ID_RE = /^[a-z][a-zA-Z0-9_]*$/;

/** 计数器恢复：键形态校验 + 数值有限性校验（可负——带符号累计）。 */
export function restoreCounters(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!COUNTER_KEY_RE.test(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

/** 锚点恢复：at 有限数 + 快照走计数器同款消毒；形状非法回退 null（= 无锚点）。 */
export function restoreAnchor(raw: unknown): JournalAnchor | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const shape = raw as { at?: unknown; snap?: unknown };
  if (typeof shape.at !== 'number' || !Number.isFinite(shape.at) || shape.at < 0) return null;
  return { at: shape.at, snap: restoreCounters(shape.snap) };
}

function asFiniteInt(value: unknown, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min
    ? Math.floor(value)
    : min;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asId(value: unknown): string {
  return typeof value === 'string' && ID_RE.test(value) ? value : '';
}

/** 明细行消毒（逐字段白名单重建）。 */
function restoreLine(raw: unknown): JournalLine | null {
  if (raw === null || typeof raw !== 'object') return null;
  const shape = raw as Record<string, unknown>;
  const source = shape.source;
  const kind = shape.kind;
  if (
    typeof source !== 'string' ||
    !(LEDGER_SOURCES as readonly string[]).includes(source) ||
    (kind !== 'item' && kind !== 'gear' && kind !== 'currency' && kind !== 'exp')
  ) {
    return null;
  }
  const id = asId(shape.id);
  if (!id) return null;
  const count = shape.count;
  const gold = shape.gold;
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  if (typeof gold !== 'number' || !Number.isFinite(gold)) return null;
  const auto = shape.auto;
  return {
    source: source as LedgerSource,
    kind,
    id,
    count,
    gold,
    ...(typeof shape.rarity === 'string' && shape.rarity.length > 0 ? { rarity: shape.rarity } : {}),
    ...(auto === 'sell' || auto === 'smelt' ? { auto } : {}),
  };
}

function restoreLines(raw: unknown): OpenLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenLine[] = [];
  for (const entry of raw) {
    const line = restoreLine(entry);
    if (line) out.push({ ...line });
  }
  return out;
}

/** 单条条目消毒：kind 判别 + 逐字段白名单重建（坏档注入的垃圾字段一律弃置）。 */
function restoreRecord(raw: unknown): JournalRecord | null {
  if (raw === null || typeof raw !== 'object') return null;
  const shape = raw as Record<string, unknown>;
  const seq = asFiniteInt(shape.seq);
  const t0 = typeof shape.t0 === 'number' && Number.isFinite(shape.t0) ? shape.t0 : 0;
  const t1 = Math.max(typeof shape.t1 === 'number' && Number.isFinite(shape.t1) ? shape.t1 : t0, t0);
  const base = { seq, t0, t1 };
  const lines = restoreLines(shape.lines);
  switch (shape.kind) {
    case 'combat': {
      const enemyIds = Array.isArray(shape.enemyIds)
        ? shape.enemyIds.filter((id): id is string => typeof id === 'string' && ID_RE.test(id))
        : [];
      return {
        ...base,
        kind: 'combat',
        enemyIds,
        wins: asFiniteInt(shape.wins),
        losses: asFiniteInt(shape.losses),
        exp: asFiniteInt(shape.exp),
        lines,
      };
    }
    case 'gather': {
      const activityName = asText(shape.activityName);
      return {
        ...base,
        kind: 'gather',
        skillId: asId(shape.skillId),
        ...(activityName !== undefined ? { activityName } : {}),
        cycles: asFiniteInt(shape.cycles),
        exp: asFiniteInt(shape.exp),
        lines,
      };
    }
    case 'craft': {
      const activityName = asText(shape.activityName);
      return {
        ...base,
        kind: 'craft',
        skillId: asId(shape.skillId),
        ...(activityName !== undefined ? { activityName } : {}),
        cycles: asFiniteInt(shape.cycles),
        fails: asFiniteInt(shape.fails),
        exp: asFiniteInt(shape.exp),
        lines,
      };
    }
    case 'dungeon':
      return {
        ...base,
        kind: 'dungeon',
        dungeonId: asId(shape.dungeonId),
        cleared: asFiniteInt(shape.cleared),
        deepest: asFiniteInt(shape.deepest),
        lines,
      };
    case 'visit':
      return {
        ...base,
        kind: 'visit',
        page: typeof shape.page === 'string' && shape.page.length > 0 ? shape.page : '',
        lines,
      };
    case 'offline': {
      const activityName = asText(shape.activityName);
      const levels = Array.isArray(shape.levels)
        ? shape.levels
            .map((row) => {
              const r = row as Record<string, unknown> | null;
              return r !== null && typeof r === 'object' && typeof r.skillId === 'string'
                ? { skillId: r.skillId, level: asFiniteInt(r.level, 1) }
                : null;
            })
            .filter((row): row is OfflineLevelRow => row !== null)
        : [];
      return {
        ...base,
        kind: 'offline',
        skillId: asId(shape.skillId),
        ...(activityName !== undefined ? { activityName } : {}),
        seconds: asFiniteInt(shape.seconds),
        ...(typeof shape.awaySeconds === 'number' && Number.isFinite(shape.awaySeconds)
          ? { awaySeconds: Math.max(0, Math.floor(shape.awaySeconds)) }
          : {}),
        cycles: asFiniteInt(shape.cycles),
        exp: asFiniteInt(shape.exp),
        capped: shape.capped === true,
        levels,
        lines,
      };
    }
    case 'point': {
      const source = shape.source;
      if (typeof source !== 'string' || !(LEDGER_SOURCES as readonly string[]).includes(source)) {
        return null;
      }
      return { ...base, kind: 'point', source: source as LedgerSource, lines };
    }
    case 'levelup':
      return { ...base, kind: 'levelup', skillId: asId(shape.skillId), level: asFiniteInt(shape.level, 1) };
    case 'achievement': {
      if (typeof shape.id !== 'string' || shape.id.length === 0) return null;
      const items =
        shape.items !== null && typeof shape.items === 'object' && !Array.isArray(shape.items)
          ? Object.fromEntries(
              Object.entries(shape.items as Record<string, unknown>)
                .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
                .map(([key, count]) => [key, Math.max(0, Math.floor(count))]),
            )
          : undefined;
      const gold = typeof shape.gold === 'number' && Number.isFinite(shape.gold) ? shape.gold : undefined;
      const daoYun =
        typeof shape.daoYun === 'number' && Number.isFinite(shape.daoYun) ? shape.daoYun : undefined;
      return {
        ...base,
        kind: 'achievement',
        id: shape.id,
        ...(gold !== undefined ? { gold } : {}),
        ...(daoYun !== undefined ? { daoYun } : {}),
        ...(items !== undefined && Object.keys(items).length > 0 ? { items } : {}),
      };
    }
    case 'rebirth':
      return {
        ...base,
        kind: 'rebirth',
        daoYun: asFiniteInt(shape.daoYun),
        totalXp: asFiniteInt(shape.totalXp),
        rebirths: asFiniteInt(shape.rebirths),
      };
    default:
      return null;
  }
}

/** 流水容器恢复：逐条消毒 + 截断到环形上限（只留最新，防异常档万条灌内存，四轮审计 A）。 */
export function restoreJournal(raw: unknown): JournalState {
  const records: JournalRecord[] = [];
  let seq = 0;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const shape = raw as { records?: unknown; seq?: unknown };
    if (Array.isArray(shape.records)) {
      for (const entry of shape.records) {
        const record = restoreRecord(entry);
        if (record) {
          records.push(record);
          seq = Math.max(seq, record.seq);
        }
      }
    }
    if (typeof shape.seq === 'number' && Number.isFinite(shape.seq) && shape.seq > seq) {
      seq = Math.floor(shape.seq);
    }
  }
  const trimmed =
    records.length > JOURNAL_CAP ? records.slice(records.length - JOURNAL_CAP) : records;
  return { records: trimmed.map(freezeRecord), seq };
}

/** 开放段恢复（消毒；访问段的闭段处置归字段表 restore 行——需要存档墙钟与流水序号语境）。 */
export function restoreJournalOpen(raw: unknown): JournalOpen | null {
  if (raw === null || typeof raw !== 'object') return null;
  const shape = raw as Record<string, unknown>;
  const t0 = typeof shape.t0 === 'number' && Number.isFinite(shape.t0) && shape.t0 >= 0 ? shape.t0 : 0;
  const lines = restoreLines(shape.lines);
  switch (shape.kind) {
    case 'combat': {
      const enemyIds = Array.isArray(shape.enemyIds)
        ? shape.enemyIds.filter((id): id is string => typeof id === 'string' && ID_RE.test(id))
        : [];
      return {
        kind: 'combat',
        t0,
        enemyIds,
        wins: asFiniteInt(shape.wins),
        losses: asFiniteInt(shape.losses),
        exp: asFiniteInt(shape.exp),
        lines,
      };
    }
    case 'gather': {
      const activityName = asText(shape.activityName);
      return {
        kind: 'gather',
        t0,
        skillId: asId(shape.skillId),
        ...(activityName !== undefined ? { activityName } : {}),
        cycles: asFiniteInt(shape.cycles),
        exp: asFiniteInt(shape.exp),
        lines,
      };
    }
    case 'craft': {
      const activityName = asText(shape.activityName);
      return {
        kind: 'craft',
        t0,
        skillId: asId(shape.skillId),
        ...(activityName !== undefined ? { activityName } : {}),
        cycles: asFiniteInt(shape.cycles),
        fails: asFiniteInt(shape.fails),
        exp: asFiniteInt(shape.exp),
        lines,
      };
    }
    case 'dungeon':
      return {
        kind: 'dungeon',
        t0,
        dungeonId: asId(shape.dungeonId),
        cleared: asFiniteInt(shape.cleared),
        deepest: asFiniteInt(shape.deepest),
        lines,
      };
    case 'visit':
      return {
        kind: 'visit',
        t0,
        page: typeof shape.page === 'string' && shape.page.length > 0 ? shape.page : '',
        lines,
      };
    default:
      return null;
  }
}

/** 追加条目（换引用 + 环形淘汰 + seq 推进；条目入列即深冻结——见 freezeRecord）。 */
export function appendRecord(journal: JournalState, record: JournalRecord): JournalState {
  const frozen = freezeRecord(record);
  const overflow = journal.records.length + 1 - JOURNAL_CAP;
  const records =
    overflow > 0 ? [...journal.records.slice(overflow), frozen] : [...journal.records, frozen];
  return { records, seq: record.seq };
}

/**
 * 条目冻结（#33 复审修正·快照契约 AC）：闭段条目构造时深冻结（条目/明细数组/
 * 明细行），cloneState 的 records 数组浅拷 + 缓存复用因此与「改快照嵌套不影响
 * 引擎状态」AC 相容——严格模式下向冻结对象写入抛 TypeError，非法改写当场暴露
 * 而非静默写穿引擎。行为段聚合态（journalOpen）可变，不冻结。
 */
export function freezeRecord(record: JournalRecord): JournalRecord {
  if ('lines' in record) {
    for (const line of record.lines) Object.freeze(line);
    Object.freeze(record.lines);
  }
  if (record.kind === 'combat') Object.freeze(record.enemyIds);
  if (record.kind === 'offline') Object.freeze(record.levels);
  return Object.freeze(record);
}

/* ---------- 段聚合器（createGame 内订阅 EventBus，stats.ts 同式） ---------- */

/** 聚合器挂载的持久槽位（GameState 的结构子集；createGame 传 state 本体）。 */
export interface JournalCells {
  journal: JournalState;
  journalOpen: JournalOpenState;
  ledgerCounters: Record<string, number>;
  journalAnchor: JournalAnchor | null;
}

/** 聚合器的引擎态读取器（开段判型与一致性哨兵；窄接口防 journal.ts 反向依赖状态树全貌）。 */
export interface JournalAggregatorDeps {
  /** 注入钟墙钟（条目时间唯一来源）。 */
  now(): number;
  /** 进行中的采集/炼制活动（null = 无）。 */
  activity(): { skillId: string; name: string } | null;
  /** 进行中的战斗（null = 脱战）。 */
  combat(): { enemyId: string } | null;
  /** 进行中的秘境攻略（null = 不在秘境）。 */
  dungeon(): { dungeonId: string } | null;
  /** 技能类型判定（activity:start 事件载荷无类型字段，开段形态据此分流）。 */
  skillKindOf(skillId: string): 'gather' | 'craft' | undefined;
}

/**
 * 段落账状态机：消费引擎事件流归段聚合（订阅侧，emit 即同步落账；
 * 监听器异常由 EventBus 吞掉，不阻断主循环）。
 *
 * 闭段条件（CONTEXT「修行录」）：行为段闭于开始另一行为或离线（首笔 offline
 * 账本事件 = 终结点）；访问段闭于 visit:end，跨存档的开放访问段由字段表
 * restore 行强制闭段成条；兵解闭全部段并发篇章标记。访问段不闭行为段
 * （并行是常态）。战斗段惰性开启（首笔 victory/defeat），敌集合由事件累积；
 * 秘境内胜负不单列（秘境段只记通关次数/最深层数）。点条目按同拍同源微批
 * 聚合（tick 冻结）。一致性哨兵：引擎活动/战斗/秘境态漂移（离线停炉/撤退/
 * 包变更弃置后无闭段事件可达）时兜底闭段，留痕防丢账。
 */
export function createJournalAggregator(
  cells: JournalCells,
  deps: JournalAggregatorDeps,
): (event: GameEvent) => void {
  /** 离线聚合瞬态（一次结算并作一段；结算同步完成，不随档）。 */
  let offlineAgg: { t0: number; lines: OpenLine[] } | null = null;
  /** 点条目微批：同拍（游戏内 time）同源多笔 ledger 并作一条；tick/闭段拍冻结。 */
  let pending: { key: string; t: number; lines: OpenLine[] } | null = null;

  const nextSeq = (): number => cells.journal.seq + 1;

  const push = (record: JournalRecord): void => {
    cells.journal = appendRecord(cells.journal, record);
  };

  const closeBehavior = (): JournalRecord | null => {
    const open = cells.journalOpen.behavior;
    if (!open) return null;
    cells.journalOpen.behavior = null;
    return closeOpen(open, deps.now(), nextSeq());
  };

  const closeVisitSection = (): JournalRecord | null => {
    const open = cells.journalOpen.visit;
    if (!open) return null;
    cells.journalOpen.visit = null;
    return closeOpen(open, deps.now(), nextSeq());
  };

  /** 闭访问段（零操作不留痕）；行为段不受影响——并行是常态（CONTEXT 词汇）。 */
  const closeVisit = (): void => {
    const record = closeVisitSection();
    if (record) push(record);
  };

  /** 闭行为段（开新行为/离线时调用）；访问段不受影响。 */
  const closeBehaviorSection = (): void => {
    const record = closeBehavior();
    if (record) push(record);
  };

  /** 闭全部开放段（离线/兵解时调用）。 */
  const closeAllSections = (): void => {
    closeVisit();
    closeBehaviorSection();
  };

  const flushPending = (): void => {
    if (!pending) return;
    const { t, lines } = pending;
    pending = null;
    if (lines.length === 0) return;
    push({
      kind: 'point',
      seq: nextSeq(),
      t0: t,
      t1: deps.now(),
      source: lines[0]!.source,
      lines: freezeLines(lines),
    });
  };

  /** 一致性哨兵：引擎活动/战斗/秘境态与开放行为段漂移时兜底闭段。 */
  const sentinel = (event: GameEvent): void => {
    const open = cells.journalOpen.behavior;
    if (!open) return;
    if (open.kind === 'gather' || open.kind === 'craft') {
      if (!deps.activity()) closeBehaviorSection();
      return;
    }
    if (open.kind === 'combat') {
      if (!deps.combat() && !deps.dungeon()) closeBehaviorSection();
      return;
    }
    // dungeon:clear 先于段终结发射且发射前 state.dungeon 已清（advance 就地通关
    // 离境）——本事件拍跳过哨兵，clear 计数入段后由后续事件（retreat note/
    // dungeon:leave）正常闭段。
    if (open.kind === 'dungeon' && event.type !== 'dungeon:clear' && !deps.dungeon()) {
      closeBehaviorSection();
    }
  };

  /** idle 账本的归段行集（null = 无段可归）。 */
  const linesFor = (data: LedgerData): OpenLine[] | null => {
    const open = cells.journalOpen.behavior;
    if (!open) return null;
    switch (data.source) {
      case 'gather':
        return open.kind === 'gather' ? open.lines : null;
      case 'craft':
        return open.kind === 'craft' ? open.lines : null;
      case 'combat':
        // 秘境内战斗归秘境段（段内多场战斗不另开段）。
        return open.kind === 'combat' || open.kind === 'dungeon' ? open.lines : null;
      case 'dungeon':
        return open.kind === 'dungeon' ? open.lines : null;
      case 'eat':
        // auto-eat 只发生在战斗中（CombatRun 路径）→ 归战斗/秘境段。
        return open.kind === 'combat' || open.kind === 'dungeon' ? open.lines : null;
      default:
        return null;
    }
  };

  const initialLine = (data: LedgerData): OpenLine => ({
    source: data.source,
    kind: data.kind,
    id: data.id,
    count: data.count,
    gold: data.value * data.count,
    ...(data.rarity !== undefined ? { rarity: data.rarity } : {}),
    ...(data.auto !== undefined ? { auto: data.auto } : {}),
  });

  const openCombat = (): void => {
    cells.journalOpen.behavior = {
      kind: 'combat',
      t0: deps.now(),
      enemyIds: [],
      wins: 0,
      losses: 0,
      exp: 0,
      lines: [],
    };
  };

  return (event: GameEvent): void => {
    sentinel(event);
    switch (event.type) {
      case 'ledger': {
        const data = event.data;
        bumpCounter(cells.ledgerCounters, data);
        if (data.offline === true) {
          // 离线结算管线：首笔 offline 账本事件 = 在线段终结点（「闭段于…离线」），
          // 此后账目并入离线聚合（行键已含 source/折叠方式分向，票评 2026-09-13）。
          if (!offlineAgg) {
            flushPending();
            closeAllSections();
            offlineAgg = { t0: deps.now(), lines: [] };
          }
          appendLine(offlineAgg.lines, data);
          return;
        }
        if (data.source === 'achievement' || data.source === 'rebirth') {
          // 条目由 achievement:unlock / rebirth 专属事件承载，账本只进计数器防双条目。
          return;
        }
        if (data.origin === 'user') {
          const visit = cells.journalOpen.visit;
          if (visit) {
            appendLine(visit.lines, data);
            return;
          }
          // 点条目微批：同拍（同游戏内 time）同源多笔（如卖出的物品行+灵石行）并作一条。
          const key = `${event.time}|${data.source}`;
          if (pending && pending.key !== key) flushPending();
          if (pending) appendLine(pending.lines, data);
          else pending = { key, t: deps.now(), lines: [initialLine(data)] };
          return;
        }
        // 战斗段惰性开启：战斗开始无显式事件、账本先行（gold/gear/exp）——
        // 首笔战斗账本即开段（秘境段由 dungeon:enter 显式开，其内战斗归秘境段）。
        if (
          data.source === 'combat' &&
          cells.journalOpen.behavior?.kind !== 'combat' &&
          cells.journalOpen.behavior?.kind !== 'dungeon'
        ) {
          closeBehaviorSection();
          openCombat();
        }
        // idle 归段：开放行为段直纳；无段可归（防御/漂移后首笔）→ 兜底点条目可见不丢账。
        const lines = linesFor(data);
        if (lines) {
          appendLine(lines, data);
          if (data.kind === 'exp') {
            const open = cells.journalOpen.behavior;
            if (open && (open.kind === 'combat' || open.kind === 'gather' || open.kind === 'craft')) {
              open.exp += data.count;
            }
          }
          return;
        }
        flushPending();
        push({
          kind: 'point',
          seq: nextSeq(),
          t0: deps.now(),
          t1: deps.now(),
          source: data.source,
          lines: freezeLines([initialLine(data)]),
        });
        return;
      }
      case 'activity-start': {
        closeBehaviorSection();
        const { skillId, activityName } = event.data;
        cells.journalOpen.behavior =
          deps.skillKindOf(skillId) === 'craft'
            ? { kind: 'craft', t0: deps.now(), skillId, activityName, cycles: 0, fails: 0, exp: 0, lines: [] }
            : { kind: 'gather', t0: deps.now(), skillId, activityName, cycles: 0, exp: 0, lines: [] };
        return;
      }
      case 'activity-stop': {
        const open = cells.journalOpen.behavior;
        if (open && (open.kind === 'gather' || open.kind === 'craft')) closeBehaviorSection();
        return;
      }
      case 'activity-complete': {
        const open = cells.journalOpen.behavior;
        if (open && (open.kind === 'gather' || open.kind === 'craft')) open.cycles += 1;
        return;
      }
      case 'craft-fail': {
        const open = cells.journalOpen.behavior;
        if (open && open.kind === 'craft') open.fails += 1;
        return;
      }
      case 'victory':
      case 'defeat': {
        const open = cells.journalOpen.behavior;
        if (open?.kind === 'dungeon') return; // 秘境段内胜负不单列（只记通关/层数）
        if (open?.kind !== 'combat') {
          closeBehaviorSection();
          openCombat();
        }
        const combat = cells.journalOpen.behavior as CombatOpen;
        if (event.type === 'victory') combat.wins += 1;
        else combat.losses += 1;
        if (!combat.enemyIds.includes(event.data.enemyId)) combat.enemyIds.push(event.data.enemyId);
        return;
      }
      case 'dungeon:enter': {
        closeBehaviorSection();
        cells.journalOpen.behavior = {
          kind: 'dungeon',
          t0: deps.now(),
          dungeonId: event.data.dungeonId,
          cleared: 0,
          deepest: 0,
          lines: [],
        };
        return;
      }
            case 'dungeon:floor': {
        const open = cells.journalOpen.behavior;
        if (open?.kind === 'dungeon') open.deepest = Math.max(open.deepest, event.data.floor);
        return;
      }
      case 'dungeon:clear': {
        const open = cells.journalOpen.behavior;
        if (open?.kind === 'dungeon') {
          open.cleared += 1;
          open.deepest = Math.max(open.deepest, event.data.floors);
        }
        return;
      }
      case 'dungeon:leave': {
        if (cells.journalOpen.behavior?.kind === 'dungeon') closeBehaviorSection();
        return;
      }
      case 'visit:begin': {
        const page = event.data.page;
        const visit = cells.journalOpen.visit;
        if (visit && visit.page === page) return; // 重复 begin 同页忽略
        flushPending();
        closeVisit();
        cells.journalOpen.visit = { kind: 'visit', t0: deps.now(), page, lines: [] };
        return;
      }
      case 'visit:end': {
        closeVisit();
        return;
      }
      case 'levelup': {
        flushPending();
        push({
          kind: 'levelup',
          seq: nextSeq(),
          t0: deps.now(),
          t1: deps.now(),
          skillId: event.data.skillId,
          level: event.data.level,
        });
        return;
      }
      case 'achievement:unlock': {
        flushPending();
        const data = event.data;
        push({
          kind: 'achievement',
          seq: nextSeq(),
          t0: deps.now(),
          t1: deps.now(),
          id: data.id,
          ...(data.gold !== undefined ? { gold: data.gold } : {}),
          ...(data.daoYun !== undefined ? { daoYun: data.daoYun } : {}),
          ...(data.items !== undefined ? { items: data.items } : {}),
        });
        return;
      }
      case 'offline-settled': {
        if (offlineAgg) {
          const data = event.data;
          const lines = offlineAgg.lines;
          const t0 = offlineAgg.t0;
          offlineAgg = null;
          push({
            kind: 'offline',
            seq: nextSeq(),
            t0,
            t1: deps.now(),
            skillId: data.skillId,
            activityName: data.activityName,
            seconds: data.seconds,
            ...(data.awaySeconds !== undefined ? { awaySeconds: data.awaySeconds } : {}),
            cycles: data.cycles,
            exp: data.exp,
            capped: data.capped === true,
            levels: data.levels.map((row) => ({ skillId: row.skillId, level: row.level })),
            lines: freezeLines(lines),
          });
        }
        // 兜底：无账目产出的结算（cycles=0 早退）也要终结在线段残留（「闭段于…离线」）。
        closeAllSections();
        return;
      }
      case 'rebirth': {
        // 兵解：闭全部开放段（兵解前行为留痕）→ 篇章标记条目。锚点清与计数器保留
        // 归字段表（journalAnchor transient 硬绑清；journal/counters 资产 default-keep）。
        flushPending();
        closeAllSections();
        push({
          kind: 'rebirth',
          seq: nextSeq(),
          t0: deps.now(),
          t1: deps.now(),
          daoYun: event.data.daoYun,
          totalXp: event.data.totalXp,
          rebirths: event.data.rebirths,
        });
        return;
      }
      case 'tick': {
        flushPending();
        return;
      }
      default:
        return;
    }
  };
}
