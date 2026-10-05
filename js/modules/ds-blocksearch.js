'use strict';
/* ============================================================================
 * ds-blocksearch.js —— 【数据结构】分块查找（索引顺序查找）
 * ----------------------------------------------------------------------------
 * 真题考情（**窗26 从零核定**，证据行号见 js/exam-history.js 的条目注释）：
 *   1/18 年，全为选择题：2025-7（400 个元素的表做分块查找，"效率最高时每块元素数"= 20、ASL = 21）。
 *
 * ★ 两个模式（同一个模块，按 select 切换；两边都走快照，模式②也 ≥3 帧）
 *   ① search：**查找过程**——建索引表 → 比索引表定位块 → 块内顺序查找
 *   ② asl   ：**ASL 与最优块长**——精确枚举 s = 1..n 的 ASL，现场看"最小值在 s ≈ √n"
 *
 * ★ 数据模型（快照只读；每帧全量携带）
 *   search：arr（**只要求块间有序**，块内可以无序）｜ s（块长）｜ target
 *           blocks[j] = { j(1 起), lo, hi, max }  ← 第 j 块的下标区间与该块最大关键字
 *           jPos（正在比第几个索引项）｜ blockIdx（定位到的块）｜ scanPos（块内扫描位置）
 *           indexComps / scanComps（两段各自的比较次数）｜ found
 *   asl   ：n ｜ curve = [{ s, b, asl }]（s = 1..n 的精确 ASL）｜ sCur / bCur / aslCur ｜ best
 *
 * ★ 四条不变量（断言见 tmp_t26_blocksearch_smoke.js）
 *   ① 索引表项数 = ⌈n/s⌉，第 j 项 = **第 j 块的最大关键字**；块间有序 ⟹ 索引表**严格递增**；
 *   ② 目标所在块 = **第一个"块最大关键字 ≥ target"的块**（找不到 ⟹ target 比全表最大还大，
 *      索引阶段就能判失败，只花 b 次比较）；
 *   ③ **精确 ASL** = (1/n)·Σ_j Σ_{i=1..len_j} (j + i)（等概率；索引 j 次 + 块内 i 次）；
 *      均分时退化为教材式 (b+1)/2 + (s+1)/2，在 s = √n 处最小（n=400 ⟹ s = 20、ASL = 21）；
 *   ④ 最坏比较次数 = b + s（索引 b 次 + 末块 s 次）。
 *   ⚠ 模式②的"最优 s"用**精确枚举**取值：n = 400 时 s = 20 与 s = 21 同为 21.0（末块不满所致），
 *     真题按教材近似式取 s = √n = 20——这个"并列"必须如实显示，别简化成"唯一最优"。
 *   ⚠ 渲染里的 `bx-idx` / `bx-cell` / `bx-bar`（带 data-s / data-asl）/ `bx-root` 是**给 harness
 *     断言的钩子类名**（不参与样式，布局一律走内联 style，离线没有 Tailwind 也不会塌）。
 * ========================================================================== */

/* 精确 ASL：把 s = 1..n 全枚举一遍（O(n²) 级别，n ≤ 1000 毫秒级） */
function _bsAsl(n, s) {
  const b = Math.ceil(n / s);
  let total = 0;
  for (let jj = 1; jj <= b; jj++) {
    const len = Math.min(s, n - (jj - 1) * s);
    total += len * jj + len * (len + 1) / 2;
  }
  return { b: b, asl: total / n };
}

RC408.registerModule({
  id: 'ds-blocksearch',
  mode: 'stepper',
  title: '分块查找（索引顺序查找）',

  theory: `
> **为什么要有它**：顺序查找要挨个比（\\(ASL=(n+1)/2\\)）、折半查找要求**整体有序且能随机访问**；分块查找取折中——把表分块，**块间有序、块内可以无序**，先查索引表定位到块、再在块内顺序查找。
> **怎么实现**：① 按块长 s 分块，为每块建一个索引项（**该块的最大关键字** + 该块起始下标）；② 拿 target 比索引表，找到**第一个"最大关键字 ≥ target"的块**；③ 在该块内顺序查找。
> **记住什么**：① **块间有序是硬要求，块内不必有序**；② \\(ASL=(b+1)/2+(s+1)/2\\)（b = 块数、s = 块长）；③ **s = √n 时 ASL 最小，约 √n+1**（n = 400 ⟹ s = 20、ASL = 21）；④ 最坏比较次数 = b + s。

## 索引表怎么建（考试第一步）
- 块数 \\(b=\\lceil n/s \\rceil\\)，第 j 块的下标区间是 \\([(j-1)s,\\ js-1]\\)（末块可能不满）；
- 第 j 项的关键字 = 该块**最大**关键字，指针 = 该块**起始**下标；
- 因为块间有序（第 j 块的一切关键字都小于第 j+1 块的最小关键字），**索引表天然严格递增**。

## 平均查找长度（考的就是这个式子）
- 等概率、两段都用顺序查找：\\(ASL=(b+1)/2+(s+1)/2\\)（索引表平均 \\((b+1)/2\\) 次 + 块内平均 \\((s+1)/2\\) 次）；
- 由 \\(n=b\\cdot s\\) 与 \\(b+s\\ge 2√n\\) 知 **\\(s=√n\\) 时 ASL 最小**，最小值约 \\(√n+1\\)；
- n = 400 ⟹ b = s = 20、ASL = 21（2025-7 的设问与答案）。

## 考点提醒（易错点）
1. **块内可以无序**：经典例题第 2 块是 33、42、44、38、24、48 —— 别因为"整表不有序"就判它不能分块查找；
2. **索引表也可以用折半查**（表大时更划算），此时索引那一段的比较次数降到 \\(\\lceil \\log_2(b+1) \\rceil\\) 量级；
3. **两种失败要分清**：① target 比全表最大还大 ⟹ **只比索引表 b 次**即可判失败；② target 落在某块范围内但块内没有 ⟹ 还得把那一块扫完（b + s 次）；
4. **最坏比较次数 = b + s**：比顺序查找的 n 次小、比折半的 \\(\\log_2 n\\) 次大——这正是"折中"的含义；
5. 块长要**尽量均等**；末块不满时 ASL 得按实际长度精确算（本模块模式②就是精确枚举，而不是套近似式）。

> **真题考情**：**1/18 年（全为选择题）**：2025-7（400 个元素分块查找效率最高时每块元素数，答案 20）。
`,

  /* ---------------- 输入表单（★ 每项都必须有 default，§3.8-11） ---------------- */
  inputs: [
    { key: 'mode', label: '演示模式', type: 'select', default: 'search', wide: true,
      options: [{ v: 'search', t: '① 查找过程（索引表定位 + 块内顺序查找）' }, { v: 'asl', t: '② ASL 与最优块长（枚举 s，找 √n）' }],
      help: '模式①看"两级查找"怎么走；模式②看"块长取多少最省"（2025-7 就考这个）' },
    { key: 'arr', label: '表（模式①：4~40 个非负整数，块内可无序）', type: 'textarea', rows: 2, wide: true,
      default: '22, 12, 13, 8, 9, 20, 33, 42, 44, 38, 24, 48, 60, 58, 74, 49, 86, 53',
      help: '默认是教材经典例题：18 个元素、块长 6、索引表 22 / 48 / 86（块内故意无序，块间有序）' },
    { key: 's', label: '块长 s（模式①）', default: '6',
      help: '每块放几个元素；末块不满也允许（此时 ASL 要按实际长度精确算）' },
    { key: 'target', label: '查找目标（模式①）', default: '48',
      help: '48 命中第 2 块末尾；想看重失败可试 40（块内没有）或 90（比全表最大还大）' },
    { key: 'n', label: '元素总数 n（模式②）', default: '400',
      help: '模式②按这个 n 枚举块长 s = 1..n 的 ASL（4~1000）；400 就是 2025-7 真题的参数' },
  ],

  quickActions: [
    { label: '2025 真题（n = 400：最优块长）', run(rt) {
        rt.setInput('mode', 'asl');
        rt.setInput('n', '400');
        rt.load();
      } },
    { label: '经典例题（块长 6，查 48）', run(rt) {
        rt.setInput('mode', 'search');
        rt.setInput('arr', '22, 12, 13, 8, 9, 20, 33, 42, 44, 38, 24, 48, 60, 58, 74, 49, 86, 53');
        rt.setInput('s', '6');
        rt.setInput('target', '48');
        rt.load();
      } },
    { label: '失败例一：块内没有（40）', run(rt) {
        rt.setInput('mode', 'search');
        rt.setInput('arr', '22, 12, 13, 8, 9, 20, 33, 42, 44, 38, 24, 48, 60, 58, 74, 49, 86, 53');
        rt.setInput('s', '6');
        rt.setInput('target', '40');
        rt.load();
      } },
    { label: '失败例二：比全表最大还大（90）', run(rt) {
        rt.setInput('mode', 'search');
        rt.setInput('arr', '22, 12, 13, 8, 9, 20, 33, 42, 44, 38, 24, 48, 60, 58, 74, 49, 86, 53');
        rt.setInput('s', '6');
        rt.setInput('target', '90');
        rt.load();
      } },
    { label: '🎲 随机块间有序表', run(rt) {
        const s = RC408.util.rnd(3, 6);
        const bn = RC408.util.rnd(3, 4);
        const arr = [];
        let base = RC408.util.rnd(0, 5);
        for (let jj = 0; jj < bn; jj++) {
          const vals = [];
          for (let i = 0; i < s; i++) vals.push(base + RC408.util.rnd(0, 5));
          for (let i = vals.length - 1; i > 0; i--) { const k = RC408.util.rnd(0, i); const t = vals[i]; vals[i] = vals[k]; vals[k] = t; }
          const mx = Math.max.apply(null, vals);
          base = mx + 1 + RC408.util.rnd(1, 4);      // 抬到上一块最大值之上 ⟹ 保证块间有序
          arr.push.apply(arr, vals);
        }
        rt.setInput('mode', 'search');
        rt.setInput('arr', arr.join(', '));
        rt.setInput('s', String(s));
        rt.setInput('target', String(arr[RC408.util.rnd(0, arr.length - 1)]));
        rt.load();
      } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const mode = vals.mode === 'asl' ? 'asl' : 'search';
    if (mode === 'asl') {
      const n = parseInt(vals.n, 10);
      if (!Number.isInteger(n) || n < 4 || n > 1000) throw { message: '模式②的元素总数 n 要是 4~1000 的整数（默认 400）' };
      return { mode: 'asl', n: n };
    }
    const arr = String(vals.arr || '').split(/[^0-9]+/).filter(Boolean).map(Number);
    if (arr.length < 4) throw { message: '模式①至少输入 4 个元素' };
    if (arr.length > 40) throw { message: '模式①最多 40 个元素（再多画不下，也看不清块内顺序查找）' };
    const s = parseInt(vals.s, 10);
    if (!Number.isInteger(s) || s < 1) throw { message: '块长 s 要是正整数' };
    if (s > arr.length) throw { message: '块长 s = ' + s + ' 超过了元素总数 ' + arr.length };
    const target = parseInt(vals.target, 10);
    if (!Number.isInteger(target) || target < 0) throw { message: '查找目标要是非负整数' };
    /* 建索引表 + 校验"块间有序"（这是分块查找唯一的硬前提） */
    const blocks = [];
    for (let lo = 0; lo < arr.length; lo += s) {
      const hi = Math.min(arr.length, lo + s) - 1;
      let mx = arr[lo];
      for (let i = lo + 1; i <= hi; i++) if (arr[i] > mx) mx = arr[i];
      blocks.push({ j: blocks.length + 1, lo: lo, hi: hi, max: mx });
    }
    for (let jj = 1; jj < blocks.length; jj++) {
      for (let i = blocks[jj].lo; i <= blocks[jj].hi; i++) {
        if (arr[i] <= blocks[jj - 1].max) {
          throw { message: '第 ' + (jj + 1) + ' 块里的 ' + arr[i] + ' 不大于第 ' + jj + ' 块的最大值 ' + blocks[jj - 1].max + '：分块查找要求**块间有序**（块内可以无序）' };
        }
      }
    }
    return { mode: 'search', arr: arr, s: s, target: target, blocks: blocks };
  },

  /* ---------------- ② 纯算法 ---------------- */
  buildSnapshots(model) {
    const snaps = [];
    const push = (step, extra) => snaps.push(Object.assign({
      step: step, mode: model.mode, s: model.s, n: model.arr ? model.arr.length : model.n,
      arr: model.arr ? model.arr.slice() : [], blocks: model.blocks ? model.blocks.map(b => ({ j: b.j, lo: b.lo, hi: b.hi, max: b.max })) : [],
      target: model.target, jPos: -1, blockIdx: -1, scanPos: -1,
      indexComps: 0, scanComps: 0, found: -1,
      log: '', logType: 'info', desc: '',
    }, extra || {}));

    /* ================= 模式②：ASL 与最优块长 ================= */
    if (model.mode === 'asl') {
      const n = model.n;
      const curve = [];
      let minAsl = Infinity;
      for (let s = 1; s <= n; s++) {
        const r = _bsAsl(n, s);
        curve.push({ s: s, b: r.b, asl: r.asl });
        if (r.asl < minAsl - 1e-9) minAsl = r.asl;
      }
      const bestS = curve.filter(p => Math.abs(p.asl - minAsl) < 1e-9).map(p => p.s);
      const root = Math.round(Math.sqrt(n));
      const repS = [];
      [1, Math.max(1, Math.round(root / 2)), Math.max(1, root - 1), root, Math.min(n, root + 1), n].forEach(v => {
        if (v >= 1 && v <= n && repS.indexOf(v) < 0) repS.push(v);
      });
      const at = s => curve[s - 1];
      const best = { sList: bestS, asl: minAsl, root: root };

      push('init', {
        mode: 'asl', s: 0, curve: curve, best: best, repS: repS, sCur: 0, bCur: 0, aslCur: 0,
        log: '就绪：元素总数 n = ' + n + '。教材近似式 ASL = (b+1)/2 + (s+1)/2（b = ⌈n/s⌉）、最小值在 s = √n ≈ ' + root + ' 附近；下面逐档单步，看精确枚举的曲线。',
        desc: '点击「单步执行」：逐档看 s 变化时 ASL 怎么走',
      });
      repS.forEach((s, i) => {
        const p = at(s);
        const isBest = Math.abs(p.asl - minAsl) < 1e-9;
        push('aslsweep', {
          mode: 'asl', s: s, sCur: s, bCur: p.b, aslCur: p.asl, curve: curve, best: best, repS: repS,
          log: 's = ' + s + '：块数 b = ⌈' + n + '/' + s + '⌉ = ' + p.b + '，精确 ASL = ' + p.asl.toFixed(3) + (isBest ? '（已经是本次枚举的最小值）' : ''),
          logType: isBest ? 'success' : 'info',
          desc: 's = ' + s + ' → b = ' + p.b + '、ASL = ' + p.asl.toFixed(3) + (isBest ? '（最小）' : ''),
        });
      });
      push('done', {
        mode: 'asl', s: 0, curve: curve, best: best, repS: repS, sCur: 0, bCur: 0, aslCur: 0,
        log: '结论：n = ' + n + ' 时**精确枚举**的最小 ASL = ' + minAsl.toFixed(3) + '，出现在 s = ' + bestS.join(' 与 ') +
          '（教材近似式给 s = √n = ' + root + '）' + (bestS.length > 1 ? '；末块不满会让相邻的 s 打平，属正常现象。' : '。'),
        logType: 'success',
        desc: '最优块长 s = ' + bestS.join('/') + '，ASL = ' + minAsl.toFixed(3),
      });
      return snaps;
    }

    /* ================= 模式①：查找过程 ================= */
    const arr = model.arr, blocks = model.blocks, target = model.target;
    push('init', {
      log: '就绪：' + arr.length + ' 个元素的表，块长 s = ' + model.s + ' ⟹ ' + blocks.length +
        ' 块；索引表 = ' + blocks.map(b => b.max).join('、') + '（每项是该块最大关键字）。查找目标 ' + target + '。',
      desc: '点击「单步执行」：先比索引表定位块，再在块内顺序查找',
    });

    let blockIdx = -1, indexComps = 0;
    for (let jj = 0; jj < blocks.length; jj++) {
      indexComps++;
      const hit = blocks[jj].max >= target;
      push('index', {
        jPos: jj, blockIdx: hit ? jj : -1, indexComps: indexComps,
        log: '索引表第 ' + (jj + 1) + ' 项：该块最大关键字 ' + blocks[jj].max + (hit ? ' ≥ ' : ' < ') + '目标 ' +
          target + (hit ? ' → 目标只可能在这块里（定位到第 ' + (jj + 1) + ' 块）' : ' → 目标不在这块，继续比下一项'),
        logType: hit ? 'success' : 'info',
        desc: '索引表比较 ' + indexComps + ' 次：第 ' + (jj + 1) + ' 块最大 ' + blocks[jj].max,
      });
      if (hit) { blockIdx = jj; break; }
    }

    if (blockIdx < 0) {
      push('fail', {
        jPos: blocks.length - 1, indexComps: indexComps, blockIdx: -1,
        log: '索引表全部比完：每块的最大关键字都小于目标 ' + target + ' ⟹ 目标比全表最大关键字 ' + blocks[blocks.length - 1].max +
          ' 还大，**只花 ' + indexComps + ' 次比较就判失败**（不必进任何块）。',
        logType: 'error',
        desc: '查找失败：目标超过全表最大值（索引阶段即判失败，共 ' + indexComps + ' 次比较）',
      });
    } else {
      const blk = blocks[blockIdx];
      push('block', {
        jPos: blockIdx, blockIdx: blockIdx, indexComps: indexComps,
        log: '定位到第 ' + blk.j + ' 块（下标 ' + blk.lo + '~' + blk.hi + '）：块内最大 ' + blk.max + ' ≥ ' + target +
          '，且它前面每块的最大值都小于 ' + target + '。下面在这块里顺序查找。',
        logType: 'info',
        desc: '定位到第 ' + blk.j + ' 块（索引比较 ' + indexComps + ' 次），开始块内顺序查找',
      });
      let found = -1, scanComps = 0;
      for (let i = blk.lo; i <= blk.hi; i++) {
        scanComps++;
        const eq = arr[i] === target;
        push('scan', {
          jPos: blockIdx, blockIdx: blockIdx, scanPos: i, indexComps: indexComps, scanComps: scanComps,
          found: eq ? i : -1,
          log: '块内第 ' + scanComps + ' 次比较：a[' + i + '] = ' + arr[i] + (eq ? ' = ' : ' ≠ ') + '目标 ' + target +
            (eq ? ' → 查找成功' : ' → 继续下一个'),
          logType: eq ? 'success' : 'info',
          desc: eq ? '命中 a[' + i + ']（块内第 ' + scanComps + ' 次比较）' : '块内比较 ' + scanComps + ' 次：a[' + i + '] = ' + arr[i],
        });
        if (eq) { found = i; break; }
      }
      if (found < 0) {
        push('fail', {
          jPos: blockIdx, blockIdx: blockIdx, scanPos: blk.hi, indexComps: indexComps, scanComps: scanComps,
          log: '第 ' + blk.j + ' 块扫完都没命中 ⟹ 查找失败。总比较次数 = 索引 ' + indexComps + ' + 块内 ' + scanComps +
            ' = ' + (indexComps + scanComps) + ' 次（最坏情形就是 b + s）。',
          logType: 'error',
          desc: '查找失败：目标在第 ' + blk.j + ' 块的范围里但块内没有（共 ' + (indexComps + scanComps) + ' 次比较）',
        });
      }
    }

    const lastIdx = snaps.length - 1;
    const last = snaps[lastIdx];
    push('done', {
      jPos: last.jPos, blockIdx: last.blockIdx, scanPos: last.scanPos,
      indexComps: last.indexComps, scanComps: last.scanComps, found: last.found,
      log: (last.found >= 0 ? '查找成功：' + target + ' 在位置 ' + last.found : '查找失败：' + target + ' 不在表里') +
        '；比较次数 = 索引 ' + last.indexComps + ' + 块内 ' + last.scanComps + ' = ' + (last.indexComps + last.scanComps) +
        '（最坏 b + s = ' + (blocks.length + model.s) + '，顺序查找要 ' + arr.length + ' 次）',
      logType: last.found >= 0 ? 'success' : 'error',
      desc: (last.found >= 0 ? '成功：位置 ' + last.found : '失败') + '，共比较 ' + (last.indexComps + last.scanComps) + ' 次',
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染（只有内联布局，不靠 Tailwind 工具类——离线 harness 不加载 CDN） ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;

    /* ---------- 模式②：ASL 曲线 ---------- */
    if (s.mode === 'asl') {
      const n = s.n;
      const curve = s.curve || [];
      const root = s.best ? s.best.root : Math.round(Math.sqrt(n));
      const Smax = Math.min(n, Math.max(6, Math.round(root * 2.5) + 6));
      const win = curve.filter(p => p.s <= Smax);
      const asls = win.map(p => p.asl);
      const lo = Math.min.apply(null, asls), rawHi = Math.max.apply(null, asls);
      /* ★ 纵轴**截断显示**：s = 1 的 ASL = (n+1)/2+1 是其余柱子的十倍量级（n=400 时 201.5 vs 21），
         不截断的话除最左一根以外全被压成一条线，"√n 处最低"的 U 形根本看不出来。
         截断上限取"最小值 + max(4, 最小值的 50%)"，超出的柱子顶到框上并标注。 */
      const hi = Math.min(rawHi, lo + Math.max(4, lo * 0.5));
      const clipped = asls.filter(v => v > hi).length;
      const W = Math.max(520, Smax * 13 + 74), H = 218, padL = 48, padT = 16, padB = 30;
      const plotW = W - padL - 16, plotH = H - padT - padB;
      const yOf = v => padT + plotH - ((Math.min(v, hi) - lo) / (hi - lo || 1)) * (plotH - 8) - 4;
      const barW = Math.max(3, plotW / Smax - 2);
      const bars = win.map(p => {
        const x = padL + (p.s - 1) * (plotW / Smax);
        const y = yOf(p.asl);
        const isCur = s.sCur === p.s;
        const isBest = s.best && s.best.sList.indexOf(p.s) >= 0;
        const col = isCur ? '#4f46e5' : isBest ? '#10b981' : '#c7d2fe';
        const mark = p.asl > hi
          ? '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (padT - 3) + '" text-anchor="middle" style="font:700 9px sans-serif" fill="#94a3b8">↑</text>'
          : '';
        return mark + '<rect class="bx-bar" data-s="' + p.s + '" data-asl="' + p.asl.toFixed(3) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + (padT + plotH - y).toFixed(1) + '" rx="2" fill="' + col + '"/>';
      }).join('');
      const labelBars = win.filter(p => p.asl <= hi && ((s.best && s.best.sList.indexOf(p.s) >= 0) || s.sCur === p.s || p.s === 1)).map(p => {
        const x = padL + (p.s - 1) * (plotW / Smax) + barW / 2;
        return '<text x="' + x.toFixed(1) + '" y="' + (yOf(p.asl) - 4).toFixed(1) + '" text-anchor="middle" style="font:700 9px sans-serif" fill="#334155">' + p.asl.toFixed(1) + '</text>' +
          '<text x="' + x.toFixed(1) + '" y="' + (H - padB + 12) + '" text-anchor="middle" style="font:600 9px sans-serif" fill="#94a3b8">' + p.s + '</text>';
      }).join('');
      const rootX = padL + (root - 0.5) * (plotW / Smax);
      const rootMark = root <= Smax
        ? '<line class="bx-root" x1="' + rootX.toFixed(1) + '" y1="' + padT + '" x2="' + rootX.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4 3"/>' +
          '<text x="' + rootX.toFixed(1) + '" y="' + (padT - 4) + '" text-anchor="middle" style="font:700 10px sans-serif" fill="#b45309">√n = ' + root + '</text>'
        : '';

      const repRows = (s.repS || []).map(rc => {
        const p = curve[rc - 1];
        const isCur = s.sCur === rc, isBest = s.best && s.best.sList.indexOf(rc) >= 0;
        return '<tr class="' + (isCur ? 'row-cur' : '') + '"><td class="font-mono">' + rc + '</td><td class="font-mono">' + p.b +
          '</td><td class="font-mono">' + p.asl.toFixed(3) + '</td><td>' + (isBest ? '最小' : (rc === root ? '≈ √n' : rc < root ? '块太小（索引查得久）' : '块太大（块内查得久）')) + '</td></tr>';
      }).join('');

      const stats =
        RC408.ui.statCard('元素总数 n', n, '模式②按 s = 1..n 精确枚举', 'text-indigo-600') +
        RC408.ui.statCard('理论最优 s', '√n ≈ ' + root, '教材近似式的结论', 'font-mono') +
        RC408.ui.statCard('精确最小 ASL', s.best ? s.best.asl.toFixed(3) : '—', '出现在 s = ' + (s.best ? s.best.sList.join(' / ') : '—'), 'text-emerald-600') +
        RC408.ui.statCard('当前块长 s', s.sCur || '—', s.sCur ? 'b = ⌈n/s⌉ = ' + s.bCur + '，ASL = ' + s.aslCur.toFixed(3) : '点「单步执行」逐档看', 'text-amber-600');

      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
            ${RC408.ui.sectionTitle('精确 ASL(s) 曲线（画到 s = ' + Smax + '；绿 = 最小值，靛蓝 = 当前档，橙虚线 = √n）')}
            <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${Math.max(W, 560)}px">
              <line x1="${padL}" y1="${padT + plotH}" x2="${W - 16}" y2="${padT + plotH}" stroke="#cbd5e1" stroke-width="1.5"/>
              <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" style="font:600 9px sans-serif" fill="#94a3b8">${clipped ? '≥' : ''}${hi.toFixed(1)}</text>
              <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" style="font:600 9px sans-serif" fill="#94a3b8">${lo.toFixed(1)}</text>
              <text x="14" y="${padT + plotH / 2}" style="font:700 10px sans-serif" fill="#64748b" transform="rotate(-90 14 ${padT + plotH / 2})" text-anchor="middle">ASL</text>
              <text x="${padL + plotW / 2}" y="${H - 4}" text-anchor="middle" style="font:700 10px sans-serif" fill="#64748b">块长 s（每块元素数）</text>
              ${bars}${rootMark}${labelBars}
            </svg>
            ${clipped ? '<div class="text-[11px] text-slate-400 mt-1">纵轴已截断显示（上限 ' + hi.toFixed(1) + '）：s = 1 的 ASL = ' + rawHi.toFixed(1) + ' 顶到框外，柱顶标 ↑；不截断的话其余柱子会被压成一条线，看不出 √n 附近的最低点。</div>' : ''}
          </div>

          <div>
            ${RC408.ui.sectionTitle('代表档位（当前档高亮）')}
            <div class="overflow-x-auto rounded-xl border border-slate-200">
              <table class="tbl w-full"><thead><tr><th>块长 s</th><th>块数 b</th><th>精确 ASL</th><th>说明</th></tr></thead><tbody>${repRows}</tbody></table>
            </div>
          </div>

          <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
            ${RC408.ui.legend('#10b981', 'ASL 最小的块长')}
            ${RC408.ui.legend('#4f46e5', '当前档')}
            ${RC408.ui.legend('#f59e0b', 's = √n（教材近似式的结论）')}
          </div>

          <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
            💡 <b>考点提醒：</b>ASL = (b+1)/2 + (s+1)/2，b 与 s 一升一降，<b>s = √n 时和最小</b>、约 √n+1；
            n = 400 ⟹ s = 20、ASL = 21（2025-7 的答案）。⚠ 末块不满时相邻的 s 会打平——本模块如实显示"并列最优"，别背成"唯一最优"。
          </div>
        </div>`;
      return;
    }

    /* ---------- 模式①：查找过程 ---------- */
    const arr = s.arr || [], blocks = s.blocks || [], n = arr.length;
    const inBlk = i => blocks.findIndex(b => i >= b.lo && i <= b.hi);
    const stats =
      RC408.ui.statCard('块数 / 块长', blocks.length + ' / ' + model.s, '索引表项数 = ⌈n/s⌉ = ' + blocks.length, 'font-mono') +
      RC408.ui.statCard('查找目标', s.target, s.step === 'done' ? (s.found >= 0 ? '已找到' : '不在表里') : '两级查找中', 'text-indigo-600') +
      RC408.ui.statCard('已比较次数', s.indexComps + s.scanComps, '索引 ' + s.indexComps + ' + 块内 ' + s.scanComps + '（最坏 b+s = ' + (blocks.length + model.s) + '）', 'text-amber-600') +
      RC408.ui.statCard('结论', s.step === 'done' ? (s.found >= 0 ? '位置 ' + s.found : '查找失败') : '—', s.step === 'done' ? '共 ' + (s.indexComps + s.scanComps) + ' 次比较' : '顺序查找要 ' + n + ' 次', s.step === 'done' && s.found >= 0 ? 'text-emerald-600' : 'text-slate-600');

    /* 索引表行：每项 = 该块最大关键字 */
    const idxCells = blocks.map((b, jj) => {
      const cur = s.jPos === jj && (s.step === 'index' || s.step === 'block' || s.step === 'scan' || s.step === 'fail');
      const picked = s.blockIdx === jj;
      return '<div class="bx-idx" style="display:flex;flex-direction:column;align-items:center;gap:2px">' +
        '<span class="chip ' + (cur ? 'chip-cur' : picked ? 'chip-hit' : '') + '">' + b.max + '</span>' +
        '<span style="font:600 9px sans-serif;color:#94a3b8">第 ' + b.j + ' 块</span></div>';
    }).join('');

    /* 数据行：按块分色（块内可以无序，所以块内不排序） */
    const arrCells = arr.map((v, i) => {
      const bi = inBlk(i);
      const scanning = s.scanPos === i && (s.step === 'scan' || s.step === 'fail');
      const found = s.found === i;
      const dim = s.blockIdx >= 0 && bi !== s.blockIdx && (s.step === 'scan' || s.step === 'block');
      const bg = bi % 2 === 0 ? '#f8fafc' : '#fff';
      return '<div class="bx-cell" style="display:flex;flex-direction:column;align-items:center;gap:2px;opacity:' + (dim ? 0.4 : 1) + '">' +
        '<span class="chip ' + (found ? 'chip-hit' : scanning ? 'chip-cur' : '') + '" style="background:' + (scanning || found ? '' : bg) + '">' + v + '</span>' +
        '<span style="font:600 9px Consolas,monospace;color:#94a3b8">' + i + '</span></div>';
    }).join('');

    const aslApprox = (blocks.length + 1) / 2 + (model.s + 1) / 2;
    const exact = _bsAsl(n, model.s);

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('索引表（每项 = 该块最大关键字；块间有序 ⟹ 索引表严格递增）')}
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">${idxCells}</div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('表（同色 = 同一块，块内允许无序；当前比较的格子高亮）')}
          <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${arrCells}</div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#6366f1', '本帧比较的元素 / 索引项')}
          ${RC408.ui.legend('#10b981', '命中 / 已定位的块')}
          ${RC408.ui.legend('#cbd5e1', '本次不会再看的部分（淡出）')}
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>本参数下 ASL = (b+1)/2 + (s+1)/2 = (${blocks.length}+1)/2 + (${model.s}+1)/2 = ${aslApprox.toFixed(2)}
          （末块不满时以精确枚举 ${exact.asl.toFixed(3)} 为准）；<b>块间有序是硬前提</b>，块内可以无序；
          最坏比较次数 = b + s = ${blocks.length + model.s}。想看"块长取多少最省"，切到模式②（2025-7 就考那个）。
        </div>
      </div>`;
  },
});
