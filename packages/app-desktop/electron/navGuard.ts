/**
 * 导航放行判定（#71 项 1）：从「字符串前缀比对」升级为「解析后逐段比对」。
 *
 * 旧口径 `url.startsWith(selfOrigin)` 有两处漏洞：
 * - 打包态 selfOrigin='file://' → 任意本地 file: URL 都算「自己的」；
 * - dev 态 selfOrigin='http://localhost:5173' → 撞脸串过前缀：
 *   `http://localhost:5173.evil.com`（票面例，按 WHATWG 是非法端口、解析即抛）、
 *   `http://localhost:5173evil.com`（无点，同上）、`http://localhost:5173@evil.example`
 *   （可解析，真 host 藏在 userinfo 之后——这一形才是要防的那类）。
 *
 * 判据解析失败一律拒：壳是单页应用，src/ 里零 `<a>`、零 location 写入，
 * 放行任何外站没有功能代价可言，收紧不需要例外。
 *
 * 覆盖面 = 顶层导航（will-navigate）。子帧导航另有 will-frame-navigate，本壳零
 * iframe 故未接；window.open 面的 iframe OpenURL 提示归 #67（Electron 版本域）。
 */
export function isSelfNavigation(targetUrl: string, selfUrl: string): boolean {
  const target = parseUrl(targetUrl);
  const self = parseUrl(selfUrl);
  if (!target || !self) return false;
  if (target.protocol !== self.protocol || target.host !== self.host) return false;
  // file: 的 host 恒为空串（`file://localhost/D:/x` 会被规范化成 `file:///D:/x`），
  // 所有本地文件互为「同源」——不比路径等于没修。路径按原样比，大小写不同即拒：
  // 本壳无合法 file: 跳转，误拒的方向是 fail-closed。
  return target.protocol === 'file:' ? target.pathname === self.pathname : true;
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
