/**
 * 测试夹具单点（#74 项 10）：真包（修仙）入 store 的统一入口。
 *
 * createStore → loadPack 内部 structuredClone 深拷——store 独占编辑副本，
 * 夹具常量不受用例内编辑污染，无需调用方手写 JSON 深拷（旧 19 处
 * `createStore(xiuxianPackJson)` 手写 + 3 处冗余深拷收编于此）。
 */

import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { createStore, type EditorStore } from '../src/core/state.js';

export function xiuxianStore(): EditorStore {
  return createStore(xiuxianPackJson);
}

/**
 * 跨引用闭合的测试敌人夹具（#56）：kind/drops 缺省引用真包既有域（入包
 * 即合法）；dropItem 传悬空 id（ghost_item 类）即得「节级零错、整包语义
 * 拦截」的事务门禁试验品。llm-pipeline / llm-panel 两处共用，勿再手抄
 * 整套敌人 JSON（评审收口：DANGLING_DROP_REPLY 手写形态退役）。
 */
export function testEnemy(id: string, name: string, dropItem: string): Record<string, unknown> {
  return {
    id,
    name,
    icon: '测',
    level: 1,
    kind: 'claw',
    hp: 40,
    atk: 8,
    def: 2,
    attackInterval: 2400,
    exp: 10,
    gold: { min: 1, max: 3 },
    drops: [{ item: dropItem, chance: 0.3 }],
  };
}
