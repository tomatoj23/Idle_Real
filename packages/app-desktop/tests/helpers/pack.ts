/**
 * 内容包夹具单点（#76 项 1）：手写 makePack 副本的公共段收敛于此——
 * 空包骨架（11 个空节 + `as unknown as ContentPack` 既定绕行）与壳文案
 * 固定段（brand/topbar/units/icons：各副本逐字同款的四节）。
 *
 * 覆盖口径 = 整段替换（不深合并）：副本里 tabs/common 等段的键集多寡
 * （floaters 只 2 个 tab、boss 8 个）是被测形状的一部分，深合并会把它
 * 们补齐成基形状、动了夹具语义。overrides 松型同理——夹具经
 * `as unknown as` 绕形状检查是既定口径（#38 的形状钉见 skillsTexts）。
 */
import type { ContentPack, ShellTexts } from '@wendao/content';

/** pages.skills 文案键集形状钉（#38 复核补盲）：mock 经 `as unknown as ContentPack` 绕过形状检查，键集漂移靠此 tsc 红。 */
export const skillsTexts = (v: ShellTexts['pages']['skills']): ShellTexts['pages']['skills'] => v;

/** 壳文案固定段包：brand/topbar/units/icons 四节单源，其余段按需整段覆盖。 */
export function makeShellTexts(overrides: Record<string, unknown> = {}): ShellTexts {
  return {
    brand: { sigil: '道', name: '试炼', locale: 'zh-CN', bootError: '中止：{message}' },
    topbar: {
      statsTitle: '属',
      statsSigil: '斗',
      goldTitle: '灵石',
      goldSigil: '石',
      hpTitle: '气血',
      hpSigil: '血',
    },
    units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
    icons: { buff: '丹', gear: '器', unknown: '？' },
    tabs: {},
    stats: { labels: {} },
    events: {},
    pages: {},
    ...overrides,
  } as unknown as ShellTexts;
}

/** 空包骨架 + 节级覆盖：调用方只写非空节（缺省节 = 空数组/空对象）。 */
export function makePack(overrides: Record<string, unknown> = {}): ContentPack {
  return {
    skills: [],
    items: [],
    recipes: [],
    enemies: [],
    gearDrops: [],
    elements: [],
    rarities: [],
    affixPool: [],
    combatText: {},
    texts: { shell: makeShellTexts() },
    shop: [],
    ...overrides,
  } as unknown as ContentPack;
}
