import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sectionSchemas, validateContent } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { textsSample } from '../src/schema/textsSample.js';

/**
 * 协议同形守卫（#43，C4 架构评审产物）：ADR-015 三处同步里 types.ts 这条腿
 * 此前零测试零编译检查（ShellEvents 漏 5 个 dungeon 键漂移在案）。
 *
 * - texts 双钉样本：textsSample 以 TextsSection 静态标注（编译腿在
 *   `npm run check` 的 tsc -b 上，样本居 src/ 正为此）+ 本文件运行期强校验
 *   （schema 腿）。两腿同一样本，types↔schema 谁漂移谁红。
 *   变异自测（验收 1，逐项人工验证后还原）：
 *   ① 样本删任一 required 键 → tsc -b 红（missing property）；
 *   ② schema 加 types 没有的 required 键 → 本文件运行红（样本写不出该键）；
 *   ③ types 多 schema 外键且样本携带 → 运行红（additionalProperties）。
 * - 导出面守卫：src/index.ts 手工镜像 src/schema/index.ts（刻意不用
 *   export *），抽两份源码的 export 标识符比对（TS 类型运行期擦除，清单
 *   守卫必须读源码）；两清单不一致即红。
 */

describe('#43 · texts 双钉样本（types↔schema 同形）', () => {
  it('样本过 texts.schema 强校验（schema 腿：required 增而样本缺 / 样本带 schema 外键 → 此红）', () => {
    const result = validateContent(textsSample, sectionSchemas.texts);
    expect(
      result.ok,
      JSON.stringify(result.ok ? [] : result.errors.map((e: ContentError) => `${e.path} [${e.keyword}]`)),
    ).toBe(true);
  });
});

/* ==================== 导出面清单一致守卫 ==================== */

/** 从一份 index.ts 源码抽 export 标识符（值导出与类型导出分两组）。 */
function extractExports(source: string): { values: string[]; types: string[] } {
  const values: string[] = [];
  const types: string[] = [];
  const block = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"];?/g;
  for (const m of source.matchAll(block)) {
    const isType = m[1] !== undefined;
    for (const raw of m[2].split(',')) {
      const name = raw.trim();
      if (name !== '') {
        (isType ? types : values).push(name);
      }
    }
  }
  return { values, types };
}

const schemaSurfaceSource = readFileSync(new URL('../src/schema/index.ts', import.meta.url), 'utf8');
const mainSurfaceSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const schemaSurface = extractExports(schemaSurfaceSource);
const mainSurface = extractExports(mainSurfaceSource);

describe('#43 · 导出面清单一致守卫（src/index.ts ↔ src/schema/index.ts）', () => {
  it('抽取非空（正则失配时大声失败，不静默放行）', () => {
    expect(schemaSurface.values.length).toBeGreaterThan(0);
    expect(schemaSurface.types.length).toBeGreaterThan(0);
    expect(mainSurface.values.length).toBeGreaterThan(0);
    expect(mainSurface.types.length).toBeGreaterThan(0);
  });

  it('值导出清单一致', () => {
    expect([...mainSurface.values].sort()).toEqual([...schemaSurface.values].sort());
  });

  it('类型导出清单一致（镜像漂移 → 此红）', () => {
    expect([...mainSurface.types].sort()).toEqual([...schemaSurface.types].sort());
  });

  it('两份入口均禁 export *（清单守卫的前提：双方同时改用 export * 会让清单比对失义；src/index.ts 头注所述约定）', () => {
    // 锚定行首：头注释里字面提及 "export *" 不算违例。
    expect(schemaSurfaceSource).not.toMatch(/^export\s+\*/m);
    expect(mainSurfaceSource).not.toMatch(/^export\s+\*/m);
  });
});
