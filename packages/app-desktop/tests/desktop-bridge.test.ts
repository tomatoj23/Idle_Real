// @vitest-environment node
/**
 * #10 验收：renderer 桌面桥接层——
 * - 桥形状防御：window.wendao 缺失/形状不符 = 纯浏览器模式（undefined）；
 * - desktopSaveAdapter：经桥的槽位读（坏档 null）/写/同步 flush；
 * - 成就上报管道：引擎事件流 achievement:unlock → 桥上报（其余事件零搬运）。
 */
import { describe, expect, it } from 'vitest';
import { EventBus, type SaveData } from '@wendao/engine';
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

describe('#10 · 事件流 → 成就上报管道', () => {
  it('achievement:unlock 携带 id → 上报；其余事件/缺 id 零搬运', () => {
    const bridge = fakeBridge();
    const bus = new EventBus();
    const unsubscribe = wireAchievementReporting(bus, bridge);
    bus.emit({ type: 'tick', time: 0, data: { dt: 250 } });
    bus.emit({ type: 'achievement:unlock', time: 1, data: { id: 'cycles_100', name: 'x' } });
    bus.emit({ type: 'achievement:unlock', time: 2 }); // 缺 id：不上报
    expect(bridge.reports).toEqual(['cycles_100']);
    unsubscribe();
    bus.emit({ type: 'achievement:unlock', time: 3, data: { id: 'first_kill' } });
    expect(bridge.reports).toEqual(['cycles_100']);
  });
});
