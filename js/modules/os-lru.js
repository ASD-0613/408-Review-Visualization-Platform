'use strict';
/* ============================================================================
 * lru.js —— 【操作系统】页面置换算法 · LRU（最近最久未使用）
 * ----------------------------------------------------------------------------
 * 快照设计（每访问一个页面产生一帧，另加一帧初始状态）：
 *   { type:'init'|'hit'|'load'|'replace',
 *     page       本次访问的页号
 *     fault      是否缺页
 *     placed     本次装入/替换的物理块下标（-1 表示命中）
 *     victim / victimIdx   replace 时被淘汰的页号及其物理块下标
 *     frames     物理块数组（处理后）
 *     prev       物理块数组（处理前，供渲染对照）
 *     recency    LRU 使用顺序，recency[0] = 最久未使用
 *     faults / accesses / rate  累计缺页数 / 已访问数 / 缺页率 }
 * 渲染时对"当前帧变化的块"附加动画类：
 *   命中 → 绿色光环；缺页装入 → 红闪 + 滑入；置换 → 旧页红字上飘消失(ghost) + 新页滑入
 * ========================================================================== */

RC408.registerModule({
  id: 'os-lru',
  mode: 'stepper',
  title: '页面置换 · LRU（最近最久未使用）',

  theory: `
> **为什么要有它**：请求分页下进程只用少量物理块，块用完时**必须**挑一页换出去，挑得不好就频繁缺页。
> **怎么实现**：按局部性原理淘汰"**最长时间未被访问**"的页（时间戳法或访次栈法）。
> **记住什么**：FIFO / LRU / OPT 三张淘汰规则 + **命中也要更新标记**（LRU 与 FIFO 最易混的一点）。

## 手算方法（考试通用）
- **时间戳法**：给每页记录"最后一次被访问的时刻"，淘汰时刻最早者；
- **栈 / 访次序列法**：维护一个页号序列，每次访问把该页移到**末尾**（最近使用端），
  **最前端**即最久未使用页——本可视化右侧"使用顺序"条就是它。

## 与 FIFO / OPT 对比
| 算法 | 淘汰规则 | 特点 |
| --- | --- | --- |
| FIFO | 最先进入的页 | 实现简单；可能出现 **Belady 异常**（块数增加、缺页反而增多） |
| LRU | 最近最久未使用 | 堆栈类算法，**无 Belady 异常**；硬件开销较大 |
| OPT | 以后最长时间不被访问 | 理论最优、无法实现，只作评价基准 |

## 考点提醒（易错点）
1. **命中的页也要更新"最近使用"标记**——漏更新就会把 LRU 做成 FIFO；
2. **缺页率 = 缺页次数 ÷ 访问总次数**；"某序列在 m 个物理块下缺页几次"用表格**逐列推**最稳；
3. **Belady 异常只有 FIFO 会犯**（2014-30 直接考"只有 FIFO 导致 Belady 异常"）；
4. 置换算法的"推演"是计算题：先画"块 × 访问序列"的表，再逐列标命中/缺页与淘汰对象。

> **真题考情**：**7/18 年**（大 2009-46、2010-46、2012-45；选 2015-27、2019-29、2021-28、2025-26），
> FIFO / LRU / CLOCK 都考过；与「页式虚拟内存」合起来看，虚拟内存整体 **16/18 年**。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'pages', label: '页面访问序列', wide: true,
      default: '7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1',
      ph: '例：7,0,1,2,0,3,0,4', help: '逗号 / 空格分隔，最多 40 个，页号 0~999',
    },
    {
      key: 'frames', label: '物理块数', type: 'select', default: 3,
      options: [1, 2, 3, 4, 5, 6, 7, 8].map(v => ({ v, t: `${v} 块` })),
    },
  ],

  quickActions: [
    {
      label: '🎲 随机序列', run(rt) {
        const n = RC408.util.rnd(14, 20);
        const seq = Array.from({ length: n }, () => RC408.util.rnd(0, 6));
        rt.setInput('pages', seq.join(','));
        rt.load();
      },
    },
    { label: 'Belady 异常示例(串1)', run(rt) { rt.setInput('pages', '1,2,3,4,1,2,5,1,2,3,4,5'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const pages = vals.pages.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (!pages.length) throw { message: '请输入页面访问序列，如 7,0,1,2,0,3' };
    if (pages.length > 40) throw { message: '访问序列最长 40 个（便于展示）' };
    if (pages.some(p => p > 999)) throw { message: '页号请控制在 0 ~ 999' };
    const F = parseInt(vals.frames, 10);
    if (!(F >= 1 && F <= 8)) throw { message: '物理块数须为 1 ~ 8' };
    return { pages, F };
  },

  /* ---------------- ② 纯算法：逐页访问产出快照 ---------------- */
  buildSnapshots(model) {
    const { pages, F } = model;
    let frames = Array(F).fill(null);      // 物理块
    let recency = [];                      // [0]=最久未使用 … [end]=最近使用
    let faults = 0;

    const snaps = [{
      type: 'init', page: null, fault: false, placed: -1, victim: null, victimIdx: -1,
      frames: [...frames], prev: [...frames], recency: [],
      faults: 0, accesses: 0, rate: 0,
      log: `就绪：物理块数 = ${F}，共 ${pages.length} 次页面访问。LRU 原则：淘汰「最长时间未被访问」的页。`,
      logType: 'info',
      desc: '点击「单步执行」逐个访问页面；注意：命中也会把该页提升为"最近使用"',
    }];

    pages.forEach((p, t) => {
      const prev = [...frames];
      const idxIn = frames.indexOf(p);
      let fault = false, placed = -1, victim = null, victimIdx = -1, log, logType;

      if (idxIn >= 0) {
        /* ---- 命中：把该页移到"最近使用"端 ---- */
        recency = recency.filter(x => x !== p);
        recency.push(p);
        log = `访问页面 ${p} → 命中 ✓（物理块 ${idxIn + 1}），并将其提升为「最近使用」`;
        logType = 'success';
      } else {
        /* ---- 缺页 ---- */
        fault = true; faults++;
        const empty = frames.indexOf(null);
        if (empty >= 0) {
          // 有空闲块：直接装入（不算置换）
          frames[empty] = p; recency.push(p); placed = empty;
          log = `访问页面 ${p} → 缺页 ✚（有空闲块）—— 装入物理块 ${empty + 1}`;
          logType = 'warn';
        } else {
          // 物理块满：LRU 淘汰 recency 最前端（最久未使用）
          victim = recency.shift();
          victimIdx = frames.indexOf(victim);
          frames[victimIdx] = p; recency.push(p); placed = victimIdx;
          log = `访问页面 ${p} → 缺页 ✚ —— LRU 淘汰「最久未使用」的页面 ${victim}（物理块 ${victimIdx + 1}），换入 ${p}`;
          logType = 'error';
        }
      }

      snaps.push({
        type: fault ? (victimIdx >= 0 ? 'replace' : 'load') : 'hit',
        page: p, fault, placed, victim, victimIdx,
        frames: [...frames], prev, recency: [...recency],
        faults, accesses: t + 1, rate: faults / (t + 1),
        log, logType,
        desc: fault
          ? (victimIdx >= 0 ? `页面 ${p} 缺页且块已满 → 淘汰 ${victim}，换入 ${p}` : `页面 ${p} 缺页 → 装入空闲的物理块 ${placed + 1}`)
          : `页面 ${p} 命中（不缺页）`,
      });
    });

    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, idx, total, stage } = ctx;
    const U = RC408.util;
    const F = model.F;

    /* ---- 统计卡片 ---- */
    const stats =
      RC408.ui.statCard('访问进度', `${s.accesses} / ${model.pages.length}`, '已处理页访问数') +
      RC408.ui.statCard('缺页次数', s.faults, '装入或置换均算缺页', 'text-rose-600') +
      RC408.ui.statCard('命中次数', s.accesses - s.faults, '本次访问命中时不缺页', 'text-emerald-600') +
      RC408.ui.statCard('缺页率', U.pct(s.rate), '缺页次数 ÷ 已访问次数', s.rate > 0.5 ? 'text-rose-600' : 'text-indigo-600');

    /* ---- 物理块可视化 ---- */
    const framesHtml = s.frames.map((pf, i) => {
      let cls = 'frame-cell';
      let body = '';
      if (pf === null) {
        cls += ' frame-empty';
        body = '—';
      } else {
        const isCur = i === s.placed;   // 本帧发生变化的块
        if (s.type === 'replace' && isCur) {
          cls += ' anim-flash-red';
          body = `<span class="ghost anim-ghost-out">${s.victim}</span><span class="page-num anim-slide-in">${pf}</span>`;
        } else if (s.type === 'load' && isCur) {
          cls += ' anim-flash-red';
          body = `<span class="page-num anim-slide-in">${pf}</span>`;
        } else if (s.type === 'hit' && pf === s.page) {
          cls += ' anim-hit';
          body = `<span class="page-num">${pf}</span>`;
        } else {
          body = `<span class="page-num">${pf}</span>`;
        }
      }
      // 使用顺序角标：最久未使用 / 最近使用
      let badge = '';
      if (s.recency.length && pf !== null) {
        if (s.recency[0] === pf && s.type !== 'init') badge = '<span class="cell-sub" style="color:#e11d48">最久未使用</span>';
        else if (s.recency[s.recency.length - 1] === pf) badge = '<span class="cell-sub" style="color:#059669">最近使用</span>';
      }
      return `<div class="flex flex-col items-center gap-1">
        <div class="${cls}">${body}</div>
        <div class="text-[11px] text-slate-400 font-semibold">物理块 ${i + 1}</div>
        ${badge || '<div class="h-[15px]"></div>'}
      </div>`;
    }).join('');

    /* ---- LRU 使用顺序条（栈型展示） ---- */
    const recencyHtml = s.recency.length
      ? s.recency.map((p, i) => {
          const edge = i === 0 ? '最久' : i === s.recency.length - 1 ? '最近' : '';
          return RC408.ui.chip(p, i === s.recency.length - 1 ? 'chip-hit' : 'chip-mst', edge ? `第 ${i + 1} 位（${edge}使用）` : '');
        }).join('<span class="text-slate-300 self-center">→</span>')
      : '<span class="text-xs text-slate-400">（空）</span>';

    /* ---- 访问序列徽片 ---- */
    const snaps = RC408.Runner.snaps;   // 快照数组：snaps[0]=init，snaps[j]=第 j 次访问
    const seqHtml = model.pages.map((p, j) => {
      let cls = 'chip-future';
      if (j < s.accesses && snaps[j + 1]) {
        cls = snaps[j + 1].fault ? 'chip-fault' : 'chip-hit';
      }
      if (j === s.accesses - 1 && s.type !== 'init') cls += ' chip-cur';
      return RC408.ui.chip(p, cls, `第 ${j + 1} 次访问`);
    }).join('');

    /* ---- 经典推导表格（逐列 = 一次访问后的物理块状态） ---- */
    const tableHtml = _lruMatrix(ctx, s);

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('物理块（主存页框）')}
          <div class="flex flex-wrap gap-4 justify-center py-2">${framesHtml}</div>
        </div>

        <div>
          ${RC408.ui.sectionTitle('LRU 使用顺序（左 → 右 = 最久未使用 → 最近使用；绿色为最近使用）')}
          <div class="flex flex-wrap gap-1 items-center">${recencyHtml}</div>
        </div>

        <div>
          ${RC408.ui.sectionTitle('访问序列（红 = 缺页，绿 = 命中，描边 = 当前）')}
          <div class="flex flex-wrap gap-1.5">${seqHtml}</div>
        </div>

        ${tableHtml}
      </div>`;
  },
});

/* ---- 经典推导表：列 = 各次访问，行 = 各物理块 ---- */
function _lruMatrix(ctx, s) {
  const U = RC408.util;
  const upto = Math.max(0, s.accesses);   // 显示 1..upto 次访问
  if (!upto) return '';

  const model = ctx.model;
  // 快照需要按次序取出；ctx 只带当前帧，这里借助 Runner 的 snaps（通过 window.RC408.Runner）
  const snaps = RC408.Runner.snaps;

  let head = '<tr><th class="sticky-col"></th>';
  let hitRow = '<tr><th style="text-align:left">命中?</th>';
  const rows = Array.from({ length: model.F }, (_, f) => `<tr><th style="text-align:left">块 ${f + 1}</th>`);

  for (let j = 1; j <= upto; j++) {
    const sj = snaps[j];
    const isCur = j === upto && s.type !== 'init';
    head += `<th class="${sj.fault ? 'th-fault' : 'th-hit'} ${isCur ? 'col-cur' : ''}">${sj.page}${isCur ? ' ◀' : ''}</th>`;
    hitRow += `<td class="${isCur ? 'col-cur' : ''}">${sj.fault ? '<b style="color:#e11d48">✚</b>' : '<b style="color:#059669">✓</b>'}</td>`;
    for (let f = 0; f < model.F; f++) {
      const v = sj.frames[f];
      rows[f] += `<td class="${isCur ? 'col-cur' : ''}">${v === null ? '·' : v}</td>`;
    }
  }
  head += '</tr>'; hitRow += '</tr>';
  const body = rows.map(r => r + '</tr>').join('');

  return `
    <div>
      ${RC408.ui.sectionTitle('推导表格（教材标准画法：✚ = 缺页调入，✓ = 命中）')}
      <div class="overflow-x-auto rounded-xl border border-slate-200">
        <table class="tbl w-full">${head}${hitRow}${body}</table>
      </div>
    </div>`;
}
