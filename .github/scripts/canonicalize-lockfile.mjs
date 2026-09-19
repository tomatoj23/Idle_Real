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
 * 实现取「按整条 resolved 值做字节级替换」，两头都不要：
 * 1. 不用 JSON 反序列化重排——那会改写全文件字节（缩进/键序/CRLF），本地若误跑就产出毁
 *    git blame 的巨型 diff，正是 #78-B 拒绝格式化器的同一理由；
 * 2. 不用「按主机替换」——那会连带改掉 classify() 刻意放过的 odd 条目（同主机上的非 registry
 *    tarball 路径，如二进制镜像 URL），把 https://镜像/binary/x.tgz 拼成官方源上并不存在的
 *    https://registry.npmjs.org/binary/x.tgz，代价是一次没人看得懂的 CI 安装失败。
 * 带引号匹配 `"…"` 是因为 resolved 在 lockfile 里永远是独立的一整串值，不会被别的串包含而误伤。
 *
 * 只在 CI 里跑，不改入库的 lockfile —— 本地镜像加速的开发体验不受影响。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'package-lock.json';
const OFFICIAL_HOST = 'registry.npmjs.org';
const OFFICIAL_ORIGIN = `https://${OFFICIAL_HOST}`;

/**
 * 递归收集所有 resolved：v3 在 packages 扁平表里，v2 另有一份嵌套 dependencies，
 * 两块都要走——只收 packages 会在 v2 lockfile 上漏掉半规范化的旧版块。
 */
function collectResolved(node, out) {
  if (!node || typeof node !== 'object') return;
  for (const [name, entry] of Object.entries(node)) {
    if (typeof entry?.resolved === 'string') out.push([name, entry.resolved, entry.integrity ?? null]);
    if (entry?.dependencies) collectResolved(entry.dependencies, out);
  }
}

function classify(text) {
  const lock = JSON.parse(text);
  const entries = [];
  collectResolved(lock.packages, entries);
  collectResolved(lock.dependencies, entries); // v3 下为 undefined，直接返回
  const mirrorUrls = new Map();
  const hosts = new Set();
  const odd = [];
  for (const [name, resolved] of entries) {
    if (!/^https?:\/\//.test(resolved)) continue; // workspace 链接条目写作 "packages/engine"
    const url = new URL(resolved);
    const isRegistryTarball = url.protocol === 'https:' && url.pathname.includes('/-/') && url.pathname.endsWith('.tgz');
    if (!isRegistryTarball) {
      odd.push(`${name} → ${resolved}`); // 二进制镜像 / git codeload 一类：按设计不改写，只报告
      continue;
    }
    if (url.host === OFFICIAL_HOST) continue;
    mirrorUrls.set(resolved, (mirrorUrls.get(resolved) ?? 0) + 1);
    hosts.add(url.host);
  }
  const integrity = entries.map(([, , value]) => value).sort().join('|');
  return { mirrorUrls, hosts, odd, count: entries.length, integrity };
}

const raw = readFileSync(FILE, 'utf8');
const before = classify(raw);
if (before.odd.length > 0) {
  console.warn(`非 registry tarball 形态的 resolved 共 ${before.odd.length} 条，按设计不改写、仅列出：`);
  for (const line of before.odd.slice(0, 10)) console.warn(`  ${line}`);
}
if (before.mirrorUrls.size === 0) {
  console.log('没有钉在镜像主机上的 registry tarball 条目，lockfile 无需改写');
  process.exit(0);
}

let out = raw;
let rewritten = 0;
for (const url of before.mirrorUrls.keys()) {
  const { pathname, search, hash } = new URL(url);
  const quoted = `"${url}"`;
  rewritten += out.split(quoted).length - 1;
  out = out.split(quoted).join(`"${OFFICIAL_ORIGIN}${pathname}${search}${hash}"`);
}

// 改写后自证：仍能解析、条目数没丢、镜像 tarball 归零、integrity 多重集一条没变
const after = classify(out);
if (after.mirrorUrls.size > 0 || after.count !== before.count || after.integrity !== before.integrity) {
  console.error('规范化后自检失败：仍有镜像 tarball 主机，或 resolved 条目数 / integrity 发生变动');
  process.exit(1);
}

writeFileSync(FILE, out);
console.log(
  `lockfile 主机规范化：改写 ${rewritten} 条 resolved（${before.mirrorUrls.size} 个不同 URL，来源主机 ${[...before.hosts].join(', ')}），integrity 未改动`,
);
