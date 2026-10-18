'use strict';
/* ============================================================================
 * tools/t_lib/page.js —— **共享测试库 · 离线 harness 与页面事实采集**（2026-10-12 立）
 * ----------------------------------------------------------------------------
 * 以前每窗都要抄一遍：① 从 index.html 生成"没有 Tailwind 的离线 harness"（摘 CDN + 摘窗34 兜底段 +
 *   `tailwind.config` → `window.tailwind.config`）；② 逐帧读 DOM（`td`/`th`/`svg`/`circle`/统计卡/溢出/脏值）；
 *   ③ 量压盖；④ `seek(len-1)`。这四件事全部焊在这里。
 * 焊进去的教训：
 *   · 离线 harness **故意不加载 Tailwind**（基线就是"没有 Tailwind"，§6.2.34⑨）——摘不掉兜底段要**当场抛错**；
 *   · `seek` 必须**分两次求值**（先读长度、再 seek）—— 同一次求值里读到的长度可能还是上一份快照的（窗50：预设 #2 假红）；
 *   · 脏值扫描要覆盖 `NaN` / `undefined` / `[object Object]` / 字面 `${}`（§6.2.44⑤）。
 * 用法：
 *   const { buildHarness, frameFacts, seekLast, overlap } = require('./tools/t_lib/page');
 *   buildHarness({ root: __dirname, out: 'tmp_harness_x.html' });
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

/* ---------- ① 离线 harness ---------- */
function buildHarness(opt) {
  const o = opt || {};
  const root = o.root || process.cwd();
  const src = path.join(root, o.src || 'index.html');
  const out = path.join(root, o.out || 'tmp_harness_lib.html');
  let html = fs.readFileSync(src, 'utf8');
  html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/, '');
  html = html.replace(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net[^"]*">\s*/, '');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>\s*/g, '');
  const before = html.length;
  html = html.replace(/<!-- Tailwind 兜底（窗34）[\s\S]*?<!-- Tailwind 兜底结束 -->\s*/, '');
  if (html.length >= before) throw new Error('Tailwind 兜底段没摘掉——锚点被改了？（§6.2.34⑨）');
  html = html.replace(/tailwind\.config\s*=/g, '(window.tailwind = window.tailwind || {}).config =');
  if (o.css) html = html.replace('</head>', '<style id="harness-css">\n' + o.css + '\n</style>\n</head>');
  fs.writeFileSync(out, html, 'utf8');
  return { file: out, bytes: fs.statSync(out).size };
}

/* ---------- ② 逐帧读 DOM 事实（**探针一律回对象**，§6.2.42⑤） ---------- */
const FRAME_PROBE = `(function(){
  var stage=document.getElementById('stage');
  var tbl=stage.querySelector('table');
  var svgs=[].slice.call(stage.querySelectorAll('svg'));
  var cards={};
  [].slice.call(stage.querySelectorAll('.stat-card, [class*=stat]')).forEach(function(e){
    var t=e.textContent.replace(/\\s+/g,' ').trim();
    var m=t.match(/^([^0-9\\-—]+)\\s*(-?[0-9.]+)/); if(m) cards[m[1].trim()]=m[2];
  });
  var html=stage.innerHTML;
  var dirty=html.match(/NaN|undefined|\\[object Object\\]|\\$\\{/);
  return { td: tbl?tbl.querySelectorAll('td').length:-1,
           theadTh: tbl?tbl.querySelectorAll('thead th').length:-1,
           allTh: tbl?tbl.querySelectorAll('th').length:-1,
           rows: tbl?tbl.querySelectorAll('tbody tr').length:-1,
           tables: stage.querySelectorAll('table').length,
           svg: svgs.length,
           circles: svgs.map(function(s){return s.querySelectorAll('circle').length;}),
           cards: cards,
           overflow: stage.scrollWidth - stage.clientWidth,
           dirty: dirty?dirty[0]:'',
           step: (RC408.Runner.snaps[RC408.Runner.idx]||{}).step || '',
           idx: RC408.Runner.idx, len: RC408.Runner.snaps.length,
           textLen: stage.textContent.replace(/\\s+/g,' ').trim().length };
})()`;
async function frameFacts(b) { return b.J(FRAME_PROBE); }

/* ---------- ③ seek：**分两次求值**（窗50 的假红就是在这里） ---------- */
async function seekLast(b) {
  const len = await b.ev('RC408.Runner.snaps.length');
  await b.ev('RC408.Runner.seek(' + (len - 1) + ')');
  return { len: len, idx: len - 1 };
}
async function seekAll(b, fn) {
  const len = await b.ev('RC408.Runner.snaps.length');
  for (let i = 0; i < len; i++) { await b.ev('RC408.Runner.seek(' + i + ')'); await b.sleep(45); await fn(i); }
  return len;
}

/* ---------- ④ 压盖：**同一行内两两比**（§3.8-18；别拿容器宽度当遮羞布） ---------- */
async function overlap(b, sel, tag) {
  const r = await b.J(`(function(){
    var hits=[]; [].slice.call(document.querySelectorAll(${JSON.stringify(sel)})).forEach(function(box,bi){
      var es=[].slice.call(box.querySelectorAll('th,td,circle,.stat-card,svg')).map(function(e){var r=e.getBoundingClientRect();
        return {l:r.left,r:r.right,t:r.top,b:r.bottom,x:(e.textContent||'').slice(0,6)};});
      for(var i=0;i<es.length;i++) for(var j=i+1;j<es.length;j++){
        if(Math.abs(es[i].t-es[j].t)<2 && es[i].r-2>es[j].l && es[j].r-2>es[i].l)
          hits.push(${JSON.stringify(tag || '')}+'#'+bi+':'+es[i].x+'/'+es[j].x);
      }
    }); return { count: hits.length, hits: hits.slice(0,6) }; })()`);
  return r;
}

/* ---------- ④b 裁切：**每个"面板"自身有没有横向溢出**（窗56 新增） ----------
 * 为什么单列一条：`#stage` 的 `scrollWidth − clientWidth` 常是 0 —— 因为外层有 `flex-wrap` / grid
 * 会把面板换行，**而单个面板内部先溢出**（长表格 / 固定宽标签），溢出部分直接被裁掉、用户看到"半块"。
 * 判据 = 逐个量 `scrollWidth − clientWidth`（阈值 1px 容渲染抖动），点名是哪一块面板、超了多少。
 * ⚠ 用前先确保视口接近真实：**默认 1500 宽的 headless 窗口会盖住窄视口下的截断** ⟹ 多视口各起一次实例
 * （`open({size:'1180,1500'})`）。 */
async function clipCheck(b, sel) {
  const r = await b.J(`(function(){
    var hits=[]; [].slice.call(document.querySelectorAll(${JSON.stringify(sel || '#stage .tl-stage-card, #stage [class*=panel]')}))
      .forEach(function(e){
        var over=e.scrollWidth-e.clientWidth;
        if(over>1) hits.push((e.getAttribute('data-st')||e.className||'?')+' 超 '+over+'px');
      });
    var st=document.getElementById('stage');
    var stageOver=st?st.scrollWidth-st.clientWidth:0;
    return { count: hits.length, hits: hits.slice(0,6), stageOver: stageOver };})()`);
  return r;
}

/* ---------- ⑤ 断言辅助：脏值 / 溢出 / 统计卡 ---------- */
function dirtyProblems(facts) {
  const p = [];
  if (facts.dirty) p.push('帧 ' + facts.idx + ' 渲染含 ' + facts.dirty);
  if (facts.overflow > 1) p.push('帧 ' + facts.idx + ' 横向溢出 ' + facts.overflow + 'px');
  return p;
}

module.exports = { buildHarness, frameFacts, seekLast, seekAll, overlap, clipCheck, dirtyProblems };
