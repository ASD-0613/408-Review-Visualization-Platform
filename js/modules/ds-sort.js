'use strict';
/* ============================================================================
 * ds-sort.js —— 【数据结构】排序算法全家桶（插入/冒泡/选择/快排/堆排/归并）
 * ----------------------------------------------------------------------------
 * 真题考情：17 年真题**每年必考 1~2 题**（累计 25+ 题），固定套路：
 *   ① "给第 k 趟排序结果反推算法"（09/10/12/14/15/18/23/24/25…）；
 *   ② 算法性质辨析（比较次数/移动次数/稳定性/是否每趟确定一个最终位置）。
 * 本模块的"每趟结果表"即针对 ① 训练。
 *
 * 快照设计：每个"比较 / 移动(交换) / 归位"动作一帧，趟结束追加 pass 帧：
 *   { type:'compare'|'move'|'pass'|'init'|'done',
 *     arr       当前数组状态副本
 *     hi        本帧高亮的下标（比较对等）
 *     touched   本帧被写动的下标
 *     sorted    已确定最终位置的下标（绿色）
 *     pivot     快排当前枢轴下标
 *     range     快排/归并当前工作区间 [lo,hi]
 *     stats     {compares, moves}
 *     passes    每趟结束时的数组快照（渲染"每趟结果表"） }
 * ========================================================================== */

/* 各算法的复杂度与稳定性（渲染统计卡用） */
const _SORT_META = {
  insertion: { name: '直接插入排序', cmp: 'O(n²)', stable: '稳定', best: '基本有序时 O(n)——真题高频辨析' },
  bubble: { name: '冒泡排序', cmp: 'O(n²)', stable: '稳定', best: '可提前终止（本趟无交换即有序）' },
  selection: { name: '简单选择排序', cmp: 'O(n²)', stable: '不稳定', best: '移动次数最少（最多 n−1 次）——2025 真题' },
  quick: { name: '快速排序', cmp: '平均 O(nlog₂n)', stable: '不稳定', best: '每趟确定一个元素的最终位置' },
  heap: { name: '堆排序', cmp: 'O(nlog₂n)', stable: '不稳定', best: '大根堆顺序存储，堆顶即最大值' },
  merge: { name: '二路归并排序', cmp: 'O(nlog₂n)', stable: '稳定', best: '第 k 趟后归并段长为 2ᵏ' },
};

RC408.registerModule({
  id: 'ds-sort',
  mode: 'stepper',
  title: '排序算法全家桶（逐动作 + 每趟结果）',

  theory: `
> **真题考情**：17 年真题**每年必考**（累计 25+ 题）。最高频套路是
> **"给出第 1、2 趟后的序列，反推是哪种排序"**（09/10/12/14/18/23/25 年均考），
> 其次是性质辨析：稳定性、比较/移动次数、能否每趟确定一个最终位置。
> 另注：2021 年大题曾考"计数排序"的代码分析——计数排序**不在考纲排序列表内**，属阅读代码类题目，掌握思想即可。

## 六种排序的"一趟"特征（反推算法的钥匙）
| 算法 | 一趟之后能保证什么 | 稳定性 |
| --- | --- | --- |
| 直接插入 | 前 i+1 个元素**局部有序**（但位置未必最终） | 稳定 |
| 冒泡 | 每趟冒出一个**最大值到最终位置**（末尾有序区+1） | 稳定 |
| 简单选择 | 每趟选出最小值放到**最终位置**（头部有序区+1） | 不稳定 |
| 快速排序 | 每趟**枢轴归位**（左侧均≤枢轴、右侧均≥枢轴） | 不稳定 |
| 堆排序 | 每趟取出堆顶放末尾（尾部有序区+1） | 不稳定 |
| 二路归并 | 第 k 趟后所有**长度 2ᵏ 的段内有序** | 稳定 |

## 高频辨析结论
- **移动次数与初始序列无关**：简单选择、基数排序（2015 真题）；
- **比较次数与初始序列无关**：简单选择、归并、折半插入的"比较"也只与 n 有关；
- **基本有序选插入、n 大且随机选快排、要求 O(1) 空间选堆排**（2022 真题）；
- 快排适合**顺序存储**（2011 真题）；希尔的组内排序是**直接插入**（2015 真题）；
- **不稳定的四种**：希尔、简单选择、快速、堆排——口诀"**希选快堆**"。

## 本模块的观察要点
- 单步看每个"比较→移动"决策；重点看**每趟结果表**，考场上靠它反推算法；
- 快排观察枢轴的归位过程：绿色下标 = 已确定最终位置的元素。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'algo', label: '排序算法', type: 'select', default: 'quick', wide: true,
      options: Object.entries(_SORT_META).map(([v, m]) => ({ v, t: `${m.name}（${m.cmp} · ${m.stable}）` })),
    },
    { key: 'seq', label: '待排序序列（8~12 个，1~99）', default: '49,38,65,97,76,13,27,49', wide: true, help: '默认序列为王道教材经典例题：注意有两个 49，可检验稳定性' },
  ],

  quickActions: [
    { label: '🎲 随机序列', run(rt) { rt.setInput('seq', Array.from({ length: RC408.util.rnd(8, 10) }, () => RC408.util.rnd(10, 99)).join(',')); rt.load(); } },
    { label: '基本有序(选插入最优)', run(rt) { rt.setInput('seq', '13,27,49,38,65,76,88,97'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const arr = vals.seq.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (arr.length < 4) throw { message: '至少输入 4 个元素' };
    if (arr.length > 12) throw { message: '最多 12 个元素（便于展示每一步）' };
    if (arr.some(v => v < 1 || v > 99)) throw { message: '元素取值请控制在 1 ~ 99' };
    const algo = _SORT_META[vals.algo] ? vals.algo : 'quick';
    return { arr, algo };
  },

  /* ---------------- ② 纯算法：六种排序产出快照 ---------------- */
  buildSnapshots(model) {
    const { algo } = model;
    const n0 = model.arr.length;
    const a = [...model.arr];
    const st = { compares: 0, moves: 0 };
    const passes = [];
    const sorted = [];
    const snaps = [];
    let passNo = 0;

    const snap = (type, extra = {}) => snaps.push({
      type, arr: [...a],
      hi: [], touched: [], sorted: [...sorted], range: null,
      hole: null, pivotVal: null,          // 快排"挖坑法"：空位下标 + 已取出的枢轴值
      stats: { ...st }, passes: passes.map(p => ({ label: p.label, arr: [...p.arr] })),
      passName: passes.length ? passes[passes.length - 1].label : '尚未完成任何一趟',
      log: '', desc: '', ...extra,
    });
    const passEnd = (label, log) => {
      passNo++;
      passes.push({ label, arr: [...a] });
      snap('pass', { log, desc: `${label}：${a.join(', ')}`, passLabel: label });
    };

    snap('init', { log: `就绪：${_SORT_META[algo].name} 排序 [${a.join(', ')}]，共 ${n0} 个元素。`, logType: 'info', desc: '点击「单步执行」；每帧 = 一次比较或一次移动' });

    const swap = (i, j, log) => { const t = a[i]; a[i] = a[j]; a[j] = t; st.moves++; snap('move', { touched: [i, j], log, desc: log }); };

    if (algo === 'insertion') {
      for (let i = 1; i < n0; i++) {
        const key = a[i];
        snap('compare', { hi: [i], log: `取出待插入关键字 a[${i}] = ${key}，向前寻找插入位置`, desc: `第 ${i} 趟：插入 ${key}` });
        let j = i - 1;
        while (j >= 0) {
          st.compares++;
          snap('compare', { hi: [j], log: `比较 a[${j}] = ${a[j]} 与待插入值 ${key}：${a[j] > key ? '大于 → 继续后移' : '不大于 → 找到位置'}`, desc: `比较 ${a[j]} 与 ${key}` });
          if (a[j] <= key) break;
          a[j + 1] = a[j]; st.moves++;
          snap('move', { touched: [j + 1], log: `a[${j}] = ${a[j]} 后移一位`, desc: `${a[j]} 后移` });
          j--;
        }
        a[j + 1] = key; st.moves++;
        snap('move', { touched: [j + 1], log: `${key} 插入到位置 ${j + 1}`, desc: `${key} 插入位置 ${j + 1}` });
        passEnd(`第 ${i} 趟（插入 ${key}）`, `第 ${i} 趟完成：前 ${i + 1} 个元素局部有序`);
      }
    }

    if (algo === 'bubble') {
      for (let i = 0; i < n0 - 1; i++) {
        let swapped = false;
        for (let j = 0; j < n0 - 1 - i; j++) {
          st.compares++;
          snap('compare', { hi: [j, j + 1], log: `比较相邻元素 a[${j}]=${a[j]} 与 a[${j + 1}]=${a[j + 1]}：${a[j] > a[j + 1] ? '逆序 → 交换' : '正序 → 不动'}`, desc: `比较 ${a[j]} 与 ${a[j + 1]}` });
          if (a[j] > a[j + 1]) { swap(j, j + 1, `交换 ${a[j + 1]} 与 ${a[j]}`); swapped = true; }
        }
        for (let k = n0 - 1 - i; k < n0; k++) if (!sorted.includes(k)) sorted.push(k);
        passEnd(`第 ${i + 1} 趟`, `第 ${i + 1} 趟完成：最大值 ${a[n0 - 1 - i]} 冒泡到最终位置（末尾 ${i + 1} 个已就位）`);
        if (!swapped) {
          for (let k = 0; k < n0; k++) if (!sorted.includes(k)) sorted.push(k);
          snap('pass', { log: `本趟未发生任何交换 → 序列已整体有序，提前终止（冒泡的优势）`, desc: '提前终止' });
          break;
        }
      }
    }

    if (algo === 'selection') {
      for (let i = 0; i < n0 - 1; i++) {
        let min = i;
        snap('compare', { hi: [i], log: `第 ${i + 1} 趟：从 a[${i}..${n0 - 1}] 中选最小值，暂定 a[${i}]=${a[i]}`, desc: `第 ${i + 1} 趟选择最小值` });
        for (let j = i + 1; j < n0; j++) {
          st.compares++;
          snap('compare', { hi: [min, j], log: `比较 a[${j}]=${a[j]} 与当前最小 a[${min}]=${a[min]}：${a[j] < a[min] ? '更小 → 更新 min' : '不更小'}`, desc: `比较 ${a[j]} 与 ${a[min]}` });
          if (a[j] < a[min]) min = j;
        }
        if (min !== i) swap(i, min, `最小值 ${a[min]} 与 a[${i}] 交换（一次交换确定一个最终位置）`);
        else snap('move', { hi: [i], log: `a[${i}] 本就是最小值，无需交换`, desc: '无需交换' });
        for (let k = 0; k <= i; k++) if (!sorted.includes(k)) sorted.push(k);
        passEnd(`第 ${i + 1} 趟`, `第 ${i + 1} 趟完成：${a[i]} 归位（头部 ${i + 1} 个已就位）`);
      }
    }

    if (algo === 'quick') {
      let passCount = 0;
      /* 挖坑法：枢轴取出后原位置成为"空位"，每填入一个元素，空位就移到被取走元素的位置。
         快照用 hole（空位下标）+ pivotVal（暂存的枢轴值）记录，渲染时空位画虚线框，
         避免出现"两个相同元素"的迷惑画面 */
      const qs = (lo, hi) => {
        if (lo >= hi) return;
        const pivot = a[lo];
        let i = lo, j = hi;
        snap('compare', { hole: lo, pivotVal: pivot, range: [lo, hi], hi: [lo], log: `挖坑：取出 a[${lo}] = ${pivot} 作为枢轴暂存 → 位置 ${lo} 成为空位（虚线框），low 从左找大、high 从右找小`, desc: `划分 [${lo}, ${hi}]，枢轴 = ${pivot}（已取出，挖坑）` });
        while (i < j) {
          while (i < j) {
            st.compares++;
            snap('compare', { hole: i, pivotVal: pivot, range: [lo, hi], hi: [j], log: `high 指针：比较 a[${j}]=${a[j]} 与枢轴 ${pivot}：${a[j] >= pivot ? '≥ 枢轴 → j 左移' : '< 枢轴 → 填入左侧空位'}`, desc: `high 扫描：${a[j]} vs ${pivot}` });
            if (a[j] < pivot) break;
            j--;
          }
          if (i < j) { a[i] = a[j]; st.moves++; snap('move', { hole: j, pivotVal: pivot, range: [lo, hi], touched: [i], log: `a[${j}] = ${a[j]} 填入左侧空位 a[${i}] → 空位移到位置 ${j}`, desc: `${a[j]} 填坑，空位换到 ${j}` }); }
          while (i < j) {
            st.compares++;
            snap('compare', { hole: j, pivotVal: pivot, range: [lo, hi], hi: [i], log: `low 指针：比较 a[${i}]=${a[i]} 与枢轴 ${pivot}：${a[i] <= pivot ? '≤ 枢轴 → i 右移' : '> 枢轴 → 填入右侧空位'}`, desc: `low 扫描：${a[i]} vs ${pivot}` });
            if (a[i] > pivot) break;
            i++;
          }
          if (i < j) { a[j] = a[i]; st.moves++; snap('move', { hole: i, pivotVal: pivot, range: [lo, hi], touched: [j], log: `a[${i}] = ${a[i]} 填入右侧空位 a[${j}] → 空位移到位置 ${i}`, desc: `${a[i]} 填坑，空位换到 ${i}` }); }
        }
        a[i] = pivot; st.moves++;
        if (!sorted.includes(i)) sorted.push(i);
        snap('move', { hole: null, pivotVal: null, touched: [i], log: `枢轴 ${pivot} 填入最后一个空位 a[${i}]，归位：左侧均 ≤ ${pivot}，右侧均 ≥ ${pivot}`, desc: `枢轴 ${pivot} 归位` });
        passEnd(`第 ${++passCount} 趟（枢轴 ${pivot} 归位）`, `一趟划分完成：枢轴 ${pivot} 位于最终位置`);
        qs(lo, i - 1);
        qs(i + 1, hi);
      };
      qs(0, n0 - 1);
    }

    if (algo === 'heap') {
      const sift = (root, len) => {
        while (true) {
          let child = 2 * root + 1;
          if (child >= len) break;
          if (child + 1 < len) {
            st.compares++;
            snap('compare', { hi: [child, child + 1], log: `比较左右孩子 a[${child}]=${a[child]} 与 a[${child + 1}]=${a[child + 1]}，取较大者`, desc: '左右孩子比较' });
            if (a[child + 1] > a[child]) child++;
          }
          st.compares++;
          snap('compare', { hi: [root, child], log: `比较父结点 a[${root}]=${a[root]} 与较大孩子 a[${child}]=${a[child]}：${a[child] > a[root] ? '孩子更大 → 交换下沉' : '堆性质满足 → 结束筛选'}`, desc: `父子比较：${a[root]} vs ${a[child]}` });
          if (a[root] >= a[child]) break;
          swap(root, child, `交换 a[${root}] 与 a[${child}]，继续向下筛选`);
          root = child;
        }
      };
      for (let i = Math.floor(n0 / 2) - 1; i >= 0; i--) sift(i, n0);
      snap('pass', { log: `初始大根堆建立完成（自最后一个非叶结点向前逐一筛选）：堆顶 a[0]=${a[0]} 为最大值`, desc: '建堆完成', range: null });
      passEnd(`建堆完成`, `初始堆：${a.join(', ')}`);
      for (let end = n0 - 1; end > 0; end--) {
        swap(0, end, `堆顶 ${a[end]} 与末尾 a[${end}] 交换 → ${a[end]} 归位`);
        if (!sorted.includes(end)) sorted.push(end);
        sift(0, end);
        passEnd(`第 ${n0 - end} 趟（取堆顶）`, `第 ${n0 - end} 趟完成：当前最大值归位，剩余 ${end} 个元素重新成堆`);
      }
      if (!sorted.includes(0)) sorted.push(0);
    }

    if (algo === 'merge') {
      let width = 1, passCount = 0;
      while (width < n0) {
        for (let lo = 0; lo < n0; lo += 2 * width) {
          const mid = Math.min(lo + width, n0), hi = Math.min(lo + 2 * width, n0);
          if (mid >= hi) continue;
          const aux = [];
          let p = lo, q = mid;
          while (p < mid && q < hi) {
            st.compares++;
            snap('compare', { hi: [p, q], range: [lo, hi - 1], log: `归并 [${lo},${mid - 1}] 与 [${mid},${hi - 1}]：比较两段队首 a[${p}]=${a[p]} 与 a[${q}]=${a[q]}，取小者进入辅助数组`, desc: `归并比较 ${a[p]} 与 ${a[q]}` });
            aux.push(a[p] <= a[q] ? a[p++] : a[q++]);
          }
          while (p < mid) aux.push(a[p++]);
          while (q < hi) aux.push(a[q++]);
          for (let k = 0; k < hi - lo; k++) a[lo + k] = aux[k];
          st.moves += hi - lo;
          snap('move', { touched: Array.from({ length: hi - lo }, (_, k) => lo + k), range: [lo, hi - 1], log: `归并结果 [${aux.join(', ')}] 写回 a[${lo}..${hi - 1}]`, desc: `写回区间 [${lo}, ${hi - 1}]` });
        }
        width *= 2;
        passEnd(`第 ${++passCount} 趟归并（段长 ${width}）`, `第 ${passCount} 趟归并完成：所有长度 ${width} 的段内部有序`);
      }
    }

    for (let k = 0; k < n0; k++) if (!sorted.includes(k)) sorted.push(k);
    snap('done', { log: `排序完成：[${a.join(', ')}]。共比较 ${st.compares} 次、移动 ${st.moves} 次。`, logType: 'success', desc: `完成！比较 ${st.compares} 次，移动 ${st.moves} 次` });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const n = s.arr.length;
    const meta = _SORT_META[model.algo];
    const maxV = Math.max(...s.arr, 10);
    const W = n * 48 + 30, H = 250;
    const barW = 34, gap = 14;

    /* 柱状图 + 数值（快排挖坑法：空位画虚线框） */
    const bars = s.arr.map((v, i) => {
      const x = 20 + i * (barW + gap);
      const isHole = s.hole === i;
      if (isHole) {
        return `
        <rect x="${x}" y="177" width="${barW}" height="28" rx="5" fill="#eef2ff" stroke="#6366f1" stroke-dasharray="4 3"/>
        <text x="${x + barW / 2}" y="196" text-anchor="middle" style="font:800 11px Consolas,monospace" fill="#4338ca">空位</text>
        <text x="${x + barW / 2}" y="222" text-anchor="middle" style="font:600 10px sans-serif" fill="#6366f1">${i}</text>`;
      }
      const h = 18 + Math.round((v / maxV) * 160);
      const isHi = s.hi.includes(i);
      const isTouch = s.touched.includes(i);
      const isSorted = s.sorted.includes(i);
      const inRange = s.range && i >= s.range[0] && i <= s.range[1];
      let color = '#94a3b8';
      if (isSorted) color = '#10b981';
      else if (isTouch) color = '#f43f5e';
      else if (isHi) color = '#f59e0b';
      else if (inRange) color = '#64748b';
      return `
        <rect x="${x}" y="${205 - h}" width="${barW}" height="${h}" rx="5" fill="${color}" opacity="${inRange || isHi || isTouch || isSorted ? 1 : 0.75}"/>
        <text x="${x + barW / 2}" y="${205 - h - 6}" text-anchor="middle" style="font:800 12px Consolas,monospace" fill="${isHi || isTouch ? '#334155' : '#64748b'}">${v}</text>
        <text x="${x + barW / 2}" y="222" text-anchor="middle" style="font:600 10px sans-serif" fill="#94a3b8">${i}</text>`;
    }).join('');

    const rangeNote = s.range ? `<text x="${20 + s.range[0] * (barW + gap)}" y="242" style="font:700 11px sans-serif" fill="#6366f1">↳ 当前工作区间 [${s.range[0]}, ${s.range[1]}]</text>` : '';

    /* 每趟结果表（真题反推训练） */
    const passRows = s.passes.map((p, i) => `
      <tr class="${i === s.passes.length - 1 && s.type === 'pass' ? 'row-cur' : ''}">
        <td class="font-bold whitespace-nowrap">${p.label}</td>
        <td class="font-mono">${p.arr.join(', ')}</td>
      </tr>`).join('');
    const passTable = s.passes.length ? `
      <div>
        ${RC408.ui.sectionTitle('每趟结果表（真题套路：给中间结果反推算法——对照上方"一趟特征"表）')}
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="tbl w-full"><thead><tr><th>趟次</th><th>序列状态</th></tr></thead><tbody>${passRows}</tbody></table>
        </div>
      </div>` : '';

    const stats =
      RC408.ui.statCard('算法', meta.name, `${meta.cmp} · ${meta.stable}`, 'text-indigo-600') +
      RC408.ui.statCard('比较次数', s.stats.compares, '与初始序列是否有关？', 'text-amber-600') +
      RC408.ui.statCard('移动/交换次数', s.stats.moves, '简单选择的移动与初始序列无关', 'text-rose-600') +
      RC408.ui.statCard('最新一趟', s.passName || '—', `${s.passes.length} 趟已完成`, 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${Math.max(W, 520)}px">
            ${bars}${rangeNote}
          </svg>
        </div>

        ${s.pivotVal !== null && s.pivotVal !== undefined ? `
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          🎯 <b>挖坑法进行中：</b>枢轴 <b>${s.pivotVal}</b> 已取出暂存（不属于任何位置），图中虚线框是当前<b>空位</b>；
          每填入一个元素，空位就移到被取走元素的位置——所以过程中数组会出现"少一个枢轴"的中间态，划分结束时枢轴填入最后的空位。
        </div>` : ''}

        ${passTable}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '正在比较')}
          ${RC408.ui.legend('#f43f5e', '本帧被移动/交换')}
          ${RC408.ui.legend('#6366f1', '空位（枢轴已取出暂存）')}
          ${RC408.ui.legend('#10b981', '已确定最终位置')}
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>${meta.best}。用"每趟结果表"练习反推：冒泡/选择/堆排每趟确定一个最终位置（绿色），
          快排每趟枢轴归位，归并第 k 趟段长 2ᵏ，插入只有前缀局部有序。
        </div>
      </div>`;
  },
});
