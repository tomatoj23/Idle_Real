/**
 * 桌面桥接层（#10）：renderer 侧组装桌面平台能力。
 *
 * preload（electron/preload.cjs）向 window 注入 `wendao` 面；缺失/形状不符 =
 * 纯浏览器模式（vite dev 直开 / happy-dom 测试），全部回落 web 行为——壳的
 * 引导链单一，桌面差异收敛在此模块。
 *
 * 成就上报管道：判定在引擎（#9 evaluateAchievements），此处只做事件搬运——
 * 订阅引擎事件流，`achievement:unlock` 事件 → 平台上报（id 即 Steam 成就
 * API 名约定，见 electron/platform.ts）。挂载时机须早于 settleOffline
 * （启动欠账结算即可触发解锁，main.ts 保证顺序）。
 */
import {
  createHoldLatch,
  decodeSave,
  type EventBus,
  type GameEvent,
  type SaveAdapter,
  type SaveAdapterOptions,
  type SaveData,
} from '@wendao/engine';

/** preload 暴露的桥面（window.wendao 的形状契约）。 */
export interface DesktopBridge {
  readonly mode: 'mock' | 'steam';
  /** 同步读槽位；无档 null。返回原始 JSON 串。 */
  loadSave(key: string): string | null;
  /** 异步写槽位（周期自动保存路径）。 */
  writeSave(key: string, json: string): void;
  /** 同步写槽位（关闭即保存兜底：退出竞态下异步 send 可能不达主进程）。 */
  flushSave(key: string, json: string): void;
  /** 成就上报（平台侧幂等）。 */
  reportAchievement(id: string): void;
}

/** 桥形状防御：逐字段校验，非桌面环境/半残桥一律 undefined。 */
export function desktopBridgeOf(): DesktopBridge | undefined {
  const raw = (globalThis as { wendao?: unknown }).wendao;
  if (raw === null || typeof raw !== 'object') return undefined;
  const bridge = raw as Partial<DesktopBridge>;
  if (bridge.mode !== 'mock' && bridge.mode !== 'steam') return undefined;
  const methods = [bridge.loadSave, bridge.writeSave, bridge.flushSave, bridge.reportAchievement];
  if (methods.some((method) => typeof method !== 'function')) return undefined;
  return bridge as DesktopBridge;
}

/**
 * 桥 → engine SaveAdapter（附 flushSync 供 beforeunload 关闭即保存）。
 *
 * 坏档处理与 localStorageSaveAdapter 同律（#69 项 3）：解析与形状/版本门禁、
 * 以及「异型档保住槽位」的闩全在引擎侧（decodeSave / createHoldLatch）——
 * 主进程守得住 fs 故障那一层，档字节这一层只有 renderer 看得见，两边各守各的。
 */
export function desktopSaveAdapter(
  key: string,
  bridge: DesktopBridge,
  options: SaveAdapterOptions = {},
): SaveAdapter & { flushSync(data: SaveData): void } {
  const report = options.onProblem;
  const latch = createHoldLatch(key, report);
  return {
    load(): SaveData | null {
      let raw: string | null;
      try {
        raw = bridge.loadSave(key);
      } catch (err) {
        // 桥/通道故障：槽位字节一眼都没见到，不碰保槽态（与 localStorageSaveAdapter
        // 的 getItem 分支同律——无从证明有货就把存档能力钉死，是更坏的降级）。
        // 错误归一就地写而不引 errMsg：那位在 electron 主进程模块里（含 node:fs，
        // renderer 引不到），为一行三元式跨包开面不值。
        report?.(`desktop bridge read failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
      const decoded = decodeSave(typeof raw === 'string' ? raw : null, report);
      if (decoded.holdSlot) latch.engage();
      else latch.release();
      return decoded.save;
    },
    save(data: SaveData): void {
      if (latch.refuses()) return;
      bridge.writeSave(key, JSON.stringify(data));
    },
    flushSync(data: SaveData): void {
      if (latch.refuses()) return;
      bridge.flushSave(key, JSON.stringify(data));
    },
  };
}

/** 引擎事件流 → 平台成就上报。返回退订函数。 */
export function wireAchievementReporting(
  events: Pick<EventBus, 'subscribe'>,
  bridge: DesktopBridge,
): () => void {
  return events.subscribe((event: GameEvent) => {
    // #47 判别联合：type 收窄后载荷字段类型化读（手工二次校验退役）；链上
    // 保留 `?.`——EventBus 是公共面，协议外畸形事件（如 desktop-bridge.test
    // 钉的缺 data 场景）保持「静默不上报」而非 throw 被总线吞掉。
    if (event.type !== 'achievement:unlock') return;
    const id = event.data?.id;
    if (typeof id === 'string' && id.length > 0) bridge.reportAchievement(id);
  });
}
