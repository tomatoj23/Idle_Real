/**
 * 存档夹具单点（#76 项 1）：手写 makeSave 副本的公共信封收敛于此。
 *
 * state 按 overrides 原样透传、刻意不归一化（各夹具的稀疏度、hp 值差异是
 * 测试语义的一部分）；收敛只动信封——版本号改挂 SAVE_VERSION 单源
 * （副本们此前硬编码 `version: 1`，与生产版本门禁各自为政）。
 */
import { SAVE_VERSION, type SaveData } from '@wendao/engine';

/** 最小存档信封：version/time 归一，state 由调用方按夹具原样给。 */
export function makeSave(state: Record<string, unknown> = {}): SaveData {
  return { version: SAVE_VERSION, time: 0, state };
}
