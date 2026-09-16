/**
 * 页面注册表协议（#46 架构评审二轮·卡1）：PageView 条目 + 渲染上下文 + 装配环境。
 *
 * - D2：ctx = { st, snap, content, T } 每次渲染现建；动作后由页面经壳核服务
 *   显式 render()（搬迁不改行为）；
 * - D4：注册表只管本页动作——导航/顶栏动作留壳核，页面仅经 dispatch/render/nav
 *   三个服务触壳；
 * - D11：页面 label 存 texts.shell 文案键，解析归壳核（文案归 content 义务不变）。
 */
import type { ContentPack, Item, Modifier, Skill } from '@wendao/content';
import type {
  DungeonView,
  GameAction,
  GameState,
  ProgressionParams,
  RebirthSectionView,
  SaveData,
} from '@wendao/engine';

export type TabId =
  | 'skills'
  | 'craft'
  | 'combat'
  | 'dungeon'
  | 'bag'
  | 'shop'
  | 'rebirth'
  | 'talents'
  | 'achievements'
  | 'journal';

/** texts.shell 取词 + {slot} 填槽（缺键回显键名，防御可见）。 */
export type ShellText = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/** 渲染上下文（D2）：每次渲染现建，页面不自持快照。 */
export interface PageCtx {
  readonly st: GameState;
  readonly snap: SaveData;
  readonly content: ContentPack;
  readonly T: ShellText;
}

/**
 * 装配环境：壳核构建的词表/查表/格式化单件（#26 同源）+ 壳核服务。
 * 页面工厂闭包捕获，渲染期只读；引擎视图/公式一律页面直调 engine，不过环境。
 */
export interface PageEnv {
  readonly content: ContentPack;
  readonly T: ShellText;
  /** texts.shell 原始节读取（非字符串值如统计图谱表；缺键 undefined）。 */
  readonly shellRaw: (path: string) => unknown;
  /** 展示 locale（brand.locale，非法值中性回落 'en'）。 */
  readonly locale: string;
  /** 修为曲线参数（progressionParamsOf，与内容包同源）。 */
  readonly prog: ProgressionParams;
  readonly itemById: ReadonlyMap<string, Item>;
  /** 物品展示名（缺档回显 id）。 */
  readonly nameOf: (id: unknown) => string;
  /** 面板数值 + 量纲后缀（顶栏/敌卡属性行）。 */
  readonly statValueText: (stat: string, value: number | string) => string;
  /** 加成行「标签+值+量纲」（装备卡基础/词条行）。 */
  readonly statBonusText: (stat: string, value: number | string) => string;
  /** 秒时长读数（units.seconds 模板）。 */
  readonly fmtSeconds: (ms: number) => string;
  /** 系别展示名（elements 注册表数据直出）。 */
  readonly elementNameOf: (id: string) => string;
  /** 铭纹修饰符行文本。 */
  readonly inscModText: (mod: Modifier) => string;
  /** 稀有度着色类（r-<档 id>，缺档 r-none）。 */
  readonly rarityClass: (rarity: string) => string;
  readonly gatherSkills: readonly Skill[];
  readonly craftSkills: readonly Skill[];
  /** 斗法修为技能 id（包无 combat 技能 = 空串）。 */
  readonly combatSkillId: string;
  readonly dungeonList: readonly DungeonView[];
  readonly rebirthSection: RebirthSectionView | undefined;
  /** 器屑经济可用性（config.gear.shardItem 未配置 = 无熔炼/重铸）。 */
  readonly canSmelt: boolean;
  /** 页面挂载点（innerHTML 由壳核写入；update 差量刷新查询用）。 */
  readonly pageEl: HTMLElement;
  /** 引擎动作下发（bindActions 前静默丢弃，与事件委托同律）。 */
  dispatch(action: GameAction): void;
  /** 强制全页重绘（选中态/撤防等纯 UI 状态变化；等价 click 路径的 lastSig=''+render()）。 */
  render(): void;
  /** 页内动作请求换页（dungeon-enter 入门即切秘境页；含 visit 转发与撤防语义）。 */
  nav(tab: TabId): void;
}

/**
 * 页面视图条目（D2）。update 为选择性刷新器（D3：实况轻量刷新归页，
 * #50 渲染管线深化将落在页级 update 上，保持可扩展）；handleAction 只收本页动作。
 */
export interface PageView {
  readonly id: TabId;
  /** texts.shell 页签文案键（D11：注册表存键，壳核经 T 解析）。 */
  readonly label: string;
  /** 全量渲染出 HTML 串（壳核挂载 + 战斗日志重放）。 */
  render(ctx: PageCtx): string;
  /** 每帧差量刷新（进度条/血条等实况区；签名不变时的轻量路径）。 */
  update?(ctx: PageCtx): void;
  /** 本页动作分发（action = data-act 值，target = 动作元素）。 */
  handleAction?(action: string, target: HTMLElement): void;
  /** 换页即撤防（#6 兵解确认不跨页存续——rebirth 页实现，行为保持）。 */
  deactivate?(): void;
}
