// pretooluse-guard 金丝雀自测（#81 验收的模拟路径验证层；#85 对抗审计产物全形态入库）。
// 运行：node scripts/hooks/pretooluse-guard.mjs --self-test（或直接跑本文件）
// 纪律：本套未全绿前，禁止对真实目录（Reference_Documents / 用户真档）发任何写尝试。
// 「如何变红」：改坏规则实现后，对应 DENY 用例会翻绿（即门禁失效）；改坏匹配边界后，
// ALLOW 用例会翻红（即误伤正常操作）。高危形态注释带 #85 审计编号（H1-H6 高危 / M1-M11 中低危）。
//
// 下列真档路径字样均为守卫**用例数据**（模拟工具调用文本，非真实写盘），按 #82 P4
// 豁免纪律声明（字面 rm 指向真档的事故形态在 DENY 用例里必须保留原文）：
// policy-allow: P4 金丝雀用例数据（模拟工具调用文本，非真实写盘路径）

import { classify, formatDeny } from "./pretooluse-guard.mjs";

const CWD = String.raw`D:\My_Projects\SmallRpg`;
const REF = String.raw`D:\My_Projects\Reference_Documents`;

// 模拟用户真档落点（绝对形态用例按运行时 APPDATA 拼，$APPDATA 形态由守卫自行展开）
const FAKE_APPDATA = process.env.APPDATA ?? String.raw`C:\Users\023\AppData\Roaming`;
const FAKE_USERDATA = `${FAKE_APPDATA}\\问道长生`;

const DENY_CASES = [
  // ---- 钩子 A ----
  ["A-write-tool", "Write", { file_path: `${REF}\\electron-main\\x.md`, content: "y" }, "A"],
  ["A-edit-tool-fwdslash", "Edit", { file_path: "D:/My_Projects/Reference_Documents/foo.txt", old_string: "a", new_string: "b" }, "A"],
  ["A-bash-redirect", "Bash", { command: `echo hi > ${REF}\\probe.txt` }, "A"],
  ["A-bash-rm", "Bash", { command: `rm -rf ${REF}\\electron-main` }, "A"],
  ["A-bash-touch", "Bash", { command: `touch ${REF}\\x` }, "A"],
  ["A-bash-cp-into", "Bash", { command: `cp x.md ${REF}\\` }, "A"],
  ["A-bash-mv-from", "Bash", { command: `mv ${REF}\\x .` }, "A"],
  ["A-bash-sed-inplace", "Bash", { command: `sed -i "s/a/b/" ${REF}\\f.md` }, "A"],
  ["A-bash-cd-then-write-tool", "Bash", { command: `cd ${REF} && npm install` }, "A"],
  ["A-bash-cd-relative", "Bash", { command: `cd ..\\Reference_Documents && touch x` }, "A"],
  ["A-bash-find-delete", "Bash", { command: `find ${REF} -name "*.tmp" -delete` }, "A"],
  ["A-bash-git-write-sub", "Bash", { command: `git -C ${REF} add .` }, "A"],
  ["A-bash-wrapper-write-signal", "Bash", { command: `powershell -Command "Remove-Item '${REF}\\x'"` }, "A"],
  // ---- 钩子 B（含 2026-09-29 事故原形态）----
  ["B-bash-incident-form", "Bash", { command: `rm -rf "$APPDATA/问道长生"` }, "B"],
  ["B-bash-incident-brace", "Bash", { command: `rm -rf "\${APPDATA}/问道长生"` }, "B"],
  ["B-bash-percent", "Bash", { command: `rm -rf %APPDATA%\\问道长生` }, "B"],
  ["B-bash-absolute", "Bash", { command: `rm -rf ${FAKE_APPDATA}\\问道长生` }, "B"],
  ["B-write-overwrite-save", "Write", { file_path: `${FAKE_USERDATA}\\saves\\wendao_changsheng_v3.json`, content: "{}" }, "B"],
  ["B-bash-redirect-save", "Bash", { command: `echo "{}" > "$APPDATA/问道长生/saves/slot-a.json"` }, "B"],
  ["B-bash-cd-then-write", "Bash", { command: `cd "$APPDATA/问道长生" && touch probe` }, "B"],
  // 控制流剥前缀后不得漏判写动词
  ["A-if-then-rm", "Bash", { command: `if [ -x y ]; then rm -rf ${REF}\\x; fi` }, "A"],
  // ---- 钩子 C ----
  ["C-push-no-verify", "Bash", { command: `git push --no-verify` }, "C"],
  ["C-push-no-verify-args", "Bash", { command: `git push origin main --no-verify` }, "C"],
  ["C-commit-no-verify", "Bash", { command: `git commit --no-verify -m x` }, "C"],
  ["C-commit-short", "Bash", { command: `git commit -n -m "x"` }, "C"],
  ["C-commit-short-cluster", "Bash", { command: `git commit -an -m "x"` }, "C"],
  ["C-git-exe-form", "Bash", { command: `git.exe push --no-verify` }, "C"],
  // 引号包裹的独立选项形态（review 发现后补）：git 同样视其为选项
  ["C-push-quoted", "Bash", { command: `git push "--no-verify"` }, "C"],
  ["C-commit-quoted-short", "Bash", { command: `git commit "-n" -m x` }, "C"],
  // 包装层内的 --no-verify（review 发现后补）
  ["C-powershell-wrapper", "Bash", { command: `powershell -Command "git push --no-verify"` }, "C"],
  // PowerShell 环境变量形态（review 发现后补）
  ["B-powershell-env-form", "Bash", { command: `rm -rf "$env:APPDATA/问道长生"` }, "B"],
  ["B-cmd-del-wrapper", "Bash", { command: `cmd /c "del %APPDATA%\\问道长生\\saves\\x.json"` }, "B"],
  // ---- #85 H1 续行拆段（一处救 A/B/C）----
  ["H1-cont-rm-ref", "Bash", { command: `rm -rf \\\n  ${REF}\\x` }, "A"],
  ["H1-cont-rm-ud", "Bash", { command: `rm -rf \\\n  "$APPDATA/问道长生"` }, "B"],
  ["H1-cont-git-push", "Bash", { command: `git push \\\n  --no-verify` }, "C"],
  ["H1-cont-quoted", "Bash", { command: `rm -rf "${REF}\\\n\\x"` }, "A"],
  // ---- #85 H2 长选项前缀缩写（实证打穿过 pre-push，按前缀判、宁多拒）----
  ["H2-push-abbrev-veri", "Bash", { command: `git push --no-veri` }, "C"],
  ["H2-commit-abbrev-veri", "Bash", { command: `git commit --no-veri -m x` }, "C"],
  ["H2-push-abbrev-v", "Bash", { command: `git push --no-v` }, "C"],
  ["H2-push-abbrev-eq", "Bash", { command: `git push --no-verify=true` }, "C"],
  ["H2-wrapper-abbrev", "Bash", { command: `powershell -Command "git push --no-veri"` }, "C"],
  // ---- #85 H3 配置旁路（实证打穿过 pre-push）----
  ["H3-c-hookspath-nul", "Bash", { command: `git -c core.hooksPath=NUL push` }, "C"],
  ["H3-c-hookspath-missing", "Bash", { command: `git -c core.hooksPath=.githooks-missing push` }, "C"],
  ["H3-c-alias-override", "Bash", { command: `git -c "alias.p=push --no-verify" p` }, "C"],
  ["H3-config-env-hookspath", "Bash", { command: `git --config-env core.hooksPath=HOOKS_OFF push` }, "C"],
  ["H3-config-set-hookspath", "Bash", { command: `git config core.hooksPath NUL` }, "C"],
  ["H3-config-alias-set", "Bash", { command: `git config alias.ci "commit -n"` }, "C"],
  // ---- #85 H6 短选项簇（m-值判断压过 n 检查的顺序 bug；-mn/-amn 不是绕过，见 ALLOW）----
  ["H6-cluster-nm", "Bash", { command: `git commit -nm x` }, "C"],
  ["H6-cluster-nmsg", "Bash", { command: `git commit -nmsg` }, "C"],
  ["H6-cluster-anm", "Bash", { command: `git commit -anm x` }, "C"],
  ["H6-cluster-nF", "Bash", { command: `git commit -nF file.txt` }, "C"],
  // ---- #85 H4 Windows 开关（/E /I /Y 被 isFlag 吞掉致末参数=目标失效）----
  ["H4-robocopy-slashE", "Bash", { command: `robocopy . ${REF}\\in /E` }, "A"],
  ["H4-xcopy-slashI", "Bash", { command: `xcopy a.txt ${REF}\\x /I` }, "A"],
  ["H4-copy-slashY", "Bash", { command: `copy a.txt ${REF}\\x /Y` }, "A"],
  ["H4-robocopy-ud", "Bash", { command: `robocopy . "$APPDATA/问道长生\\in" /E` }, "B"],
  // ---- #85 H5 解压落盘目标（WRITE_EXTRACT 早退从未解析 -d/-C）----
  ["H5-unzip-d-ud", "Bash", { command: `unzip backup.zip -d "$APPDATA/问道长生"` }, "B"],
  ["H5-tar-C-ref", "Bash", { command: `tar xf backup.tar -C ${REF}` }, "A"],
  ["H5-unzip-d-ref", "Bash", { command: `unzip backup.zip -d ${REF}\\out` }, "A"],
  // ---- #85 M2 目标位解析族（dd of= / curl -o<贴连> / --opt= / cp -t）----
  ["M2-dd-of-eq", "Bash", { command: `dd of=${REF}\\x if=/dev/zero` }, "A"],
  ["M2-curl-o-attached", "Bash", { command: `curl -o${REF}\\x http://a/b` }, "A"],
  ["M2-curl-output-eq", "Bash", { command: `curl --output=${REF}\\x http://a/b` }, "A"],
  ["M2-npm-prefix-eq", "Bash", { command: `npm install --prefix=${REF}` }, "A"],
  ["M2-git-gid-eq", "Bash", { command: `git --git-dir=${REF}\\repo init` }, "A"],
  ["M2-cp-t-target", "Bash", { command: `cp -t ${REF} a.txt b.txt` }, "A"],
  // ---- #85 M1 写信号表补（python open(...,'w') / write(）----
  ["M1-python-open-w-ud", "Bash", { command: `python -c "open(r'${FAKE_USERDATA}\\\\x','w')"` }, "B"],
  ["M1-python-open-w-ref", "Bash", { command: `python -c "open(r'${REF}\\\\x','w')"` }, "A"],
  ["M1-python-write-ref", "Bash", { command: `python -c "f=open(r'${REF}\\\\x','w'); f.write('y')"` }, "A"],
  // ---- #85 M4 env 移出 READ_VERBS → CONTROL_PREFIXES ----
  ["M4-env-rm-ref", "Bash", { command: `env rm -rf ${REF}\\x` }, "A"],
  ["M4-env-rm-ud", "Bash", { command: `env rm -rf "$APPDATA/问道长生"` }, "B"],
  // ---- #85 M5/M6 路径归一（Win32 尾点/尾空格、\\?\ 长路径前缀）----
  ["M5-trailing-dot", "Bash", { command: `rm -rf "${REF}."` }, "A"],
  ["M5-trailing-space", "Bash", { command: `rm -rf "${REF} "` }, "A"],
  ["M5-inner-dot-seg", "Bash", { command: `rmdir /s /q "${REF}. \\x"` }, "A"],
  ["M5-write-trailing-dot", "Write", { file_path: `${REF}.`, content: "y" }, "A"],
  ["M6-longpath-prefix", "Bash", { command: `rm -rf "\\\\?\\D:\\My_Projects\\Reference_Documents\\x"` }, "A"],
  // ---- #85 M7 expandEnv 补 ${env:VAR}（PS 花括号形态）----
  ["M7-brace-env-ud", "Bash", { command: `rm -rf "\${env:APPDATA}\\问道长生"` }, "B"],
  ["M7-ps-brace-env", "Bash", { command: `powershell -Command "Remove-Item '\${env:APPDATA}\\问道长生\\x'"` }, "B"],
  // ---- #85 M8 包装层捆绑簇认 -c ----
  ["M8-bash-ec-rm", "Bash", { command: `bash -ec "rm -rf ${REF}\\x"` }, "A"],
  ["M8-sh-ec-push", "Bash", { command: `sh -ec "git push --no-verify"` }, "C"],
  // ---- #85 M9 heredoc 体按代码文本复判 ----
  ["M9-python-heredoc", "Bash", { command: `python <<'PY'\nopen(r'${REF}\\\\x','w')\nPY` }, "A"],
  ["M9-bash-heredoc-rm", "Bash", { command: `bash <<'EOF'\nrm -rf ${REF}\\x\nEOF` }, "A"],
  // ---- #85 M10 ApplyPatch *** Move to: ----
  ["M10-applypatch-move-to", "ApplyPatch", { patch: `*** Begin Patch\n*** Update File: docs/x.md\n*** Move to: ${REF}\\x.md\n*** End Patch` }, "A"],
  // ---- #85 N12 >| 强制重定向（勿被 | 切段拆散）----
  ["N12-force-redirect", "Bash", { command: `echo x >| ${REF}\\y` }, "A"],
  // ---- #85 N20 非字符串命令形态不静默跳过 ----
  ["N20-cmd-array", "Bash", { command: ["rm", "-rf", `${REF}\\x`] }, "A"],
  // ---- #85 裁决 1：mcp__node_repl__js 文本判定（强字面量 + 写信号）----
  ["MCP-node-repl-write-ref", "mcp__node_repl__js", { code: `require('fs').writeFileSync('${REF}\\\\x','y')` }, "A"],
  ["MCP-node-repl-removeitem-ud", "mcp__node_repl__js", { code: `Remove-Item "${FAKE_USERDATA}\\x"` }, "B"],
  // JS 源码转义双反斜杠形态（活体模拟实测漏检后补，#85）
  ["MCP-node-repl-js-escaped-ref", "mcp__node_repl__js", { code: `require('fs').writeFileSync('D:\\\\My_Projects\\\\Reference_Documents\\\\__probe85_sim.txt','x')` }, "A"],
  ["MCP-node-repl-js-escaped-ud", "mcp__node_repl__js", { code: `require('fs').rmSync('${FAKE_APPDATA.replace(/\\/g, "\\\\\\\\")}\\\\问道长生\\\\__probe85_sim.json')` }, "B"],
];

const ALLOW_CASES = [
  ["L-ls-ref", "Bash", { command: `ls ${REF}` }],
  ["L-ls-ref-quoted", "Bash", { command: `ls -la "${REF}\\electron-main"` }],
  ["L-grep-ref", "Bash", { command: `grep -rn "safeStorage" ${REF}\\electron-main\\docs` }],
  ["L-find-ref", "Bash", { command: `find ${REF} -name "*.ts" | head` }],
  ["L-cat-ref", "Bash", { command: `cat ${REF}\\README.md` }],
  ["L-read-tool-ref", "Read", { file_path: `${REF}\\electron-main\\package.json` }],
  ["L-write-repo", "Write", { file_path: `${CWD}\\docs\\x.md`, content: "y" }],
  // 散文提及受保护路径 + 写到工作区 = 正常文档工作，不得误伤
  ["L-echo-prose-mention", "Bash", { command: `echo "用户明令：${REF} 严禁改动" >> docs/agents/compliance.md` }],
  ["L-grep-prose-word", "Bash", { command: `grep -rn "Reference_Documents" docs/` }],
  ["L-git-normal-push", "Bash", { command: `git push origin main` }],
  ["L-git-commit-normal", "Bash", { command: `git commit -m "msg"` }],
  ["L-git-commit-cluster-no-n", "Bash", { command: `git commit -am "msg"` }],
  ["L-git-commit-quoted-dash-n", "Bash", { command: `git commit -m "-n"` }],
  // -am 捆绑带 m：后续词是消息值，不得误判
  ["L-git-commit-am-value", "Bash", { command: `git commit -am "use -n flag"` }],
  ["L-git-push-dry-run-short", "Bash", { command: `git push -n` }],
  ["L-git-status-in-ref", "Bash", { command: `git -C ${REF} status` }],
  ["L-npm-workspaces", "Bash", { command: `npm test --workspaces --if-present` }],
  ["L-npm-scope-slash", "Bash", { command: `npm i -w @wendao/app-desktop foo` }],
  ["L-rm-repo", "Bash", { command: `rm -rf packages/engine/node_modules` }],
  ["L-game-name-prose", "Bash", { command: `grep -rn "问道长生" docs/` }],
  ["L-backup-out-of-userdata", "Bash", { command: `cp "$APPDATA/问道长生/saves/wendao_changsheng_v3.json" .scratch/backup.json` }],
  ["L-bash-c-read-ref", "Bash", { command: `bash -c "ls '${REF}'"` }],
  // 测试构词 = 纯读，不得误伤（2026-09-29 活体验收实测误伤后补）
  ["L-if-test-construct", "Bash", { command: `if [ -e ${REF}\\x ]; then echo y; fi` }],
  ["L-test-construct", "Bash", { command: `test -f "${REF}\\README.md" && echo yes` }],
  // ---- #85 M11 误伤修复（各配 ALLOW 防回归）----
  ["M11-for-read-loop", "Bash", { command: `for f in ${REF}\\*.md; do echo "$f"; done` }],
  ["M11-commit-m-is-refpath", "Bash", { command: `git commit -m "${REF}"` }],
  ["M11-commit-F-ref-file", "Bash", { command: `git commit -F ${REF}\\msg.txt` }],
  ["M11-push-double-dash", "Bash", { command: `git push origin main -- --no-verify` }],
  // ---- #85 H6 非绕过簇（git 簇语义把 n 当 m 的值、命令本身报错）勿误拒 ----
  ["H6-cluster-mn-not-bypass", "Bash", { command: `git commit -mn "msg"` }],
  ["H6-cluster-amn-not-bypass", "Bash", { command: `git commit -amn "msg"` }],
  // ---- #85 范围外：git am/merge/rebase --no-verify（范围 = push/commit 显式声明）----
  ["SCOPE-git-am-no-verify", "Bash", { command: `git am --no-verify patch.txt` }],
  ["SCOPE-git-merge-no-verify", "Bash", { command: `git merge --no-verify x` }],
  ["SCOPE-git-rebase-no-verify", "Bash", { command: `git rebase --no-verify main` }],
  // ---- #85 豁免面：EncodedCommand 编码类绕过（归计算路径豁免，文本面不可见，写明于范围声明）----
  ["EXEMPT-ps-encodedcommand", "Bash", { command: `powershell -EncodedCommand SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAKQAgACQAbgA=` }],
  // ---- #85 读面回归钉（目标位解析族不得扩到读动词/纯读命令）----
  ["L-grep-attached-f", "Bash", { command: `grep -f${REF}\\patterns.txt docs/` }],
  ["L-env-alone", "Bash", { command: `env` }],
  ["L-robocopy-from-ref", "Bash", { command: `robocopy ${REF}\\docs out /E` }],
  // ---- #85 node_repl 面：强字面量但无写信号 = 纯读，放行 ----
  ["L-node-repl-mention-only", "mcp__node_repl__js", { code: `console.log('D:\\\\My_Projects\\\\Reference_Documents 严禁改动')` }],
  ["L-node-repl-write-temp", "mcp__node_repl__js", { code: `require('fs').writeFileSync(process.env.TEMP + '/probe85.txt', 'hi')` }],
];

// #85 裁决 3：APPDATA 缺失 → 限定范围 fail-loud（写效应 + 真档强字面量保守拒；纯读照常放行）
const FAILLOUD_DENY_CASES = [
  ["B-failloud-rm-percent", "Bash", { command: `rm -rf %APPDATA%\\问道长生` }, "B"],
  ["B-failloud-write-path", "Write", { file_path: `%APPDATA%\\问道长生\\x.json`, content: "{}" }, "B"],
  ["B-failloud-redirect", "Bash", { command: `echo "{}" > "$APPDATA/问道长生/saves/x.json"` }, "B"],
  // 写效应调用文本命中强字面量 = 按最严处置（含数据位散文提及，环境故障态不做细分）
  ["B-failloud-prose-write", "Bash", { command: `echo "严禁误删 %APPDATA%\\问道长生" >> docs/note.md` }, "B"],
];
const FAILLOUD_ALLOW_CASES = [
  ["L-failloud-ls", "Bash", { command: `ls "$APPDATA/问道长生"` }],
  ["L-failloud-grep", "Bash", { command: `grep -rn "save" "$APPDATA/问道长生/saves"` }],
  ["L-failloud-read-tool", "Read", { file_path: `%APPDATA%\\问道长生\\saves\\x.json` }],
];

export function runSelfTest() {
  let failed = 0;
  const report = (ok, msg) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  };

  for (const [name, toolName, toolInput, rule] of DENY_CASES) {
    const v = classify({ toolName, toolInput, cwd: CWD });
    const hit = v.some((x) => x.rule === rule);
    report(
      hit,
      `deny  ${name}（期望规则 ${rule}${v.length ? `，实得 ${v.map((x) => x.rule).join(",")}` : "，实得放行——门禁失效"}）`,
    );
    if (hit) {
      const text = formatDeny(v);
      report(text.includes("规则来源") && text.includes("正确做法"), `deny  ${name} 拒绝文案含规则来源与正确做法`);
    }
  }

  for (const [name, toolName, toolInput] of ALLOW_CASES) {
    const v = classify({ toolName, toolInput, cwd: CWD });
    report(
      v.length === 0,
      `allow ${name}${v.length ? `（误伤：${v.map((x) => `${x.rule}:${x.detail}`).join(";")}）` : ""}`,
    );
  }

  // APPDATA 剥离子环境跑 fail-loud 组（userDataRoots 动态读 env），跑完必还原
  const savedAppdata = process.env.APPDATA;
  delete process.env.APPDATA;
  try {
    for (const [name, toolName, toolInput, rule] of FAILLOUD_DENY_CASES) {
      const v = classify({ toolName, toolInput, cwd: CWD });
      const hit = v.some((x) => x.rule === rule && x.detail.includes("环境故障"));
      report(
        hit,
        `deny  ${name}（APPDATA 缺失 fail-loud，期望规则 ${rule}${v.length ? `，实得 ${v.map((x) => x.rule).join(",")}` : "，实得放行——门禁失效"}）`,
      );
    }
    for (const [name, toolName, toolInput] of FAILLOUD_ALLOW_CASES) {
      const v = classify({ toolName, toolInput, cwd: CWD });
      report(
        v.length === 0,
        `allow ${name}${v.length ? `（误伤：${v.map((x) => `${x.rule}:${x.detail}`).join(";")}）` : ""}`,
      );
    }
  } finally {
    if (savedAppdata !== undefined) process.env.APPDATA = savedAppdata;
  }

  const total = DENY_CASES.length + ALLOW_CASES.length + FAILLOUD_DENY_CASES.length + FAILLOUD_ALLOW_CASES.length;
  console.log(
    failed === 0
      ? `\n金丝雀全绿（${DENY_CASES.length + FAILLOUD_DENY_CASES.length} 拒 + ${ALLOW_CASES.length + FAILLOUD_ALLOW_CASES.length} 放行，共 ${total} 项）。`
      : `\n${failed} 项失败——门禁失效或误伤，模拟验证未过，禁止对真实目录发写尝试。`,
  );
  return failed === 0;
}

// 直接执行时自跑
import path from "node:path";
import { fileURLToPath } from "node:url";
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  process.exit(runSelfTest() ? 0 : 1);
}
