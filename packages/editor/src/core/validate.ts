/**
 * 用户可见校验面的合并校验入口（#100）：整包校验 + 带 schema 错包补语义面。
 *
 * validateContentPack 在 schema 错误存在时提前返回（防噪音级联的既有裁决），
 * 错误集只含 schema 面——存量语义错（如手动改 item id 产生的悬空引用）在
 * 校验面板红条与导出确认计数两处不可见，直到 schema 错全部修净才集中现形；
 * 而 LLM 入包门禁对同一状态能拦语义新增，三面不一致。本入口对 !ok 包补跑
 * 独立语义入口（validatePackSemantics：对任意包安全执行、schema 净包恒返回
 * 空集），按错误身份（path/keyword/message 全同即同一错误）去重合并：
 * - schema 破包：语义面并入补齐（两关键字域不相交，无意外折叠）；
 * - 仅语义错包（schema 净）：语义面已含于整包结果，身份去重后零增量（防双计，
 *   729e7b6 在入包门禁修过同款重复计入）；
 * - 干净包：短路返回（语义入口不跑，行为零变化）。
 *
 * 消费方：校验面板（ui/panel.ts）与导出确认（main.ts confirmExportDespiteErrors）。
 * 入包门禁不走此入口——pipeline.ts 的差集对照语义自带基准合并（#94）。
 */

import { validateContentPack, validatePackSemantics, type ContentError } from '@wendao/content';

export interface VisibleValidation {
  ok: boolean;
  /** 合并后的错误集（ok 恒空集；schema 破包 = schema 面 + 补齐的语义面）。 */
  errors: readonly ContentError[];
  /** schema 破包形态下并入的语义错条数；仅语义错包恒 0（已含于整包结果）。 */
  extraSemantic: number;
}

/** 错误身份键（path/keyword/message 全同即同一错误；pipeline.ts 差集同用此单点）。 */
export function errorKeyOf(error: ContentError): string {
  return `${error.path}\u001F${error.keyword}\u001F${error.message}`;
}

export function visibleValidation(pack: Record<string, unknown>): VisibleValidation {
  const result = validateContentPack(pack);
  if (result.ok) {
    return { ok: true, errors: [], extraSemantic: 0 };
  }
  const merged = new Map<string, ContentError>();
  for (const error of result.errors) {
    merged.set(errorKeyOf(error), error);
  }
  const schemaCount = merged.size;
  for (const error of validatePackSemantics(pack)) {
    merged.set(errorKeyOf(error), error);
  }
  return { ok: false, errors: [...merged.values()], extraSemantic: merged.size - schemaCount };
}
