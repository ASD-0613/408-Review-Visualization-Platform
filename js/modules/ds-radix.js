'use strict';
/* ============================================================================
 * ds-radix.js —— 【数据结构】基数排序（按位分配 / 收集，LSD 低位优先）
 * ----------------------------------------------------------------------------
 * 真题考情（**窗26 从零核定**，逐条回缓存取证，证据行号见 js/exam-history.js 的条目注释）：
 *   3/18 年，全为选择题：2013-11（两趟后的序列反推算法）、2021-10（LSD 第 1 趟收集后
 *   372 的前后紧邻元素）、2026-10（先按 C1 再按总乘积排序 ⟹ 多关键字 LSD）。
 *   （另有 2010-11 / 2015-9 / 2025-11 看着像但**不登记本模块**，理由写在 exam-history 注释里。）
 *
 * ★ 数据模型（快照只读；每帧全量携带，便于任意跳帧回放）
 *   items: [{ v, i0 }]  —— v = 关键字，i0 = **最初位次**（0 起，只用于演示"稳定性"）
 *   r: 基数（桶的个数，10 或 2）｜ d: 趟数 = 最大关键字的 r 进制位数
 *   一趟 = ①**分配**：顺序扫描当前序列，把每个记录**尾追加**进第 digit 个队列
 *          ②**收集**：从 0 号队列到 r−1 号队列，依次把队头到队尾接成新序列
 *
 * ★ 四条不变量（本模块全部断言都围着它们写，见 tmp_t26_radix_smoke.js）
 *   ① **d 趟之后必升序**（LSD：后一趟按更高位分配，且分配-收集是稳定的 ⟹ 地位有序被保留）；
 *   ② **稳定**：分配是尾追加、收集按下标升序 ⟹ 同值记录的 i0 在结果里**始终从小到到大**出现；
 *   ③ **中途不是最终有序**：第 k 趟只保证"按第 k 位有序"（给中间结果反推算法的判据）；
 *   ④ **移动次数与初始序列无关**：每趟恰好把 n 个记录各搬一次（共 d·n 次），
 *      因为桶是队列、只做"出队入队"，不做比较。
 * ⚠ 快照里的 buckets / arr / passes 必须**深拷贝**（数组是引用类型，不拷贝则跳帧会串味）。
 * ⚠ 渲染里的 `rx-cell` / `rx-bucket` 是**给 harness 断言的钩子类名**（不参与样式，样式走内联），
 *   方便脚本数"桶有几个、排成一行没有、格子有没有压盖"。
 *
 * ★ 为什么把 r 做成可选的 2 / 10：十进制是考试口径；二进制用来现场体会"d 变大 ⟹ 趟数变多"，
 *   O(d(n+r)) 里的两个因子各管什么，一眼能看出来。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-radix',
  mode: 'stepper',
  title: '基数排序（按位分配 / 收集）',

  theory: `
> **为什么要有它**：前面几种排序都靠**两两比较**，比较下界是 \\(O(n\\log_2 n)\\)；**基数排序不比关键字**，而是按"位"把记录**分配**到 r 个队列、再**收集**回来——当位数 d 小、记录数 n 大时能做到 \\(O(d(n+r))\\) 的线性量级。
> **怎么实现（LSD，低位优先）**：从**最低位**（个位）起，每趟做两件事：① 按当前位把每个记录**尾追加**进第 digit 个队列；② 从 0 号队列到 r−1 号队列**依次**接回成新序列。重复 d 趟（d = 最大关键字的 r 进制位数），序列即升序。
> **记住什么**：① **稳定**；② 每趟只保证"按已处理的低位有序"，**中途不是最终有序**；③ 时间 \\(O(d(n+r))\\)、空间 \\(O(r)\\)（r 个队列的头尾指针）；④ **移动次数与初始排列无关**（每趟把 n 个记录各搬一次）。

## 一趟里到底发生了什么（考试就考这两步）
1. **分配**：顺序扫描当前序列，取第 k 位数字 \\(digit = \\lfloor key / r^{k-1} \\rfloor \\bmod r\\)，把记录**接到第 digit 个队列的队尾**；
2. **收集**：从 0 号队列开始，**依次**把每个队列从队头到队尾接成一个新序列；
3. 走完 1、2 算一趟 —— **这一趟结束后，序列按第 k 位有序**。

## 为什么必须"低位优先"（LSD）
- 先按低位排、再按高位排：**后一趟仍然稳定**，于是高位相同的记录保持"低位已有序"的次序 ⟹ d 趟后整体有序；
- 反过来先高位（MSD）要对每个桶递归处理，**408 不考这种写法**——**考试只认"从个位开始逐趟分配、收集"**。

## 稳定性怎么看出来（本模块的可视化重点）
- 序列里若有**相同关键字**，模块给每个记录标上它**最初的位次**（小上标）：分配永远**尾追加**、收集永远**按队列号从小到大** ⟹ 同值记录的上标始终按从小到大出现，这就是"稳定"。
- 反例记法：若把桶改成"栈"（头插入），收集出来就是逆序，**稳定性当场被破坏**。

## 考点提醒（易错点）
1. **一趟之后不是有序的**：只有"按这一位有序"。给中间结果反推算法时看**位处理**特征（不是相邻比较、也不是分段归并）；
2. **"先按 C1 排、再按总乘积排"就是 LSD 的思路**：先排**次要**关键字、再排**主要**关键字（2026-10 的设问）；
3. 基数排序**不做关键字比较**，所以 \\(O(n\\log_2 n)\\) 的比较下界对它不适用；但 d 很大时（二进制基数、关键字很长）会比比较排序更慢；
4. **移动次数与初始排列无关**：每趟都对全部 n 个记录做一次出队入队（这是它区别于插入 / 冒泡 / 快排的性质）；
5. **2021-10 的现成锚点**：本题序列第 1 趟（按个位）收集后是 151、301、372、892、93、43、485、946、146、236、327、9，所以 **372 的前后紧邻是 301 与 892** —— 把序列切到该预设、单步走到第 1 趟收集即可复核。

> **真题考情**：**3/18 年（全为选择题）**：2013-11（两趟后的序列反推算法）、2021-10（LSD 第 1 趟收集后 372 的前后紧邻元素）、2026-10（先按 C1 再按总乘积排序）。
`,

  /* ---------------- 输入表单（★ 每项都必须有 default，§3.8-11） ---------------- */
  inputs: [
    { key: 'seq', label: '待排序关键字（2~14 个非负整数）', type: 'textarea', rows: 2, wide: true,
      default: '93, 946, 372, 9, 146, 151, 301, 485, 236, 327, 43, 892',
      help: '默认就是 2021-10 的真题序列（LSD 第 1 趟问"372 的前后紧邻元素"）；同值重复输入可看稳定性' },
    { key: 'r', label: '基数 r（队列 / 桶的个数）', type: 'select', default: '10',
      options: [{ v: '10', t: '10（十进制：个位 / 十位 / 百位…）' }, { v: '2', t: '2（二进制：每次看一个二进制位）' }],
      help: 'r=10 是考试口径；r=2 用来体会"d 变大 ⟹ 趟数变多"（O(d(n+r)) 里两个因子各管什么）' },
  ],

  quickActions: [
    { label: '2021 真题序列（LSD 第 1 趟）', run(rt) {
        rt.setInput('seq', '93, 946, 372, 9, 146, 151, 301, 485, 236, 327, 43, 892');
        rt.setInput('r', '10');
        rt.load();
      } },
    { label: '2026 真题结构（先 C1 再总成绩）', run(rt) {
        /* 把"总成绩 + C1"编成两位数：十位 = 主要关键字（总成绩）、个位 = 次要关键字（C1）
           ⟹ LSD 天然"先按 C1（个位）、再按总成绩（十位）"，与 2026-10 的设问同构 */
        rt.setInput('seq', '72, 65, 71, 63, 74, 62, 66, 73');
        rt.setInput('r', '10');
        rt.load();
      } },
    { label: '🎲 随机序列（含同值）', run(rt) {
        const base = [];
        while (base.length < 6) { const v = RC408.util.rnd(0, 999); if (base.indexOf(v) < 0) base.push(v); }
        const arr = base.concat([base[RC408.util.rnd(0, 5)], base[RC408.util.rnd(0, 5)]]);
        for (let i = arr.length - 1; i > 0; i--) { const j = RC408.util.rnd(0, i); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
        rt.setInput('seq', arr.join(', '));
        rt.setInput('r', '10');
        rt.load();
      } },
    { label: '二进制基数（r=2）', run(rt) {
        rt.setInput('seq', '13, 5, 26, 7, 19, 2');
        rt.setInput('r', '2');
        rt.load();
      } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const keys = String(vals.seq || '').split(/[^0-9]+/).filter(Boolean).map(Number);
    if (keys.length < 2) throw { message: '至少输入 2 个关键字' };
    if (keys.length > 14) throw { message: '最多 14 个关键字（桶里要放得下，也要看得清）' };
    for (const k of keys) {
      if (!Number.isInteger(k) || k < 0) throw { message: '关键字必须是非负整数' };
    }
    const r = parseInt(vals.r, 10);
    if (r !== 2 && r !== 10) throw { message: '基数 r 只支持 2 或 10' };
    const max = Math.max.apply(null, keys);
    let d = 1, t = max;
    while (t >= r) { t = Math.floor(t / r); d++; }
    if (r === 10 && d > 4) throw { message: '最大关键字 ' + max + ' 要 ' + d + ' 趟（十进制最多演示 4 趟，请把关键字控制在 9999 以内）' };
    if (r === 2 && d > 8) throw { message: '最大关键字 ' + max + ' 要 ' + d + ' 趟（二进制最多演示 8 趟，请把关键字控制在 255 以内）' };
    const dup = {};
    keys.forEach(v => { dup[v] = (dup[v] || 0) + 1; });
    return { keys, r, d, dup, hasDup: Object.keys(dup).some(v => dup[v] > 1) };
  },

  /* ---------------- ② 纯算法：逐趟"分配 + 收集" ---------------- */
  buildSnapshots(model) {
    const { keys, r, d } = model;
    const n = keys.length;
    const emptyBuckets = () => { const b = []; for (let q = 0; q < r; q++) b.push([]); return b; };
    const cloneItems = list => list.map(it => ({ v: it.v, i0: it.i0 }));
    const cloneBuckets = bs => bs.map(b => cloneItems(b));
    const dig = (v, k) => Math.floor(v / Math.pow(r, k - 1)) % r;
    const ord = k => (k === 1 ? '个位' : k === 2 ? '十位' : k === 3 ? '百位' : '第 ' + k + ' 位');

    const snaps = [];
    const passes = [];
    let arr = keys.map((v, i) => ({ v, i0: i }));
    let buckets = emptyBuckets();

    const push = (step, extra) => {
      const e = extra || {};
      const o = Object.assign({
        step, r, d, k: 1, n,
        pos: -1, digit: null,
        buckets: cloneBuckets(buckets), passes: passes.map(p => ({ label: p.label, arr: p.arr.slice() })),
        stableOk: true, log: '', logType: 'info', desc: '',
      }, e);
      /* ★ 全量拷贝：同一趟的多个"分配帧"共用同一个 passStart，不拷贝就会**共享同一个数组引用**
         （窗26 冒烟抓到：改动第 2 帧的 arr 会连带改掉第 3 帧——跳帧回放会串味，违反 §1.3 铁律） */
      o.arr = cloneItems(e.arr || arr);
      snaps.push(o);
    };

    push('init', {
      buckets: cloneBuckets(emptyBuckets()),
      log: '就绪：' + n + ' 个关键字，基数 r = ' + r + '，最大关键字需要 ' + d + ' 趟（' + ord(1) + ' → ' + ord(d) + '）。每趟先"分配"到 ' + r + ' 个队列、再按队列号"收集"回来。',
      desc: '点击「单步执行」：第 1 趟按' + ord(1) + '分配、再收集',
    });

    for (let k = 1; k <= d; k++) {
      buckets = emptyBuckets();
      const passStart = cloneItems(arr);
      /* ① 分配：逐个记录尾追加进对应队列 */
      for (let i = 0; i < arr.length; i++) {
        const dg = dig(arr[i].v, k);
        buckets[dg].push({ v: arr[i].v, i0: arr[i].i0 });
        push('dist', {
          k, arr: passStart, pos: i, digit: dg, buckets: cloneBuckets(buckets),
          log: '第 ' + k + ' 趟·分配：' + arr[i].v + ' 的' + ord(k) + '是 ' + dg + ' → 接到 ' + dg + ' 号队列队尾（尾追加 ⟹ 保序）',
          desc: '第 ' + k + ' 趟分配：' + (i + 1) + ' / ' + n,
        });
      }
      /* ② 收集：0 号队列 → r−1 号队列，依次接回 */
      const next = [];
      for (let q = 0; q < r; q++) for (const it of buckets[q]) next.push({ v: it.v, i0: it.i0 });
      arr = next;
      passes.push({ label: '第 ' + k + ' 趟（按' + ord(k) + '）', arr: arr.map(it => it.v) });
      push('collect', {
        k, arr: cloneItems(arr), pos: n - 1, buckets: cloneBuckets(buckets),
        log: '第 ' + k + ' 趟·收集：从 0 号队列到 ' + (r - 1) + ' 号队列依次接回 ⟹ 现在序列按' + ord(k) + '有序：' + arr.map(it => it.v).join('、'),
        desc: '第 ' + k + ' 趟收集完成：按' + ord(k) + '有序',
      });
    }

    /* 稳定性自检：同值记录的 i0 必须递增出现 */
    let stableOk = true;
    const seen = {};
    for (const it of arr) {
      if (seen[it.v] !== undefined && it.i0 < seen[it.v]) stableOk = false;
      seen[it.v] = it.i0;
    }

    push('done', {
      k: d, pos: -1, arr: cloneItems(arr), buckets: cloneBuckets(emptyBuckets()),
      stableOk: stableOk,
      log: '完成：' + d + ' 趟之后得到升序序列 ' + arr.map(it => it.v).join('、') + '（每趟搬 n = ' + n + ' 个记录，共 ' + (d * n) + ' 次移动，与初始排列无关）',
      logType: 'success',
      desc: '排序完成：' + arr.map(it => it.v).join(', '),
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ----------------
   * ⚠ 布局用**内联 style**（display:flex / gap）而不是 Tailwind 工具类：离线 harness 不加载
   *   Tailwind CDN，工具类全部失效会让"桶"竖成一列，几何断言与截图就失去依据（窗25 同一个坑）。 */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { r, d, hasDup } = model;
    const n = s.n;

    /* 已发生的移动次数：走过的完整趟 + 本帧进度 */
    const moves = (s.k - 1) * n + (s.step === 'dist' ? s.pos + 1 : s.step === 'collect' ? n : 0);
    const nonEmpty = (s.buckets || []).filter(b => b.length).length;

    /* 序列行：每格显示关键字 + 本趟取到的位值；正在分配的那格高亮 */
    const seqItems = s.arr || [];
    const seqCells = seqItems.map((it, i) => {
      const dg = (s.step === 'init' || s.step === 'done') ? null : (Math.floor(it.v / Math.pow(r, s.k - 1)) % r);
      const cur = s.step === 'dist' && s.pos === i;
      const dup = hasDup && model.dup[it.v] > 1;
      return '<div class="rx-cell" style="display:flex;flex-direction:column;align-items:center;gap:2px">' +
        '<span class="chip ' + (cur ? 'chip-cur' : '') + '">' + it.v + (dup ? '<sub style="font-size:8px;color:#94a3b8">' + (it.i0 + 1) + '</sub>' : '') + '</span>' +
        '<span style="font:600 10px Consolas,monospace;color:' + (cur ? '#6366f1' : '#94a3b8') + '">' + (dg === null ? '·' : dg) + '</span>' +
        '</div>';
    }).join('');

    /* 桶：r 个队列，纵向排列；本帧刚入队的那个桶高亮 */
    const bucketCols = (s.buckets || []).map((b, q) => {
      const hot = s.step === 'dist' && s.digit === q;
      const chips = b.map((it, j) => '<span class="chip ' + (hot && j === b.length - 1 ? 'chip-cur' : '') + '" style="font-size:11px">' + it.v + '</span>').join('');
      return '<div class="rx-bucket" data-q="' + q + '" style="min-width:62px;flex:0 0 auto;border:1px solid ' + (hot ? '#6366f1' : '#e2e8f0') + ';border-radius:12px;padding:5px 6px;background:' + (hot ? '#eef2ff' : '#fff') + '">' +
        '<div style="font:700 10px sans-serif;color:' + (hot ? '#4338ca' : '#94a3b8') + ';text-align:center;margin-bottom:3px">' + q + ' 号</div>' +
        '<div style="display:flex;flex-direction:column;gap:3px;align-items:center;min-height:14px">' + (chips || '<span style="font:600 10px sans-serif;color:#cbd5e1">空</span>') + '</div>' +
        '</div>';
    }).join('');

    /* 每趟结果表（真题套路：给中间结果反推算法） */
    const passRows = (s.passes || []).map((p, i) => '<tr class="' + (i === s.passes.length - 1 && s.step === 'collect' ? 'row-cur' : '') + '">' +
      '<td class="font-bold whitespace-nowrap">' + p.label + '</td>' +
      '<td class="font-mono">' + p.arr.join('、') + '</td></tr>').join('');
    const passTable = (s.passes || []).length ? '<div>' +
      RC408.ui.sectionTitle('每趟结果表（给中间结果反推算法：看"按位有序"的特征）') +
      '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="tbl w-full"><thead><tr><th>趟次</th><th>序列状态</th></tr></thead><tbody>' + passRows + '</tbody></table></div></div>' : '';

    const stats =
      RC408.ui.statCard('当前趟', s.step === 'init' ? '—' : '第 ' + s.k + ' / ' + d + ' 趟', s.step === 'init' ? '待开始' : '按 ' + (s.k === 1 ? '个位' : s.k === 2 ? '十位' : s.k === 3 ? '百位' : '第 ' + s.k + ' 位'), 'text-indigo-600') +
      RC408.ui.statCard('基数 r', r, '非空队列 ' + nonEmpty + ' / ' + r, 'font-mono') +
      RC408.ui.statCard('已移动记录', moves, '共将移动 d·n = ' + (d * n) + ' 次', 'text-amber-600') +
      RC408.ui.statCard('稳定性', hasDup ? (s.stableOk === false ? '被破坏' : '保持') : '本序列无同值', hasDup ? '同值记录的最初位次仍按序' : '换一组含同值的关键字可验证', s.stableOk === false ? 'text-rose-600' : 'text-emerald-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('当前序列（格下小字 = 本趟用到的位值' + (hasDup ? '；右上小标 = 最初位次，用来看稳定性' : '') + '）')}
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">${seqCells}</div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('队列（桶）：分配是"接到队尾"，收集是"从 0 号到 ' + (r - 1) + ' 号依次接回"')}
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start;justify-content:center">${bucketCols}</div>
        </div>

        ${passTable}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#6366f1', '本帧正在分配的记录 / 刚入队的桶')}
          ${RC408.ui.legend('#94a3b8', '位值小字（本趟按这一位分桶）')}
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>每趟只是"按这一位有序"，<b>中途序列不是最终有序</b>；
          同值记录的上标始终从小到大 ⟹ <b>稳定</b>；每趟把 n 个记录各搬一次 ⟹ <b>移动次数与初始排列无关</b>。
          给中间结果反推算法时，认"按位分配、收集"的特征（不是相邻比较、也不是分段归并）。
        </div>
      </div>`;
  },
});
