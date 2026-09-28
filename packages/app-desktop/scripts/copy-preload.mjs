/**
 * #76 项 3：preload 拷贝 + 拷后断言（原 build 尾部 `node -e copyFileSync` 无
 * 校验——路径一漂就打出带旧 preload 的包，运行时还被形状防御静默吞掉）。
 *
 * 断言口径：拷贝后 dist 件必须存在且与源件字节一致（半拷贝/旧件残留即红）。
 * 形状面（5 成员）归 tests/preload-shape.test.ts，此处只守「拷贝」这一段。
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(pkgRoot, 'electron', 'preload.cjs');
const distDir = join(pkgRoot, 'dist-electron');
const dist = join(distDir, 'preload.cjs');

if (!existsSync(src)) {
  console.error(`[build:preload] 源件缺失：${src}`);
  process.exit(1);
}
if (!existsSync(distDir)) {
  // dist-electron 归 tsc -p tsconfig.electron.json 产出（build:electron），
  // 没有它 = 构建链次序被改动，这里不代产目录（勿动 dist 产物布局）。
  console.error(`[build:preload] ${distDir} 不存在（须先跑 build:electron）`);
  process.exit(1);
}

copyFileSync(src, dist);

if (!existsSync(dist)) {
  console.error(`[build:preload] 拷贝失败：${dist} 未生成`);
  process.exit(1);
}
if (!readFileSync(src).equals(readFileSync(dist))) {
  console.error('[build:preload] 拷后不一致：dist-electron/preload.cjs ≠ electron/preload.cjs');
  process.exit(1);
}
console.log('[build:preload] ok: electron/preload.cjs → dist-electron/preload.cjs');
