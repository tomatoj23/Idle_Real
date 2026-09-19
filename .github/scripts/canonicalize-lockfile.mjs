/**
 * 把 package-lock.json 里的依赖 tarball 主机规范化到官方 registry，供 CI 使用。
 *
 * 为什么需要：开发机 npm 走国内镜像（registry.npmmirror.com），lockfile 的 resolved 因此
 * 整片钉在镜像主机上。npm 的 `replace-registry-host` 默认值是 `npmjs`，方向是「把 npmjs
 * 主机改写成本机 registry」，反向不成立 —— 不改写的话，GitHub runner 会去国内 CDN 拉全部
 * 依赖（慢、易超时）。
 *
 * 安全性：integrity 字段原样保留（本脚本收尾会断言它一条没动），`npm ci` 仍按 sha512 逐条
 * 校验下载内容，所以这一步顺带把「lockfile 生成期对镜像的信任」收回为「每次安装对官方源
 * 逐条验证」。
 *
 * 实现取字节级主机串替换而非 JSON 反序列化重排，有两个理由：
 * 1. 保持文件字节形态（缩进/键序/CRLF），本地若误跑也不会产出「整文件重排」这种毁 git blame
 *    的 diff——正是 #78-B 拒绝 formatifier 的同一理由；
 * 2. 一处替换同时覆盖 lockfileVersion 3 的 `packages` 与 v2 的嵌套 `dependencies` 块，
 *    不会因为只处理 `packages` 而留下半规范化的旧版块。
 *
 * 只在 CI 里跑，不改入库的 lockfile —— 本地镜像加速的开发体验不受影响。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'package-lock.json';
const OFFICIAL_HOST = 'registry.npmjs.org';
const OFFICIAL_PREFIX = `https://${OFFICIAL_HOST}/`;

/** 递归收集所有 resolved：v3 在 packages 扁平表里，v2 藏在层层嵌套的 dependencies 里。 */
function collectResolved(node, out) {
  if (!node || typeof node !== 'object') return;
  for (const [name, entry] of Object.entries(node)) {
    if (typeof entry?.resolved === 'string') out.push([name, entry.resolved, entry.integrity ?? null]);
    if (entry?.dependencies) collectResolved(entry.dependencies, out);
  }
}

function classify(text) {
  const lock = JSON.parse(text);
  const found = [];
  collectResolved(lock.packages ?? lock.dependencies, found);
  const mirrorHosts = new Map();
  const odd = [];
  for (const [name, resolved] of found) {
    if (!/^https?:\/\//.test(resolved)) continue; // workspace 链接条目写作 "packages/engine"
    const url = new URL(resolved);
    const isTarball = url.protocol === 'https:' && url.pathname.includes('/-/') && url.pathname.endsWith('.tgz');
    if (!isTarball) {
      odd.push(`${name} → ${resolved}`); // git/codeload 一类的依赖：本就不该改写，只报告
      continue;
    }
    if (url.host === OFFICIAL_HOST) continue;
    mirrorHosts.set(url.host, (mirrorHosts.get(url.host) ?? 0) + 1);
  }
  return { mirrorHosts, odd, total: found.length };
}

const raw = readFileSync(FILE, 'utf8');
const before = classify(raw);
if (before.odd.length > 0) {
  console.warn(`非 registry tarball 形态的 resolved 共 ${before.odd.length} 条，按设计不改写、仅列出：`);
  for (const line of before.odd.slice(0, 10)) console.warn(`  ${line}`);
}
if (before.mirrorHosts.size === 0) {
  console.log('lockfile 主机已是官方源，无需改写');
  process.exit(0);
}

let out = raw;
let expected = 0;
for (const [host, count] of before.mirrorHosts) {
  out = out.split(`https://${host}/`).join(OFFICIAL_PREFIX);
  expected += count;
}

// 改写后自证：仍能解析、非官方主机的 tarball 归零、integrity 多重集一条没变
const after = classify(out);
const integrityOf = (text) => {
  const found = [];
  collectResolved(JSON.parse(text).packages ?? JSON.parse(text).dependencies, found);
  return found.map(([, , integrity]) => integrity).sort().join('|');
};
if (after.mirrorHosts.size > 0 || integrityOf(raw) !== integrityOf(out)) {
  console.error('规范化后自检失败：仍有非官方 tarball 主机，或 integrity 发生变动');
  process.exit(1);
}

writeFileSync(FILE, out);
console.log(
  `lockfile 主机规范化：改写 ${expected} 条 resolved（来源主机 ${[...before.mirrorHosts.keys()].join(', ')}），integrity 未改动`,
);
