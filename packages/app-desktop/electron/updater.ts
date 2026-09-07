/**
 * 自动更新占位（#10 票面「自动更新占位」）：接缝先立，依赖后接。
 *
 * 渠道定版前的克制：Steam 发行时更新归 Steam 客户端托管；独立 NSIS 安装包
 * 分发才需要 electron-updater（引入 feed 配置与签名设施，随渠道决策另票）。
 * 此处只提供生命周期挂点，主进程启动时调用。
 */
export type Logger = (message: string) => void;

export function initAutoUpdate(log: Logger): void {
  log('[updater] placeholder: 自动更新未接线（electron-updater 待分发渠道定版后接入，#10）');
}
