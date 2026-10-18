'use strict';
/* ============================================================================
 * tools/close_window.js —— **一条命令跑完收尾**（2026-10-12 立，用户拍板）
 * ----------------------------------------------------------------------------
 * 以前收尾要发 5~8 次独立命令（gate / 对账 / 索引 / 棘轮 / 临时审计 / 全站遍历），
 * 每次工具调用都要把整段上下文重发一遍 ⟹ 光"收尾"本身就能烧掉几 K token。这里一次跑完、只打一张表。
 *
 * 用法：
 *   node tools/close_window.js             # 快档（约 20 秒）：门 1/2/3 + 索引判据 + 库自测 + 棘轮 + 临时审计
 *   node tools/close_window.js --full      # 加跑全站遍历（t21，约 1.5 分钟；**只有 T3/T4 档才需要**）
 *   node tools/close_window.js --tier T1   # 按 §3.9 的档位自动决定跑哪些（T1/T2 不跑遍历）
 *   node tools/close_window.js --json      # 机器可读（给别的脚本用）
 *
 * 判据（每条都对应一个"必须为 0/必须全绿"的硬指标）：
 *   · `gate.js`              → 合计 3 条门 0 红（它就是"改过文档必须复跑"的那条）
 *   · `tmp_readme_audit.js`  → 四模式 0 不一致
 *   · `tmp_t44_index_gap.js` → 9 条判据 0 红（846 格账目平）
 *   · `tools/t_lib/selftest.js` → 库自测 0 红（库坏了会污染**每一窗**的排查方向）
 *   · `tmp_t17_cost.js --check` → 必读链棘轮未增长
 *   · `tmp_t21_harness.js --run`（--full）→ traverse=N bad=0 且 理论卡结构不合格=0
 *   · `tmp_tmp_audit.js`     → **信息项**（列出"0 引用"文件供人决定删不删，不算红）
 * 退出码：任一硬项失败 = 1；只有信息项 = 0。
 * ========================================================================== */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (k) => argv.indexOf('--' + k) >= 0;
const val = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && argv[i + 1][0] !== '-' ? argv[i + 1] : d; };
const TIER = String(val('tier', '')).toUpperCase();
const FULL = has('full') || TIER === 'T3' || TIER === 'T4';
const JSONOUT = has('json');

function run(cmd, args, opt) {
  const o = opt || {};
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: o.timeout || 600000 });
  const err = r.error ? String(r.error.message) : '';
  return { code: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), err: err };
}
const PY = 'D:\\anaconda\\python.exe';

const STEPS = [
  { name: '门 1/2/3', hard: true, cmd: 'node', args: ['.dsh/skills/408-handover/scripts/gate.js'],
    ok: (r) => r.code === 0 && /合计：3 条门，0 红/.test(r.out), info: (r) => (r.out.match(/实测值：.*/) || [''])[0] },
  { name: 'README↔exam-history 四模式', hard: true, cmd: 'node', args: ['tmp_readme_audit.js', 'check'],
    ok: (r) => r.code === 0 && /全 0 不一致/.test(r.out), info: (r) => (r.out.match(/✔ OV=\d+｜README 表行=\d+｜js\/modules\/\*\.js=\d+｜行号连续 1\.\.\d+/) || [''])[0] },
  { name: '真题索引补全判据', hard: true, cmd: 'node', args: ['tmp_t44_index_gap.js', 'check'],
    ok: (r) => r.code === 0 && /判据 9 条 ｜ 红 0 条/.test(r.out), info: (r) => (r.out.match(/账目平：.*/) || [''])[0] },
  { name: '测试库自测', hard: true, cmd: 'node', args: ['tools/t_lib/selftest.js'],
    ok: (r) => r.code === 0 && /红 0 条/.test(r.out), info: (r) => (r.out.match(/断言 \d+ 条 \/ 红 \d+ 条/) || [''])[0] },
  { name: '必读链棘轮', hard: true, cmd: 'node', args: ['tmp_t17_cost.js', '--check'],
    ok: (r) => r.code === 0 && /✔ 棘轮/.test(r.out), info: (r) => (r.out.match(/必读链.\s*≈\s*\d+ token，基线 \d+/) || [''])[0] },
  { name: '全站遍历 + 理论卡结构', hard: true, full: true, cmd: 'node', args: ['tmp_t21_harness.js', '--run'], timeout: 900000,
    ok: (r) => /traverse=\d+ bad=0/.test(r.out) && /结构不合格=0/.test(r.out), info: (r) => (r.out.match(/traverse=\d+ bad=\d+/) || [''])[0] + ' ｜ ' + (r.out.match(/theoryCards=\d+ 结构不合格=\d+ 考情块超2行=\d+ 残留已删题号=\d+/) || [''])[0] },
  { name: '临时文件审计（信息项）', hard: false, cmd: 'node', args: ['tmp_tmp_audit.js'],
    ok: () => true, info: (r) => {
      /* 用审计脚本自己的汇总行（它不打印条目数，只给 KB）——别再自己数行，数出来的是"全表" */
      const kb = (r.out.match(/其中未引用部分\s*(\d+)\s*KB/) || [])[1];
      return kb !== undefined ? ('未被引用 ' + kb + ' KB（要看清单就单独跑 node tmp_tmp_audit.js）') : '（无汇总行）';
    } },
  { name: '真题缓存统计（信息项）', hard: false, cmd: fs.existsSync(PY) ? PY : 'python', args: ['tools/exam_index.py', '--stats'],
    ok: () => true, info: (r) => { const m = r.out.match(/(20\d\d)：切块\s*\d+ 题/g) || []; return m.length ? m.length + ' 年有切块（末行：' + (r.out.trim().split('\n').pop() || '').slice(0, 40) + '）' : '（--stats 无输出，跳过）'; } },
];

const rows = [];
let hardBad = 0;
for (const s of STEPS) {
  if (s.full && !FULL) { rows.push({ name: s.name, res: '跳过（非 T3/T4；要跑加 --full）', pass: null }); continue; }
  const r = run(s.cmd, s.args, { timeout: s.timeout });
  let pass = false;
  try { pass = !!s.ok(r); } catch (e) { pass = false; }
  if (!pass && s.hard) hardBad++;
  let info = '';
  try { info = (s.info && s.info(r)) || ''; } catch (e) { info = ''; }
  if (r.err && /EPERM|spawn/.test(r.err)) info = '（管道受限：' + r.err.slice(0, 60) + '，请手工跑这条）';
  rows.push({ name: s.name, res: info || (pass ? '通过' : '失败'), pass: pass, hard: s.hard });
  if (!pass && s.hard) {
    /* 摘要把"红的那一条"点名：先挑出带 [红] / ✖ / ❌ 的行，找不到才退回末 3 行
       （窗63 实测的 bug：只取末 3 行时，gate.js 汇总表末尾是门 2 / 门 3 的绿灯行，
       于是"门 1 红"被显示成"[绿] 门 3"，把下一窗直接指错地方） */
    const lines = r.out.trim().split('\n');
    const red = lines.filter(l => /\[红\]|✖|❌/.test(l));
    const detail = (red.length ? red.slice(-3) : lines.slice(-3)).join(' / ');
    rows[rows.length - 1].res = '❌ 失败：' + (detail || r.err).slice(0, 200);
  }
}

if (JSONOUT) { console.log(JSON.stringify({ tier: TIER || (FULL ? 'T3/T4' : '快档'), hardBad: hardBad, rows: rows }, null, 2)); }
else {
  console.log('=== 收尾一条命令（' + (TIER ? '档 ' + TIER : FULL ? '含全站遍历' : '快档') + '）===');
  rows.forEach(r => {
    const mark = r.pass === null ? '·' : (r.pass ? '✔' : '✖');
    console.log('  ' + mark + ' ' + r.name.padEnd(26) + ' ' + String(r.res).slice(0, 110));
  });
  console.log(hardBad ? '✖ 硬项失败 ' + hardBad + ' 条 —— 按上面的 ❌ 行去修，再跑一次本命令' : '✔ 硬项全过（信息项自己看要不要处理）');
}
process.exit(hardBad ? 1 : 0);
