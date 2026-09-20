/**
 * 致命故障兜底（#71 项 4）。
 *
 * 为什么不再「记下后继续跑」：uncaughtException 之后主进程状态已经未知，而放置游戏
 * 随后一次的周期自动保存（src/main.ts 的 AUTOSAVE_MS）会把这份未知写进槽位——崩本身
 * 不丢档，**崩后带着坏状态继续跑才丢**（被覆掉的好档无从找回）。故一律：落日志 →
 * 出声 → 结束进程。
 *
 * 为什么不自动 relaunch：崩在启动路径上时 relaunch = 崩环（新进程的日志里全是同一栈），
 * 且新进程同样无从判断状态是否干净。把「要不要再来一次」交给玩家，是本壳唯一不撒谎的选择。
 *
 * unhandledRejection 只记不退：它是没人在场的 Promise 失败（IPC 抖动、异步副作用抛错），
 * 主进程状态未必已坏；为一个「可能没事」的异步失败杀进程，是把小事故升级成丢现场。
 *
 * 两个出口两种颗粒：日志带栈（给人查根因），dialog 只给一行消息（玩家不读栈，
 * 而打包态窗口里的模态框才是他唯一看得见的东西）。
 *
 * 划界（ADR-017）：本模块零 electron 引用——dialog/exit 由主进程注入，于是「崩环」
 * 与「提示面自己挂了」两条契约可单测。提示文案写死在壳层，因为主进程读不到 content
 * 包的 texts 节（那节归 renderer）；要让玩家看到内容包措辞的崩溃提示，得走 renderer 面。
 */
import { errMsg, type Logger } from './platform.js';

export interface FatalDeps {
  readonly log: Logger;
  /** 面向玩家的模态提示（打包态 stdout 不可见，这是唯一的出声面）。 */
  readonly showError: (title: string, content: string) => void;
  readonly exit: (code: number) => void;
}

/** 崩溃时已无从判断档是否完好，只承诺「回到最近一次自动保存」。 */
const ADVICE = '游戏进度以最近一次自动保存为准，重新启动即从该档继续。';

export interface FatalHandler {
  onUncaughtException(err: unknown): void;
  onUnhandledRejection(reason: unknown): void;
  onLoadFailure(err: unknown, url: string): void;
  /** whenReady 链上任一步上抛：窗口从未出现，进程却活着。 */
  onStartupFailure(err: unknown): void;
}

export function createFatalHandler(deps: FatalDeps): FatalHandler {
  // 已在收尾途中又炸（dialog 抛错 / 退出链上的二次异常）：不再弹第二个模态框。
  let dying = false;

  /** where = 出事的所在（如加载失败的 URL），两边出口都带上。 */
  function die(kind: string, err: unknown, where?: string): void {
    const at = where === undefined ? kind : `${kind} (${where})`;
    // 取现场与写日志都不许连累收尾：抛出的对象可能自带会炸的 toString，日志面也可能
    // 已经是死通道（stdout/文件都算）。这两处若把 die 自己打断，就退回到本模块要治的
    // 那个病——「记下后带未知状态继续跑」，所以 exit 必须无条件到达。
    let detail: string;
    try {
      detail = describe(err);
    } catch {
      detail = '<异常现场不可读>';
    }
    try {
      deps.log(`[main] FATAL ${at}: ${detail}`);
    } catch {
      // 日志挂了：不重试、不再抛（正在收尾的路上）。
    }
    if (!dying) {
      dying = true;
      try {
        deps.showError('运行异常', `${at}: ${errMsg(err)}\n\n${ADVICE}`);
      } catch {
        // 无显示环境 / dialog 自身不可用：日志已落，此处绝不许再抛。
      }
    }
    deps.exit(1);
  }

  return {
    onUncaughtException(err: unknown): void {
      die('uncaughtException', err);
    },
    onUnhandledRejection(reason: unknown): void {
      deps.log(`[main] unhandledRejection: ${describe(reason)}`);
    },
    onLoadFailure(err: unknown, url: string): void {
      die('load failed', err, url);
    },
    onStartupFailure(err: unknown): void {
      die('startup failed', err);
    },
  };
}

/** 崩溃现场：有栈用栈（日志是给人查根因的），没栈退到消息。 */
function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
