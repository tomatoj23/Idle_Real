// @vitest-environment node
/**
 * #71 项 4 验收：致命故障兜底的三条契约——
 * ① 崩溃必出声（日志 + dialog）且不再带未知状态续跑（exit 一定被调到）；
 * ② 提示面自己挂了（无显示环境）不许把收尾一起带走；
 * ③ unhandledRejection 只记不走死路（防把「可能没事」升级成丢现场）。
 */
import { describe, expect, it, vi } from 'vitest';
import { createFatalHandler } from '../electron/fatal';

function harness(showError: (title: string, content: string) => void = () => {}) {
  const lines: string[] = [];
  const exit = vi.fn();
  const handler = createFatalHandler({ log: (m) => lines.push(m), showError, exit });
  return { lines, exit, handler };
}

describe('#71 项 4 · uncaughtException', () => {
  it('落 FATAL 日志（含栈）+ 弹一次提示 + 结束进程', () => {
    const show = vi.fn();
    const { lines, exit, handler } = harness(show);
    handler.onUncaughtException(new Error('boom'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[main] FATAL uncaughtException:');
    expect(lines[0]).toContain('boom');
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]?.[1]).toContain('自动保存'); // 承诺只到最近一次自动保存
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('抛的不是 Error（字符串/null）也照样走完三步，不因取 .stack 而二次抛', () => {
    const { lines, exit, handler } = harness();
    handler.onUncaughtException('just a string');
    expect(lines[0]).toContain('just a string');
    expect(exit).toHaveBeenCalledWith(1);

    const second = harness();
    second.handler.onUncaughtException(null);
    expect(second.lines[0]).toContain('null');
    expect(second.exit).toHaveBeenCalledTimes(1);
  });

  it('dialog 自己抛（无显示环境/未 ready）：日志与 exit 一个都不少', () => {
    const { lines, exit, handler } = harness(() => {
      throw new Error('no display');
    });
    handler.onUncaughtException(new Error('boom'));
    expect(lines).toHaveLength(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('收尾途中再炸（二次致命）：不再弹第二个模态框，但仍然要求结束进程', () => {
    const show = vi.fn();
    const { exit, handler } = harness(show);
    handler.onUncaughtException(new Error('first'));
    handler.onLoadFailure(new Error('second'), 'file:///app/dist/index.html');
    expect(show).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});

describe('#71 项 4 · 加载与启动失败', () => {
  it('loadFile/loadURL rejection：点名是哪个 URL，随后出声退出', () => {
    const show = vi.fn();
    const { lines, exit, handler } = harness(show);
    handler.onLoadFailure(new Error('ERR_FILE_NOT_FOUND'), 'file:///app/dist/index.html');
    expect(lines[0]).toContain('FATAL load failed (file:///app/dist/index.html)');
    expect(lines[0]).toContain('ERR_FILE_NOT_FOUND');
    expect(show).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('两个出口两种颗粒：日志带栈，dialog 只给一行消息', () => {
    const show = vi.fn();
    const { lines, handler } = harness(show);
    const err = new Error('boom');
    err.stack = 'STACK-LINE-NOT-FOR-PLAYERS';
    handler.onUncaughtException(err);
    expect(lines[0]).toContain('STACK-LINE-NOT-FOR-PLAYERS');
    expect(show.mock.calls[0]?.[1]).not.toContain('STACK-LINE-NOT-FOR-PLAYERS');
    expect(show.mock.calls[0]?.[1]).toContain('boom');
  });

  it('whenReady 链上抛：与其余致命故障同律（此前无人 catch，只能落在 Node 默认行为上）', () => {
    const { lines, exit, handler } = harness();
    handler.onStartupFailure(new Error('no userData dir'));
    expect(lines[0]).toContain('startup failed:');
    expect(lines[0]).toContain('no userData dir');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('#71 项 4 · unhandledRejection', () => {
  it('只记一行，不弹提示也不结束进程', () => {
    const show = vi.fn();
    const { lines, exit, handler } = harness(show);
    handler.onUnhandledRejection(new Error('ipc hiccup'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[main] unhandledRejection:');
    expect(lines[0]).toContain('ipc hiccup');
    expect(show).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('拒绝值不是 Error 也取得到描述', () => {
    const { lines, handler } = harness();
    handler.onUnhandledRejection({ code: 'E' });
    expect(lines[0]).toContain('[object Object]');
  });
});
