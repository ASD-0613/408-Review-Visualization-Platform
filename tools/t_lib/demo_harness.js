'use strict';
/* ============================================================================
 * tools/t_lib/demo_harness.js —— **共享测试库的样板**（照抄它改，别再从零写 harness）
 * ----------------------------------------------------------------------------
 * 它做的事 = 以前每窗手写 200~300 行的那些样板：
 *   生成离线 harness → 起无头浏览器 → 挂载模块 → 逐帧读 DOM 事实（td/th/svg/circle/统计卡/溢出/脏值）
 *   → 量压盖 → 末帧关键文案 → 逐个预设走 UI 点击 → CDP 零异常 → 截图 → 关实例（只 Browser.close）
 * **这个样板本身只写"模块特有"的断言**（下面标 ★ 的几行），其余全在库里。
 * 用法：node tools/t_lib/demo_harness.js --module ds-dag-expr [--port 9310] [--no-shots]
 *       默认静音（只打失败 + 汇总）；要全量 ✔ 就加 `--verbose`。
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { open } = require('./cdp');
const C = require('./check');
const P = require('./page');
const S = require('./smoke');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] && process.argv[i + 1][0] !== '-' ? process.argv[i + 1] : d; };
const MOD = arg('module', 'ds-dag-expr');
const PORT = Number(arg('port', '9310'));
const NOSHOTS = process.argv.indexOf('--no-shots') >= 0;

(async () => {
  /* ---------- Node 侧现算（第二条路径；断言全部对着它比） ---------- */
  S.load(ROOT, ['js/framework.js', 'js/exam-history.js', 'js/modules/' + MOD + '.js']);
  const def = S.module(MOD);
  const r0 = S.run(def);
  const want0 = { frames: r0.s.length, n: (r0.m.nodes || []).length, total: r0.s[r0.s.length - 1].total };

  C.section('契约');
  S.contract(def).forEach(p => C.red(p));
  C.ok(!!def.parse && !!def.buildSnapshots && !!def.render, '模块契约齐（parse / buildSnapshots / render）');

  /* ---------- 离线 harness + 浏览器 ---------- */
  const h = P.buildHarness({ root: ROOT, out: 'tmp_harness_lib.html' });
  C.note('harness ' + path.basename(h.file) + ' ' + h.bytes + ' bytes');
  const b = await open({ root: ROOT, port: PORT, profile: 'tmp_chrome_profile_lib_' + PORT });
  await b.navigate('file:///' + h.file.replace(/\\/g, '/'));
  await b.sleep(8000);

  try {
    C.section('挂载 + 逐帧');
    const mount = await b.J(`(function(){RC408.Runner.open(${JSON.stringify(MOD)});
      return {topic:RC408.Runner.topicId, svg:document.querySelectorAll('#stage svg').length,
              stageLen:(document.getElementById('stage').innerHTML||'').length};})()`);
    C.eq(mount.topic, MOD, '打开的是本模块');
    C.ok(mount.svg >= 1 && mount.stageLen > 300, 'stage 已渲染且含 SVG（' + mount.stageLen + ' 字符 / ' + mount.svg + ' 个 svg）');
    C.eq(await b.ev('RC408.Runner.snaps.length'), want0.frames, '帧数与 Node 现算一致');

    let dirty = 0, over = 0, frames = 0;
    await P.seekAll(b, async (i) => {
      const f = await P.frameFacts(b);
      frames++;
      const probs = P.dirtyProblems(f);
      probs.forEach(p => { if (p.indexOf('溢出') >= 0) over++; else dirty++; C.red(p); });
      if (f.svg < 1) C.red('帧 ' + i + ' 没有 SVG');
    });
    C.eq(frames, want0.frames, '逐帧走完（' + frames + ' 帧）');
    C.eq(dirty, 0, '逐帧渲染无脏值（NaN / undefined / [object Object] / 字面 ${}）');
    C.eq(over, 0, '逐帧 #stage 无横向溢出');

    C.section('几何');
    const ov = await P.overlap(b, '#stage svg', 'svg');
    C.eq(ov.count, 0, '同行圆/格无压盖（命中：' + (ov.hits || []).join(' ') + '）');

    C.section('末帧 + 预设走 UI');
    await P.seekLast(b); await b.sleep(120);
    const last = await P.frameFacts(b);
    C.eq(last.step, 'done', '末帧 step=done（idx ' + last.idx + '/' + last.len + '）');
    C.ok(last.circles[last.circles.length - 1] === want0.total, '末帧顶点数 = ' + want0.total + '（实测 ' + last.circles[last.circles.length - 1] + '）');
    if (!NOSHOTS) C.note('📷 ' + await b.shot('lib_' + MOD + '.png', { sel: '#stage' }));

    for (const p of S.presets(def)) {
      const clicked = await b.J(`(function(){var bs=[].slice.call(document.querySelectorAll('#input-area button'));
        var hit=bs.find(function(x){return x.textContent.indexOf(${JSON.stringify(String(p.label).slice(0, 8))})>=0;});
        if(!hit)return{ok:false,n:bs.length}; hit.click(); return {ok:true};})()`);
      C.ok(clicked.ok, '预设 #' + p.i + ' 按钮在 UI 里：' + String(p.label).slice(0, 18));
      await b.sleep(200);
      const len = await P.seekLast(b);
      const f = await P.frameFacts(b);
      C.eq(f.step, 'done', '预设 #' + p.i + ' 停在末帧（idx ' + f.idx + '/' + f.len + '）');
      C.ok(!p.err && f.td > 0, '预设 #' + p.i + ' 能跑通并渲染（' + (p.err || ('td ' + f.td)) + '）');
    }

    C.section('CDP');
    C.eq(b.exceptions.length, 0, 'CDP 零异常' + (b.exceptions.length ? '：' + b.exceptions.slice(0, 2).join(' | ') : ''));
  } finally {
    C.note('浏览器：' + await b.close());
  }
  process.exit(C.finish() ? 1 : 0);
})().catch(e => { console.log('跑挂了：' + (e && e.stack || e)); process.exit(1); });
