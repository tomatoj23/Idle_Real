/**
 * 把 package-lock.json 里的依赖 tarball 主机规范化到官方 registry，供 CI 使用。
 *
 * 为什么需要：开发机 npm 走国内镜像（registry.npmmirror.com），lockfile 的 resolved 因此
 * 整片钉在镜像主机上。npm 的 `replace-registry-host` 默认值是 `npmjs`，方向是「把 npmjs
 * 主机改写成本机 registry」，反向不成立 —— 不改写的话，GitHub runner 会去国内 CDN 拉全部
 * 依赖（慢、易超时）。
 *
 * 安全性：integrity 字段原样保留，`npm ci` 仍按 sha512 逐条校验下载内容，所以这一步顺带
 * 把「lockfile 生成期对镜像的信任」收回为「每次安装对官方源的验证」。
 *
 * 只在 CI 里跑，不改入库的 lockfile —— 本地镜像加速的开发体验不受影响。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'package-lock.json';
const OFFICIAL_HOST = 'registry.npmjs.org';

const lock = JSON.parse(readFileSync(FILE, 'utf8'));
let rewritten = 0;
const skipped = [];

for (const [name, entry] of Object.entries(lock.packages ?? {})) {
  const resolved = entry?.resolved;
  if (typeof resolved !== 'string') continue; // workspace 条目的本地路径等

  // 相对路径型 resolved（workspace 链接条目写作 "packages/app-desktop"）原样放过
  if (!/^https?:\/\//.test(resolved)) continue;

  const url = new URL(resolved);
  // registry tarball 的通用形态：https://<host>/<pkg>/-/<file>.tgz（scoped 包用 %2f）
  if (url.protocol !== 'https:' || !url.pathname.includes('/-/')) {
    skipped.push(`${name} → ${resolved}`);
    continue;
  }
  if (url.host === OFFICIAL_HOST) continue;

  url.host = OFFICIAL_HOST;
  entry.resolved = url.toString();
  rewritten += 1;
}

if (skipped.length > 0) {
  console.error(`发现 ${skipped.length} 条非 registry tarball 的 resolved，拒绝猜语义：`);
  for (const line of skipped.slice(0, 10)) console.error(`  ${line}`);
  process.exit(1);
}

writeFileSync(FILE, JSON.stringify(lock, null, 2) + '\n');
console.log(`lockfile 主机规范化：改写 ${rewritten} 条 resolved`);
