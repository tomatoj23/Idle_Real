import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REJECT_MATRIX } from '@wendao/engine';
import { loadFantasyPack } from '@wendao/content/packs/fantasy';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';

/**
 * reject 键域覆盖对照（#75 项 4）：引擎 REJECT_MATRIX（emit 点经逐动作
 * 泛型签名编译收口的枚举）↔ 文本包 texts.reject 键双向对拍——
 *
 * - 正向：矩阵每一对 (action, reason) 必须解析到文案（精确动作 → '*'
 *   兜底，与 rejectText 命中序同律），否则运行时静默回落键名回显
 *   `{action}/{reason}`（texts.schema 自认的哑弹，玩家可见）；
 * - 反向：包键必须是引擎真实可发的一对（'*' 行 = 任意动作有码即真），
 *   否则 = 手抄 typo 键（fantasy 包 `poor`/`locked` 案），永不命中。
 *
 * 放装配层测试（app-desktop）：这是 engine↔content 的键域缝——content
 * 不引 engine 纪律不动，对拍只能在两侧都可见的装配层做（protocolGuard
 * 各守一条缝，本文件守这条）。
 */
type RejectMap = Record<string, Record<string, string> | undefined>;

const entries = Object.entries(REJECT_MATRIX) as Array<[string, readonly string[]]>;
const pairs: Array<[string, string]> = entries.flatMap(([action, reasons]) =>
  reasons.map((reason): [string, string] => [action, reason]),
);
const reasonSet = new Set(entries.flatMap(([, reasons]) => [...reasons]));
const actionSet = new Map(entries.map(([action, reasons]) => [action, new Set(reasons)]));

for (const [packName, load] of [
  ['xiuxian', loadXiuxianPack],
  ['fantasy', loadFantasyPack],
] as const) {
  describe(`reject 覆盖对照 · ${packName}`, () => {
    const rejectMap: RejectMap =
      (load().texts as { reject?: RejectMap } | undefined)?.reject ?? {};

    it('正向：引擎枚举每一对 (action, reason) 都解析到文案（精确 → * 兜底）', () => {
      const missing = pairs
        .filter(([action, reason]) =>
          action === '*'
            ? !rejectMap['*']?.[reason]
            : !(rejectMap[action]?.[reason] ?? rejectMap['*']?.[reason]),
        )
        .map(([action, reason]) => `${action}/${reason}`);
      expect(missing, `缺文案（运行时将键名回显）：${missing.join(', ')}`).toEqual([]);
    });

    it('反向：包键全部命中引擎枚举（typo 键 = 永不命中的哑键）', () => {
      const orphans: string[] = [];
      for (const [action, reasons] of Object.entries(rejectMap)) {
        for (const reason of Object.keys(reasons ?? {})) {
          const legit = action === '*' ? reasonSet.has(reason) : actionSet.get(action)?.has(reason);
          if (!legit) orphans.push(`${action}/${reason}`);
        }
      }
      expect(orphans, `哑键（引擎永不发此码）：${orphans.join(', ')}`).toEqual([]);
    });
  });
}

/**
 * 矩阵 ↔ emit 点双向对拍（#75 复审收口）：点 → 行有编译腿（reject() 逐动作
 * 泛型签名），行 → 点此前无守卫——行内冗余码（emit 点已删/改）会留永不触发
 * 的死码与陪葬文案。TS 类型运行期擦除，清单守卫必须读源码（protocolGuard
 * 先例）：扫引擎源码的 reject 调用点字面量码，与矩阵全码集两向比对。
 *
 * 粒度与局限（复审勘定）：按**平铺码集**对照——跨行搬码（码仍在别处发）
 * 本测试不红，由上方包键反向对照兜（包键须命中矩阵 (action, reason) 对，
 * 行搬走即哑键红）；扫描先剥注释再匹配（防文档示例污染）；引擎 src 目录
 * 布局耦合（子目录新增即漏扫 → 行→点误红，响亮失败非静默）。
 */
describe('REJECT_MATRIX ↔ emit 点对拍（源码扫描）', () => {
  const engineSrcDir = fileURLToPath(new URL('../../engine/src/', import.meta.url));
  const src = readdirSync(engineSrcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(engineSrcDir + f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // 码的两种字面量形态：reject() 调用第二参（逐动作位）+ 拒绝事件构造的
  // reason: '...'（rejectUnknown 唯一松口出口的固定码）。
  const emitted = new Set(
    [
      ...[...src.matchAll(/\breject\s*\(\s*[^,()]+,\s*'([a-z-]+)'/g)].map((m) => m[1] as string),
      ...[...src.matchAll(/\breason:\s*'([a-z-]+)'/g)].map((m) => m[1] as string),
    ],
  );

  it('行 → 点：矩阵每码都有真实 emit 点（冗余死码 = 红）', () => {
    const stale = entries.flatMap(([, reasons]) => reasons.filter((r) => !emitted.has(r)));
    expect(stale, `矩阵冗余码（无 emit 点）：${stale.join(', ')}`).toEqual([]);
  });

  it('点 → 行：emit 点每码都在矩阵（越域散码 = 红；编译腿的运行期复核）', () => {
    const strays = [...emitted].filter((c) => !reasonSet.has(c));
    expect(strays, `emit 点越域码（矩阵未登记）：${strays.join(', ')}`).toEqual([]);
  });
});
