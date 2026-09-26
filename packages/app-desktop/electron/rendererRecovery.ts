/**
 * 渲染进程崩溃恢复判据（#71 三轮）：`render-process-gone` 的收法判别。
 *
 * 为什么渲染进程崩走 reload 而主进程崩必须退——两条相反的规则，同一个出处在
 * fatal.ts 头注（免得后人当成不一致）。一句话版：主进程对游戏态无状态（main.ts
 * 头注），渲染进程崩了重载 = 回到最近一次自动保存，安全；主进程崩后状态未知。
 *
 * 判据四条（票面设计节：缺一条就是下一个 bug）：
 * a. 只认非退出类 reason：clean-exit 是真退出，重载 = 关不掉的僵尸窗口；已销毁 /
 *    正在退出时也不动作（没有可重载的对象 / 退出链上的消失不是故障）。未知 reason
 *    （日后 Electron 新增）反而走重载路径——白窗永挂正是本模块要消灭的病，而 b
 *    的上限兜住失控。integrity-failure 单独走致命面：asar 被动过，重载也没用。
 * b. 重载有上限（RELOAD_LIMIT）且计数只在 dom-ready 成功载入后清零——按时间衰减
 *    对「秒崩」形态无效。到界升级进 fatal 的收尾，提示点名存档：一份让渲染进程在
 *    启动期崩坏的存档，每次 reload 都崩，无上限 = fatal.ts 明确拒绝的那个崩环，
 *    玩家永远到不了坏档恢复面。
 * c. 可恢复路径不弹模态（dialog.showErrorBox 阻塞主进程事件循环）：只落日志。
 *    只有升级路径才进 fatal 的弹窗。
 * d. unresponsive 只记不杀（接线在 main.ts）：放置游戏一次长同步 tick 就能误报，
 *    杀掉「卡但会自己好」的渲染进程，丢的正是下一次自动保存本该落下的进度。
 *
 * 划界（ADR-017）：零 electron 引用（同 navGuard/fatal 体例），退出/销毁谓词由
 * 装配方注入。`app.isQuitting()` 在 electron 38.8.6 并不存在（d.ts 无命中，勿按
 * 训练数据写）——main 侧自置 before-quit 标志喂进来。
 */

/** 与 electron.d.ts 38.8.6 的 RenderProcessGoneDetails.reason 同集。 */
export type GoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure';

export type RecoveryAction =
  | { readonly action: 'ignore' }
  | { readonly action: 'reload'; readonly attempt: number }
  | { readonly action: 'escalate' };

/** 连续重载上限（日志面 `reload n/3` 的分母与此同源）。 */
export const RELOAD_LIMIT = 3;

export interface RendererRecoveryDeps {
  /** 正在退出（装配侧 before-quit 置位）。 */
  readonly isQuitting: () => boolean;
  /** 窗口已销毁：没有可重载的对象了。 */
  readonly isDestroyed: () => boolean;
}

export interface RendererRecovery {
  /** 判定这一次 gone 怎么收；返回 'reload' 时连续计数自增（attempt 即第几次）。 */
  decide(reason: GoneReason): RecoveryAction;
  /** dom-ready 成功载入 = 重载成功，连续崩溃计数清零。 */
  markLoaded(): void;
}

export function createRendererRecovery(deps: RendererRecoveryDeps): RendererRecovery {
  let attempts = 0;
  return {
    decide(reason: GoneReason): RecoveryAction {
      // 谓词每次现查：退出/销毁是会翻转的现场状态，工厂求值期冻结会翻出旧账。
      if (deps.isQuitting() || deps.isDestroyed()) return { action: 'ignore' };
      if (reason === 'integrity-failure') return { action: 'escalate' };
      if (reason === 'clean-exit') return { action: 'ignore' };
      // crashed / oom / killed / abnormal-exit / launch-failed 与未知 reason 都在这。
      if (attempts >= RELOAD_LIMIT) return { action: 'escalate' };
      attempts += 1;
      return { action: 'reload', attempt: attempts };
    },
    markLoaded(): void {
      attempts = 0;
    },
  };
}
