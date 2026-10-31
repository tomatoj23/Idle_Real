// @vitest-environment happy-dom
/**
 * 存档管理服务（#62 P1-1；审计 20261031-191624 F2/F4/N1 修复面）：
 * - 门禁前置：坏密文 → false，不写不重载；
 * - F2：保槽闩静默拒写 → 写后回读拦截，报失败不重载（假成功清零）；
 * - F4：成功路径先 autoSave.stop 摘 pagehide flush 再重载（导入档不被当前局覆掉）；
 * - 机制回归钉：闩拒写语义与 pagehide 覆写语义（引擎 save.ts 侧，服务修复的存在依据）。
 */
import { describe, expect, it } from 'vitest';
import {
  attachAutoSave,
  createGame,
  localStorageSaveAdapter,
  ManualClock,
  type SaveAdapter,
  type SaveData,
} from '@wendao/engine';
import { SAVE_KEY } from '../src/saveKey';
import { createSaveService, decodeSaveCipher, encodeSaveText } from '../src/saveService';

const FOREIGN_SAVE = JSON.stringify({ version: 999, time: 0, state: { gold: 1 } });
const VALID_SAVE: SaveData = { version: 2, time: 42, state: { gold: 777 } };

/** 服务夹具：写槽/stop/reload 全记录（calls 序断言用）。 */
function makeHarness(adapter: SaveAdapter) {
  const calls: string[] = [];
  const game = createGame({ content: {}, seed: 1 });
  const service = createSaveService({
    snapshot: () => game.snapshot(),
    adapter: {
      ...adapter,
      flushSync: (data) => {
        calls.push('write');
        adapter.save(data);
      },
    },
    autoSave: {
      stop: () => {
        calls.push('stop');
      },
    },
    reload: () => {
      calls.push('reload');
    },
  });
  return { service, calls, game };
}

function memoryAdapter(): SaveAdapter {
  let current: SaveData | null = null;
  return {
    load: () => current,
    save: (data) => {
      current = data;
    },
  };
}

describe('#62 审计修复 · 存档管理服务', () => {
  it('坏密文 → false：不写槽、不 stop、不重载（门禁前置）', () => {
    const { service, calls } = makeHarness(memoryAdapter());
    expect(service.importText('not-base64!!!')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('F2：保槽闩静默拒写 → 回读拦截，false + 不重载 + 异版本字节原样', () => {
    localStorage.setItem(SAVE_KEY, FOREIGN_SAVE);
    const adapter = localStorageSaveAdapter(SAVE_KEY);
    expect(adapter.load()).toBeNull(); // 闩上
    const { service, calls } = makeHarness(adapter);
    expect(service.importText(encodeSaveText(VALID_SAVE))).toBe(false);
    expect(calls).toEqual(['write']); // 写了但被闩拒——回读拦截
    expect(calls).not.toContain('reload');
    expect(localStorage.getItem(SAVE_KEY)).toBe(FOREIGN_SAVE); // 异版本字节未被覆
  });

  it('成功路径：写入=回读一致 → 先 stop 后 reload（F4 序），槽=导入档', () => {
    localStorage.removeItem(SAVE_KEY);
    const adapter = localStorageSaveAdapter(SAVE_KEY);
    const { service, calls } = makeHarness(adapter);
    expect(service.importText(encodeSaveText(VALID_SAVE))).toBe(true);
    expect(calls).toEqual(['write', 'stop', 'reload']);
    expect(adapter.load()?.state).toEqual({ gold: 777 });
  });

  it('F4 机制回归钉：pagehide → autoSave.flush 用当前局覆槽（stop 摘除后不再发生）', () => {
    const game = createGame({ content: {}, seed: 1 });
    const writes: SaveData[] = [];
    const spy: SaveAdapter = {
      load: () => null,
      save: (data) => {
        writes.push(data);
      },
    };
    const autoSave = attachAutoSave(game, spy, 3_600_000);
    spy.save(VALID_SAVE); // 导入写槽
    window.dispatchEvent(new Event('pagehide'));
    expect(writes[writes.length - 1]).not.toBe(VALID_SAVE); // 未摘监=被当前局覆掉
    autoSave.stop(); // 修复路径：导入成功先 stop
    spy.save(VALID_SAVE);
    window.dispatchEvent(new Event('pagehide'));
    expect(writes[writes.length - 1]).toBe(VALID_SAVE); // 摘监后 pagehide 不再覆写
  });

  it('exportText/saveNow 走快照与同步通道；密文编解码 roundtrip（中文含）', () => {
    // 钳钟（审计 F5）：snapshot.savedAt=clock.now()，两次取快照跨毫秒边界会
    // 使全串 toBe 偶红——ManualClock 定针后 roundtrip 比对确定。
    const clock = new ManualClock();
    const game = createGame({ content: {}, seed: 7, clock });
    const saved: SaveData[] = [];
    const service = createSaveService({
      snapshot: () => game.snapshot(),
      adapter: { load: () => null, save: (d) => void saved.push(d) },
      autoSave: { stop: () => {} },
      reload: () => {},
    });
    expect(decodeSaveCipher(service.exportText())).toBe(JSON.stringify(game.snapshot()));
    service.saveNow();
    expect(saved).toHaveLength(1);
    const utf8 = '密文中文✓';
    expect(decodeSaveCipher(encodeSaveText({ version: 2, time: 0, state: { k: utf8 } }))).toBe(
      JSON.stringify({ version: 2, time: 0, state: { k: utf8 } }),
    );
  });
});
