// @vitest-environment node
/**
 * #10 验收：renderer 桌面桥接层——
 * - 桥形状防御：window.wendao 缺失/形状不符 = 纯浏览器模式（undefined）；
 * - desktopSaveAdapter：经桥的槽位读（坏档 null）/写/同步 flush；
 * - 成就上报管道：引擎事件流 achievement:unlock → 桥上报（其余事件零搬运）。
 */
import { describe, expect, it } from 'vitest';
import { EventBus, SAVE_VERSION, type GameEvent, type SaveData } from '@wendao/engine';
import {
  desktopBridgeOf,
  desktopSaveAdapter,
  wireAchievementReporting,
  type DesktopBridge,
} from '../src/desktop';

function fakeBridge(mode: 'mock' | 'steam' = 'mock'): DesktopBridge & {
  loads: string[];
  saves: Array<{ key: string; json: string }>;
  flushes: string[];
  reports: string[];
} {
  return {
    mode,
    loads: [],
    saves: [],
    flushes: [],
    reports: [],
    loadSave(key: string): string | null {
      this.loads.push(key);
      return null;
    },
    writeSave(key: string, json: string): void {
      this.saves.push({ key, json });
    },
    flushSave(key: string, json: string): void {
      this.flushes.push(key);
      void json;
    },
    reportAchievement(id: string): void {
      this.reports.push(id);
    },
  };
}

function setGlobalWendao(value: unknown): void {
  (globalThis as { wendao?: unknown }).wendao = value;
}

describe('#10 · 桥形状防御 desktopBridgeOf', () => {
  it('无 wendao / 非对象 → undefined（纯浏览器模式）', () => {
    setGlobalWendao(undefined);
    expect(desktopBridgeOf()).toBeUndefined();
    setGlobalWendao('nonsense');
    expect(desktopBridgeOf()).toBeUndefined();
  });

  it('形状不符（缺方法/坏 mode）→ undefined，不产半残桥', () => {
    setGlobalWendao({ mode: 'bogus', loadSave: () => null });
    expect(desktopBridgeOf()).toBeUndefined();
    setGlobalWendao({ mode: 'mock', loadSave: 'not-a-function' });
    expect(desktopBridgeOf()).toBeUndefined();
  });

  it('形状完备 → 返回桥', () => {
    const bridge = fakeBridge();
    setGlobalWendao(bridge);
    expect(desktopBridgeOf()).toBe(bridge);
    setGlobalWendao(undefined);
  });
});

describe('#10 · desktopSaveAdapter', () => {
  it('save → 桥收 JSON 串；load null → null；坏档 JSON → null', () => {
    const bridge = fakeBridge();
    const adapter = desktopSaveAdapter('slot', bridge);
    const save = { version: 1, time: 7, state: { gold: 1 } } as unknown as SaveData;
    adapter.save(save);
    expect(bridge.saves).toEqual([{ key: 'slot', json: JSON.stringify(save) }]);

    expect(adapter.load()).toBeNull();
    setGlobalWendao(undefined);

    const corrupt = fakeBridge();
    corrupt.loadSave = () => '{broken';
    expect(desktopSaveAdapter('slot', corrupt).load()).toBeNull();
  });

  it('flushSync 走同步通道（关闭即保存兜底）', () => {
    const bridge = fakeBridge();
    const adapter = desktopSaveAdapter('slot', bridge);
    const save = { version: 1, time: 1, state: {} } as unknown as SaveData;
    adapter.flushSync(save);
    expect(bridge.flushes).toEqual(['slot']);
  });
});

describe('#69 · desktopSaveAdapter 诊断面与坏档保槽', () => {
  /** 桥固定回一段字节（null = 无档）。 */
  function bridgeWith(payload: string | null): ReturnType<typeof fakeBridge> {
    const bridge = fakeBridge();
    bridge.loadSave = () => payload;
    return bridge;
  }

  it('碎片档：load 仍 null（不回归）+ 诊断说原因，写通道照常（碎片不值得永久断档）', () => {
    const problems: string[] = [];
    const bridge = bridgeWith('{broken');
    const adapter = desktopSaveAdapter('slot', bridge, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();
    expect(problems.join('\n')).toMatch(/parse/);

    adapter.save({ version: SAVE_VERSION, time: 0, state: {} });
    adapter.flushSync({ version: SAVE_VERSION, time: 0, state: {} });
    expect(bridge.saves).toHaveLength(1);
    expect(bridge.flushes).toEqual(['slot']);
    expect(problems.some((m) => /refus/i.test(m))).toBe(false);
  });

  it('异型档保槽：save 与 flushSync 两条写通道都不许过桥，且只报一次', () => {
    const problems: string[] = [];
    const bridge = bridgeWith(JSON.stringify({ version: 2, time: 0, state: { gold: 1 } }));
    const adapter = desktopSaveAdapter('slot', bridge, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();
    expect(problems.join('\n')).toMatch(/version 2/); // 拒绝原因指名版本

    adapter.save({ version: SAVE_VERSION, time: 0, state: {} });
    adapter.flushSync({ version: SAVE_VERSION, time: 0, state: {} });
    adapter.save({ version: SAVE_VERSION, time: 1, state: {} });
    expect(bridge.saves).toEqual([]);
    expect(bridge.flushes).toEqual([]);
    expect(problems.filter((m) => /refus/i.test(m))).toHaveLength(1);
  });

  it('保槽非单向棘轮：桥上的字节换成合法档后写通道恢复', () => {
    const bridge = bridgeWith(JSON.stringify({ version: 2, time: 0 }));
    const adapter = desktopSaveAdapter('slot', bridge, { onProblem: () => {} });
    expect(adapter.load()).toBeNull();
    adapter.save({ version: SAVE_VERSION, time: 0, state: {} });
    expect(bridge.saves).toEqual([]);

    bridge.loadSave = () => JSON.stringify({ version: SAVE_VERSION, time: 3, state: {} });
    expect(adapter.load()?.version).toBe(SAVE_VERSION);
    adapter.save({ version: SAVE_VERSION, time: 4, state: {} });
    expect(bridge.saves).toHaveLength(1);
  });

  it('合法档往返不回归：零诊断、写正常过桥', () => {
    const payload: SaveData = { version: SAVE_VERSION, time: 4, state: { gold: 2 } };
    const problems: string[] = [];
    const bridge = bridgeWith(JSON.stringify(payload));
    const adapter = desktopSaveAdapter('slot', bridge, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toEqual(payload);
    adapter.save(payload);
    expect(bridge.saves).toEqual([{ key: 'slot', json: JSON.stringify(payload) }]);
    expect(problems).toEqual([]);
  });

  it('无档（桥回 null）与旧语义一致：零诊断、直接可写', () => {
    const problems: string[] = [];
    const bridge = bridgeWith(null);
    const adapter = desktopSaveAdapter('slot', bridge, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();
    adapter.save({ version: SAVE_VERSION, time: 0, state: {} });
    expect(bridge.saves).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it('桥本身抛错（IPC 通道故障）：诊断 + 不保槽（无从证明槽位有货）；不传诊断也不崩', () => {
    const problems: string[] = [];
    const bridge = bridgeWith(null);
    bridge.loadSave = () => {
      throw new Error('ipc dead');
    };
    const adapter = desktopSaveAdapter('slot', bridge, { onProblem: (m) => problems.push(m) });
    expect(adapter.load()).toBeNull();
    expect(problems.join('\n')).toMatch(/ipc dead/);
    adapter.save({ version: SAVE_VERSION, time: 0, state: {} });
    expect(bridge.saves).toHaveLength(1);

    expect(desktopSaveAdapter('slot', bridge).load()).toBeNull();
  });
});

describe('#10 · 事件流 → 成就上报管道', () => {
  it('achievement:unlock 携带 id → 上报；其余事件/缺 id 零搬运', () => {
    const bridge = fakeBridge();
    const bus = new EventBus();
    const unsubscribe = wireAchievementReporting(bus, bridge);
    bus.emit({ type: 'tick', time: 0, data: { dt: 250 } });
    bus.emit({ type: 'achievement:unlock', time: 1, data: { id: 'cycles_100', name: 'x' } });
    bus.emit({ type: 'achievement:unlock', time: 2 } as unknown as GameEvent); // 缺 id：不上报
    expect(bridge.reports).toEqual(['cycles_100']);
    unsubscribe();
    bus.emit({ type: 'achievement:unlock', time: 3, data: { id: 'first_kill' } } as GameEvent);
    expect(bridge.reports).toEqual(['cycles_100']);
  });
});
