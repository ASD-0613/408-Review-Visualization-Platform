'use strict';
/* ============================================================================
 * ds-binsearch.js —— 【数据结构】折半查找（二分查找）与判定树
 * ----------------------------------------------------------------------------
 * 真题考情：18 年中 5 年考（2010-9 最大比较次数、2016-9 跳跃式查找的比较次数、
 * 2017-8 判定树形态、2023-8 600 元素最大比较次数、2024-5 有序前提与适用存储结构），
 * （窗14 勘误：原写"8 年"，实为 **5 年 / 5 题**，已按 RC408.examHistory 现算改正）
 * 判定树是核心——它的形态只与元素个数 n 有关，与元素值无关。
 *
 * 快照设计：每次"取 mid 比较"一帧（另加 init / 结果帧）：
 *   { lo / hi / mid     当前查找区间与探测点
 *     probeVal          a[mid] 的值
 *     cmp:'eq'|'lt'|'gt' 比较结果（a[mid] vs 目标）
 *     probes            已探测序列 [{mid, cmp}]
 *     found             成功时命中下标，失败 -1
 *     failAt            失败时到达的空位（外部结点插入点） }
 * 判定树按 mid = ⌊(lo+hi)/2⌋ 递归构造：形态由 n 唯一确定。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-binsearch',
  mode: 'stepper',
  title: '折半查找（二分查找）与判定树',

  theory: `
> **为什么要有它**：顺序查找要挨个比较，太慢——**表有序**时每次比中间元素就能**一次砍掉一半**，比较次数降到 \\(O(\\log_2 n)\\)。
> **怎么实现**：low、high 夹住当前区间，取 \\(mid=\\lfloor (low+high)/2 \\rfloor\\) 与目标比较：相等即命中，目标更大取右半、更小取左半。
> **记住什么**：**判定树**（形态只由 n 决定）+ 树高 = 最大比较次数 = \\(\\lceil \\log_2(n+1) \\rceil\\) + 只适用于**有序顺序表**。

## 算法过程（判定树的形态由 mid 的取法唯一确定）
1. 初始 \\(low=0,\\ high=n-1\\)；
2. 取 \\(mid=\\lfloor (low+high)/2 \\rfloor\\)（教材取下整，本模块同此口径）：\\(a[mid]=target\\) → 查找成功；
3. 目标更大 → \\(low=mid+1\\)（右半区）；目标更小 → \\(high=mid-1\\)（左半区）；
4. 直到 \\(low>high\\) → 查找失败，落到判定树的**外部结点**。

## 判定树（本模块的可视化主体）
- n 个元素 → **n 个内部结点（圆）+ n+1 个外部结点（方，失败到达的位置）**；
- 树高（最大比较次数）= \\(\\lceil \\log_2(n+1) \\rceil\\)：n=16 时为 **5**、n=600 时为 **10**；
- 成功时最少比较 1 次；失败的比较次数 = 走到外部结点经过的层数；
- **形态唯一**——mid 只由下标决定，与元素值无关（同样的 n，判定树永远一样）。

## 考点提醒（易错点）
1. **前提是"有序 + 顺序存储"**：链表不能 \\(O(1)\\) 取中点，做不了折半；
2. 判定树只与 n 有关，与元素值无关："某值查不到"也走同一棵树，按路径数比较次数；
3. 顺序查找成功最多 n 次，折半是 \\(O(\\log_2 n)\\)，但插入/删除要搬元素；
4. **跳跃式（跨步递增）查找在某些情形更省**——目标越靠前比较次数越少，别一看到"有序"就认定折半最优。

> **真题考情**：**5/18 年（全为选择题）**：2010-9（最大比较次数）、2016-9（跳跃式查找的比较次数）、
> 2017-8（判定树形态）、2023-8（比较次数）、2024-5（有序前提与适用存储结构）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'arr', label: '有序序列（严格递增，4~15 个）', type: 'textarea', rows: 2, wide: true,
      default: '7, 14, 18, 21, 23, 29, 31, 35, 38, 42, 46, 49, 52',
      help: '折半查找要求序列严格递增（判定树只与元素个数 n 有关）' },
    { key: 'target', label: '查找目标', default: '32', help: '可为序列中存在的值（成功），也可为不存在的值（失败路径）' },
  ],

  quickActions: [
    { label: '🎲 随机序列', run(rt) {
        const n = RC408.util.rnd(8, 15);
        const arr = []; let v = RC408.util.rnd(1, 9);
        while (arr.length < n) { arr.push(v); v += RC408.util.rnd(1, 9); }
        rt.setInput('arr', arr.join(', '));
        rt.setInput('target', Math.random() < 0.5 ? arr[RC408.util.rnd(0, n - 1)] : arr[RC408.util.rnd(0, n - 1)] + 1);
        rt.load();
      } },
    { label: '查找失败示例', run(rt) { rt.setInput('target', '32'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const arr = vals.arr.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (arr.length < 4) throw { message: '至少输入 4 个元素' };
    if (arr.length > 15) throw { message: '最多 15 个元素（判定树便于展示）' };
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] <= arr[i - 1]) throw { message: `a[${i}] = ${arr[i]} ≤ a[${i - 1}] = ${arr[i - 1]}：折半查找要求序列**严格递增**` };
    }
    const target = parseInt(vals.target, 10);
    if (!Number.isInteger(target) || target < 0) throw { message: '查找目标须为非负整数' };
    return { arr, target };
  },

  /* ---------------- ② 纯算法：探测过程 + 判定树 ---------------- */
  buildSnapshots(model) {
    const { arr, target } = model;
    const n = arr.length;

    /* 判定树（形态只与 n 有关）：mid = ⌊(lo+hi)/2⌋ 递归构造 */
    function buildTree(lo, hi, depth) {
      if (lo > hi) return null;
      const mid = (lo + hi) >> 1;
      return { idx: mid, depth, left: buildTree(lo, mid - 1, depth + 1), right: buildTree(mid + 1, hi, depth + 1) };
    }
    const tree = buildTree(0, n - 1, 0);

    let lo = 0, hi = n - 1;
    const probes = [];
    let found = -1, failAt = null;
    const snaps = [];

    const push = (step, extra) => snaps.push({
      step, lo, hi, mid: null, probeVal: null, cmp: null,
      probes: probes.map(p => ({ ...p })), found, failAt, tree,
      log: '', logType: 'info', desc: '', ...extra,
    });

    push('init', {
      log: `就绪：${n} 个元素的有序表，查找目标 ${target}。判定树高度（最大比较次数）= ⌈log₂(${n}+1)⌉ = ${Math.ceil(Math.log2(n + 1))}。`,
      logType: 'info',
      desc: '点击「单步执行」：mid = ⌊(low+high)/2⌋，每次比较排除一半区间',
    });

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cmp = arr[mid] === target ? 'eq' : arr[mid] < target ? 'lt' : 'gt';
      probes.push({ mid, cmp });
      if (cmp === 'eq') {
        found = mid;
        push('probe', { lo, hi, mid, probeVal: arr[mid], cmp, found,
          log: `取 mid = ⌊(${lo}+${hi})/2⌋ = ${mid}，a[${mid}] = ${arr[mid]} = 目标 ${target} → **查找成功**！共比较 ${probes.length} 次`,
          logType: 'success', desc: `找到 ${target} 于位置 ${mid}（第 ${probes.length} 次比较）` });
        break;
      }
      push('probe', { lo, hi, mid, probeVal: arr[mid], cmp,
        log: `取 mid = ⌊(${lo}+${hi})/2⌋ = ${mid}，a[${mid}] = ${arr[mid]} ${cmp === 'lt' ? '<' : '>'} 目标 ${target} → 目标在${cmp === 'lt' ? `右半区 [${mid + 1}, ${hi}]` : `左半区 [${lo}, ${mid - 1}]`}`,
        logType: 'info',
        desc: `a[${mid}] = ${arr[mid]} ${cmp === 'lt' ? '<' : '>'} ${target} → 查${cmp === 'lt' ? '右' : '左'}半区` });
      if (cmp === 'lt') lo = mid + 1; else hi = mid - 1;
    }

    if (found < 0) {
      failAt = lo;   // 到达外部结点：若插入应放的位置
      push('fail', {
        log: `low(${lo}) > high(${hi}) → 查找失败：沿判定树到达**外部结点**（${target} 若插入应位于位置 ${lo}），共比较 ${probes.length} 次（不超过判定树高度）。`,
        logType: 'error',
        desc: `查找失败：${target} 不在表中（比较 ${probes.length} 次后区间为空）`,
      });
    }

    snaps.push({
      step: 'done', lo, hi, mid: null, probeVal: null, cmp: null,
      probes: probes.map(p => ({ ...p })), found, failAt, tree,
      log: found >= 0
        ? `查找成功：${target} 位于位置 ${found}，共比较 ${probes.length} 次（判定树高度 ⌈log₂(${n}+1)⌉ = ${Math.ceil(Math.log2(n + 1))}）。`
        : `查找失败：共比较 ${probes.length} 次。判定树共 ${n} 个内部结点、${n + 1} 个外部结点，高度 = ${Math.ceil(Math.log2(n + 1))}。`,
      logType: 'success',
      desc: found >= 0 ? `成功：位置 ${found}` : `失败：${n} 内部结点 / ${n + 1} 外部结点`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const n = model.arr.length;
    const probes = s.probes || [];
    const pathSet = new Set(probes.map(p => p.mid));
    const isCur = i => (s.step === 'probe' || s.step === 'fail') && s.mid === i;
    const lastCmp = probes.length ? probes[probes.length - 1] : null;

    /* 数组行：区间底色 + low/mid/high 指针 */
    const cells = model.arr.map((v, i) => {
      const inRange = s.step !== 'init' && s.step !== 'done' ? i >= s.lo && i <= s.hi : true;
      const dim = !(s.step === 'init' || s.step === 'done') && !inRange;
      const isProbed = pathSet.has(i);
      const probing = isCur(i);
      return `<div class="flex flex-col items-center gap-1" style="opacity:${dim ? 0.35 : 1}">
        ${probing ? '<span class="text-[10px] font-extrabold text-amber-600">mid ▾</span>' : (s.step !== 'init' && s.step !== 'done' && i === s.lo && s.lo <= s.hi ? '<span class="text-[10px] font-bold text-indigo-500">low ▾</span>' : s.step !== 'init' && s.step !== 'done' && i === s.hi ? '<span class="text-[10px] font-bold text-indigo-500">high ▴</span>' : '<span class="h-[15px]"></span>')}
        <div class="frame-cell" style="width:44px;height:44px;border-radius:9px; ${probing ? 'border-color:#f59e0b;background:#fffbeb;' : isProbed ? 'border-color:#a5b4fc;background:#eef2ff;' : ''}">
          <span class="page-num" style="font-size:15px">${v}</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400">a[${i}]</span>
      </div>`;
    }).join('');

    /* 判定树：x 用中序位置（恰好 = 元素下标序），y 用深度 */
    let ix = 0;
    (function walk(node) {
      if (!node) return;
      walk(node.left);
      node._x = ix++;
      walk(node.right);
    })(s.tree);
    let maxDepth = 0;
    (function walk2(node) { if (!node) return; maxDepth = Math.max(maxDepth, node.depth); walk2(node.left); walk2(node.right); })(s.tree);
    const W = Math.max(n * 74 + 60, 460), H = (maxDepth + 1) * 74 + 46;
    const gap = n > 1 ? (W - 80) / (n - 1) : 0;
    const P = {};
    (function pos(node) {
      if (!node) return;
      P[node.idx] = { x: n > 1 ? 40 + node._x * gap : W / 2, y: 40 + node.depth * 74 };
      pos(node.left); pos(node.right);
    })(s.tree);

    /* 树的边与结点：探测路径加粗 */
    let edges = '', nodes = '';
    (function draw(node, parent) {
      if (!node) return;
      const p = P[node.idx];
      if (parent) {
        const pp = P[parent.idx];
        const hot = pathSet.has(node.idx) && (s.step === 'probe' || s.step === 'fail' || s.step === 'done');
        edges += `<line x1="${pp.x}" y1="${pp.y}" x2="${p.x}" y2="${p.y}" stroke="${hot ? '#f59e0b' : '#cbd5e1'}" stroke-width="${hot ? 3.5 : 2}"/>`;
      }
      draw(node.left, node); draw(node.right, node);
      const visited = pathSet.has(node.idx);
      const probing = isCur(node.idx);
      const isFound = s.found === node.idx;
      const fill = isFound ? '#10b981' : probing ? '#f59e0b' : visited ? '#818cf8' : '#e2e8f0';
      const txt = isFound || probing || visited ? '#fff' : '#475569';
      nodes += `${probing ? `<circle cx="${p.x}" cy="${p.y}" r="25" class="knode-halo" style="stroke:#f59e0b"/>` : ''}
        <circle cx="${p.x}" cy="${p.y}" r="19" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${txt};font-size:12px">${model.arr[node.idx]}</text>`;
    })(s.tree, null);

    /* 失败时的外部结点：挂在最后一次探测的下方（左/右取决于最后一次比较方向） */
    let failNode = '';
    if (s.step === 'fail' && probes.length) {
      const lastP = probes[probes.length - 1];
      const pp = P[lastP.mid];
      if (pp) {
        const side = lastP.cmp === 'lt' ? 1 : -1;
        const fx = pp.x + side * 36, fy = pp.y + 56;
        failNode = `<line x1="${pp.x}" y1="${pp.y}" x2="${fx}" y2="${fy}" stroke="#94a3b8" stroke-dasharray="4 3"/>
          <rect x="${fx - 18}" y="${fy - 12}" width="36" height="24" rx="5" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 3"/>
          <text x="${fx}" y="${fy + 4}" text-anchor="middle" style="font:700 9px sans-serif" fill="#64748b">外部结点</text>`;
      }
    }

    const treeSvg = `
      <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${Math.max(W, 520)}px">
        ${edges}${nodes}${failNode}
      </svg>`;

    const stats =
      RC408.ui.statCard('查找目标', model.target, `${s.step === 'init' ? '待开始' : s.found >= 0 ? '已找到' : s.step === 'fail' ? '不在表中' : '查找中'}`, 'text-indigo-600') +
      RC408.ui.statCard('当前区间', s.step === 'init' ? `[0, ${n - 1}]` : `[${s.lo}, ${s.hi}]`, s.step === 'probe' ? `本帧比较 a[${s.mid}] = ${s.probeVal}` : '', 'font-mono') +
      RC408.ui.statCard('已比较次数', probes.length, `最多 ${Math.ceil(Math.log2(n + 1))} 次`, 'text-amber-600') +
      RC408.ui.statCard('结论', s.step === 'init' ? '—' : s.found >= 0 ? `位置 ${s.found}` : '查找失败', s.found >= 0 ? '查找成功' : s.step === 'fail' || s.step === 'done' ? '到达外部结点' : '', s.found >= 0 ? 'text-emerald-600' : 'text-slate-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 overflow-x-auto">
          ${RC408.ui.sectionTitle(`有序表（mid = ⌊(low+high)/2⌋；淡紫 = 已探测过，琥珀 = 当前 mid，区间外淡出）`)}
          <div class="flex gap-2 justify-center">${cells}</div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          ${RC408.ui.sectionTitle('判定树（形态只与 n 有关；紫色 = 探测路径，琥珀 = 当前比较，绿 = 命中）')}
          ${treeSvg}
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '当前 mid 探测')}
          ${RC408.ui.legend('#818cf8', '探测路径上的结点')}
          ${RC408.ui.legend('#10b981', '查找成功命中')}
          ${RC408.ui.legend('#94a3b8', '外部结点（查找失败到达）')}
        </div>
      </div>`;
  },
});
