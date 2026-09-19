// @vitest-environment node
/**
 * #71 项 1 验收：导航放行判据 isSelfNavigation。
 *
 * 票面三例（打包态拒 file:///C:/evil.html、dev 态拒 localhost:5173.evil.com、
 * 自身 URL 放行）之外，补的是「旧前缀口径为什么挡不住」的逐形对照：
 * 每一形都先用 startsWith 复算一遍，确保断言的是加固、不是空转。
 */
import { describe, expect, it } from 'vitest';
import { isSelfNavigation } from '../electron/navGuard';

/** 打包态自身 URL（Electron 侧由 pathToFileURL(dist/index.html) 得到，形态一致）。 */
const PACKAGED = 'file:///D:/games/wendao/dist/index.html';
/** dev 态自身 URL：VITE_DEV_SERVER_URL 的原样值（vite 默认端口，无尾斜杠）。 */
const DEV = 'http://localhost:5173';

describe('#71 项 1 · 打包态（self = file:///…/dist/index.html）', () => {
  it('放行自身 URL（正对照：全拒的实现同样能过其余断言）', () => {
    expect(isSelfNavigation(PACKAGED, PACKAGED)).toBe(true);
  });

  it('拒任意其他本地文件：票面例 file:///C:/evil.html，以及同目录的另一份 html', () => {
    // 旧口径 selfOrigin='file://' 对这两个都是放行——等于整个文件系统开放。
    for (const url of ['file:///C:/evil.html', 'file:///D:/games/wendao/dist/other.html']) {
      expect(url.startsWith('file://')).toBe(true); // 旧口径确曾放行
      expect(isSelfNavigation(url, PACKAGED)).toBe(false);
    }
  });

  it('file://localhost/… 形态归一后仍算自身（同一份文件的另一种写法）', () => {
    expect(isSelfNavigation('file://localhost/D:/games/wendao/dist/index.html', PACKAGED)).toBe(
      true,
    );
  });

  it('拒协议换了的目标（本地档里嵌的 http 跳转）', () => {
    expect(isSelfNavigation('http://localhost:5173/', PACKAGED)).toBe(false);
  });
});

describe('#71 项 1 · dev 态（self = http://localhost:5173）', () => {
  it('放行自身：根 URL、带路径、带 query/hash', () => {
    for (const url of [
      DEV,
      `${DEV}/`,
      `${DEV}/src/main.ts`,
      `${DEV}/?t=1`,
      `${DEV}/#tab-bag`,
    ]) {
      expect(isSelfNavigation(url, DEV)).toBe(true);
    }
  });

  it('拒 localhost:5173.evil.com（票面例：旧前缀口径放行）', () => {
    const url = 'http://localhost:5173.evil.com/';
    expect(url.startsWith(DEV)).toBe(true);
    // 该形按 WHATWG 是非法端口（端口段含非数字），解析失败即拒。
    expect(isSelfNavigation(url, DEV)).toBe(false);
  });

  it('拒可解析的撞脸形：userinfo 伪装（旧前缀口径同样放行）', () => {
    const url = 'http://localhost:5173@evil.example/x';
    expect(url.startsWith(DEV)).toBe(true);
    expect(new URL(url).host).toBe('evil.example'); // 解析后 host 才是真身份
    expect(isSelfNavigation(url, DEV)).toBe(false);
  });

  it('拒端口/协议/主机任一维不同', () => {
    for (const url of [
      'http://localhost:5174/',
      'https://localhost:5173/',
      'http://127.0.0.1:5173/',
      'http://localhost',
      'http://evil.example/?next=http://localhost:5173',
    ]) {
      expect(isSelfNavigation(url, DEV)).toBe(false);
    }
  });
});

describe('#71 项 1 · 输入不合形状时一律拒（fail-closed）', () => {
  it('拒垃圾 targetUrl 与空串', () => {
    for (const url of ['', 'not a url', 'javascript:alert(1)//', 'data:text/html,x']) {
      expect(isSelfNavigation(url, DEV)).toBe(false);
    }
  });

  it('自身 URL 配错（空/非 URL）时全拒，不抛', () => {
    for (const self of ['', 'nope']) {
      expect(isSelfNavigation(DEV, self)).toBe(false);
      expect(isSelfNavigation(self, self)).toBe(false);
    }
  });

  it('URL 里的换行不构成绕过：解析期即被删掉，判据看的是解析结果', () => {
    // 入日志前另有一道剥换行（main.ts），与此处判据无关。
    expect(isSelfNavigation('http://localhost:5173\n.evil.com/', DEV)).toBe(false);
  });
});
