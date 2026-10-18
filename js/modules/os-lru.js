'use strict';
/* ============================================================================
 * lru.js —— 【操作系统】页面置换算法 · LRU（最近最久未使用）+ FIFO / OPT 对照
 * ----------------------------------------------------------------------------
 * 快照设计（每访问一个页面产生一帧，另加一帧初始状态、一帧末帧对照）：
 *   { type:'init'|'hit'|'load'|'replace'|'done',
 *     page       本次访问的页号
 *     fault      是否缺页
 *     placed     本次装入/替换的物理块下标（-1 表示命中）
 *     victim / victimIdx   replace 时被淘汰的页号及其物理块下标
 *     frames     物理块数组（处理后）
 *     prev       物理块数组（处理前，供渲染对照）
 *     recency    LRU 使用顺序，recency[0] = 最久未使用
 *     seq        全序列的 LRU 逐列状态（**自带**，不再去读 RC408.Runner，见下）
 *     cmp        末帧才有：{fifo:{faults,cols}, opt:{faults,cols}} 与 lru 的逐列对照
 *     faults / accesses / rate  累计缺页数 / 已访问数 / 缺页率 }
 * 渲染时对"当前帧变化的块"附加动画类：
 *   命中 → 绿色光环；缺页装入 → 红闪 + 滑入；置换 → 旧页红字上飘消失(ghost) + 新页滑入
 *
 * ⚠ 两条硬纪律（窗56b 修）：
 *   ① **render 只读 `ctx.snap` / `ctx.model`**：原来它去读 `RC408.Runner.snaps`（全局调度器），
 *      于是"非首帧在 Node 侧渲染一律抛错"（P3 冒烟 20/20 帧报 `Cannot read properties of undefined`），
 *      而浏览器里因为 Runner 存在而看不出来。现在全序列随 `model.seq` / `snap` 传进来。
 *   ② **容器布局用内联 style，不用 Tailwind 工具类**（§4.7 窗26 立）：本站的 Tailwind 来自仓库内兜底，
 *      离线 harness 会摘掉它；实测本模块原来在无 Tailwind 下物理块竖成 3 行、统计卡竖成 4 行。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-lru',
  mode: 'stepper',
  title: '页面置换 · LRU（最近最久未使用）',

  theory: `
> **为什么要有它**：请求分页下进程只占少量页框，页框用完时必须挑一页换出去；挑得不好就频繁缺页，LRU 是按"局部性"挑牺牲页的经典做法。
> **怎么实现**：按局部性原理淘汰"**最近最久未使用**"的页——实现上给每页记最后一次访问的时刻，或维护一个"最近使用顺序"序列，每次访问更新。
> **记住什么**：手算快捷法 + 与 FIFO / OPT / CLOCK 的分工 + "**命中的页也要更新标记**"。

## 手算：三种等价做法

- **时间戳法**：每页记"最后一次被访问的时刻"，淘汰时刻最早的那页；
- **栈 / 访问序法**：每次访问把该页移到"最近使用"端，最前端就是淘汰对象（页面右侧的"使用顺序"条）；
- **快捷法（选择题最快）**：从访问序列**从后往前**数，数到第 m 个**不同**页号就停，那个页号就是淘汰对象（m = 页框数）——2015-27 用它一眼选出 2 号页。

## LRU 的推演：逐列标注

- 画一张"页框 × 访问序列"表：命中就在该框标"命中"并**把它挪到最新**；缺页时先填空框，没空框再淘汰最久未用的。
- 2025-26：3 个页框、序列 0,1,2,0,5,1,4,3,0,2,3,2,0 ⟹ 缺页 **7 次**（5 换 2、4 换 1、3 换 0、0 换 5、2 换 4，最后三次 3、2、0 全命中）。
- **缺页率 = 缺页次数 ÷ 访问总次数**；LRU 属堆栈类算法，页框数增加时缺页次数只减不增。

## 与 FIFO / OPT / CLOCK 的分工

| 算法 | 淘汰谁 | 性质 |
| --- | --- | --- |
| FIFO | 最早进入内存的页 | 实现简单；可能出现 **Belady 异常**（2014-30：只有 FIFO 会犯） |
| LRU | 最近最久未使用的页 | 堆栈类，**不会** Belady 异常；需硬件支持（计数器或栈） |
| OPT | 将来最长时间不用的页 | 理论最优、不可实现，只作评价基准 |
| CLOCK | 循环扫描访问位 A，A=1 给第二次机会并清 0 | LRU 的低开销近似 |
| 改进型 CLOCK | 按 (访问位 A, 修改位 M) 淘汰：(0,0) → (0,1) → (1,0) → (1,1) | 兼顾"未访问"与"未修改"（2016-26） |

## 与地址转换题联动的三步

1. 先按页大小把虚地址切成页号与页内偏移（4KB 页 ⟹ 低 12 位是偏移，2009-46）；
2. 查快表：命中得页框号；未命中查页表；缺页时按 LRU 淘汰一页，并同时更新页表与快表；
3. 页框号拼上页内偏移 = 物理地址；再数清"快表 + 页表 + 主存"各访问几次——2009-46 的 210ns、100000220ns、110ns 就是这么加出来的。

## 考点提醒（易错点）

1. **命中的页也要更新"最近使用"标记**，漏更新就把 LRU 做成了 FIFO；
2. 快捷法数的是"**不同**页号"，重复页号不计数；
3. 缺页次数与置换算法、页框数、访问序列都有关，问"缺页几次"就逐列推；
4. 与"页式虚拟内存"合考时，置换只是链路中的一步，别漏掉快表与页表的更新。

> **真题考情**：**7/18 年（选 4 + 大 3）**：大 2009-46、2010-46、2012-45；选 2015-27（快捷法）、2019-29、2021-28、2025-26（缺页 7 次）。
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
    { label: '📖 教材经典串（20 次访问 / 3 块，与推导表同款）', run(rt) {
      rt.setInput('pages', '7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1'); rt.setInput('frames', '3'); rt.load();
    } },
    { label: '🎯 2025-26 真题（0,1,2,0,5,1,4,3,0,2,3,2 / 3 块，答案 C）', run(rt) {
      rt.setInput('pages', '0,1,2,0,5,1,4,3,0,2,3,2'); rt.setInput('frames', '3'); rt.load();
    } },
    { label: '★ Belady 异常：1,2,3,4,1,2,5,1,2,3,4,5 在 3 块下（看末帧对照表）', run(rt) {
      rt.setInput('pages', '1,2,3,4,1,2,5,1,2,3,4,5'); rt.setInput('frames', '3'); rt.load();
    } },
    { label: '★ 同一条串改 4 块（FIFO 缺页反而变多 = Belady 异常）', run(rt) {
      rt.setInput('pages', '1,2,3,4,1,2,5,1,2,3,4,5'); rt.setInput('frames', '4'); rt.load();
    } },
    { label: '顺序扫描（1..8 各一次 / 3 块，LRU 与 OPT 都会缺页满格）', run(rt) {
      rt.setInput('pages', '1,2,3,4,5,6,7,8'); rt.setInput('frames', '3'); rt.load();
    } },
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
    const seq = [];                        // 全序列逐列状态（供渲染画推导表；render 不许再去读 Runner）

    const snaps = [{
      type: 'init', page: null, fault: false, placed: -1, victim: null, victimIdx: -1,
      frames: [...frames], prev: [...frames], recency: [], seq: [],
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

      seq.push({ page: p, fault, victim, frames: [...frames] });
      snaps.push({
        type: fault ? (victimIdx >= 0 ? 'replace' : 'load') : 'hit',
        page: p, fault, placed, victim, victimIdx,
        frames: [...frames], prev, recency: [...recency], seq: seq.map(c => ({ page: c.page, fault: c.fault, victim: c.victim, frames: [...c.frames] })),
        faults, accesses: t + 1, rate: faults / (t + 1),
        log, logType,
        desc: fault
          ? (victimIdx >= 0 ? `页面 ${p} 缺页且块已满 → 淘汰 ${victim}，换入 ${p}` : `页面 ${p} 缺页 → 装入空闲的物理块 ${placed + 1}`)
          : `页面 ${p} 命中（不缺页）`,
      });
    });

    /* ---- 末帧：FIFO / OPT 对照（本模块只演 LRU，但真题的判据是"三者比"）---- */
    const fifo = _simFIFO(pages, F), opt = _simOPT(pages, F);
    model.seq = seq.map(c => ({ page: c.page, fault: c.fault, victim: c.victim, frames: [...c.frames] }));
    const best = Math.min(faults, fifo.faults, opt.faults);
    const dlog = 'LRU 缺页 ' + faults + ' 次 ｜ FIFO ' + fifo.faults + ' 次 ｜ OPT ' + opt.faults
      + ' 次（理论最优）' + (fifo.faults > opt.faults ? '；FIFO 比 OPT 多 ' + (fifo.faults - opt.faults) + ' 次' : '')
      + (faults === best ? '；本序列上 LRU 已达到最优' : '');
    snaps.push({
      type: 'done', page: null, fault: false, placed: -1, victim: null, victimIdx: -1,
      frames: [...frames], prev: [...frames], recency: [...recency],
      seq: seq.map(c => ({ page: c.page, fault: c.fault, victim: c.victim, frames: [...c.frames] })),
      cmp: { fifo: fifo, opt: opt, lruFaults: faults },
      faults, accesses: pages.length, rate: faults / pages.length,
      log: dlog, logType: 'info',
      desc: '末帧对照：同一条访问序列在 LRU / FIFO / OPT 下的逐列结果与缺页次数 —— 换「物理块数」再跑一遍，就能看出 FIFO 的 Belady 异常',
    });

    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const F = model.F;
    /* ⚠ 容器布局一律内联 style（§4.7 窗26 立）：Tailwind 在本站来自仓库内兜底，
       离线 harness 会摘掉它；用工具类会让"离线渲染"与用户所见不一致（本模块改造前实测：
       物理块竖成 3 行、统计卡竖成 4 行）。 */
    const sec = (title, body) => '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle(title) + body + '</div>';

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
      return '<div class="tl2-frame-col" style="display:flex;flex-direction:column;align-items:center;gap:4px">'
        + `<div class="${cls}">${body}</div>`
        + '<div style="font:600 11px system-ui;color:#94a3b8">物理块 ' + (i + 1) + '</div>'
        + (badge || '<div style="height:15px"></div>')
        + '</div>';
    }).join('');

    /* ---- LRU 使用顺序条（栈型展示） ---- */
    const recencyHtml = s.recency.length
      ? s.recency.map((p, i) => {
          const edge = i === 0 ? '最久' : i === s.recency.length - 1 ? '最近' : '';
          return RC408.ui.chip(p, i === s.recency.length - 1 ? 'chip-hit' : 'chip-mst', edge ? `第 ${i + 1} 位（${edge}使用）` : '');
        }).join('<span style="color:#cbd5e1;align-self:center">→</span>')
      : '<span style="font:12px system-ui;color:#94a3b8">（空）</span>';

    /* ---- 访问序列徽片（只读本帧快照的 seq，不再去读 Runner） ---- */
    const seqHtml = model.pages.map((p, j) => {
      let cls = 'chip-future';
      const col = s.seq && s.seq[j];
      if (col) cls = col.fault ? 'chip-fault' : 'chip-hit';
      if (j === s.accesses - 1 && s.type !== 'init') cls += ' chip-cur';
      return RC408.ui.chip(p, cls, `第 ${j + 1} 次访问`);
    }).join('');

    stage.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:10px">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' + stats + '</div>'
      + sec('物理块（主存页框）',
          '<div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;padding:2px 0">' + framesHtml + '</div>')
      + sec('LRU 使用顺序（左 → 右 = 最久未使用 → 最近使用；绿色为最近使用）',
          '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">' + recencyHtml + '</div>')
      + sec('访问序列（红 = 缺页，绿 = 命中，描边 = 当前）',
          '<div style="display:flex;flex-wrap:wrap;gap:6px">' + seqHtml + '</div>')
      + _lruMatrix(ctx, s)
      + _lruCompare(s)
      + '</div>';
  },
});

/* ---- 经典推导表：列 = 各次访问，行 = 各物理块（读本帧快照的 seq 前缀） ---- */
function _lruMatrix(ctx, s) {
  const upto = Math.max(0, s.accesses);   // 显示 1..upto 次访问
  if (!upto || !s.seq) return '';
  const model = ctx.model;

  let head = '<tr><th class="sticky-col"></th>';
  let hitRow = '<tr><th style="text-align:left">命中?</th>';
  const rows = Array.from({ length: model.F }, (_, f) => `<tr><th style="text-align:left">块 ${f + 1}</th>`);

  for (let j = 1; j <= upto; j++) {
    const sj = s.seq[j - 1];
    if (!sj) break;
    const isCur = j === upto && s.type !== 'init';
    head += `<th class="${sj.fault ? 'th-fault' : 'th-hit'} ${isCur ? 'col-cur' : ''}">${sj.page}${isCur ? ' ◀' : ''}</th>`;
    hitRow += `<td class="${isCur ? 'col-cur' : ''}">${sj.fault ? '<b style="color:#e11d48">✚</b>' : '<b style="color:#059669">✓</b>'}</td>`;
    for (let f = 0; f < model.F; f++) {
      const v = sj.frames[f];
      rows[f] += `<td class="${isCur ? 'col-cur' : ''}">${v === null || v === undefined ? '·' : v}</td>`;
    }
  }
  head += '</tr>'; hitRow += '</tr>';
  const body = rows.map(r => r + '</tr>').join('');

  return '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
    + RC408.ui.sectionTitle('推导表格（教材标准画法：✚ = 缺页调入，✓ = 命中；划到最右列 = 当前访问）')
    + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px">'
    + `<table class="tbl" style="width:100%">${head}${hitRow}${body}</table>`
    + '</div></div>';
}

/* ---- 末帧对照用的两条独立参考实现（只用本函数自己的局部状态，不和主算法共享任何东西）---- */

/** FIFO：淘汰"最早进入"的页（块满时替换队首页） */
function _simFIFO(pages, F) {
  const frames = Array(F).fill(null);
  const queue = [];               // 装入顺序
  const cols = [];
  let faults = 0;
  pages.forEach(p => {
    let fault = false;
    if (frames.indexOf(p) >= 0) { /* 命中 */ }
    else {
      fault = true; faults++;
      const empty = frames.indexOf(null);
      const at = empty >= 0 ? empty : frames.indexOf(queue.shift());
      frames[at] = p; queue.push(p);
    }
    cols.push({ page: p, fault, frames: [...frames] });
  });
  return { faults: faults, cols: cols };
}

/** OPT（Belady 最优）：淘汰"以后最长时间不再被访问"的页；后续不再出现者优先淘汰 */
function _simOPT(pages, F) {
  const frames = Array(F).fill(null);
  const cols = [];
  let faults = 0;
  pages.forEach((p, t) => {
    let fault = false;
    if (frames.indexOf(p) >= 0) { /* 命中 */ }
    else {
      fault = true; faults++;
      const empty = frames.indexOf(null);
      let at = empty;
      if (at < 0) {
        let bestAt = 0, bestNext = -1;
        for (let f = 0; f < F; f++) {
          let nx = -1;
          for (let j = t + 1; j < pages.length; j++) if (pages[j] === frames[f]) { nx = j; break; }
          if (nx < 0) { bestAt = f; bestNext = Infinity; break; }   // 以后不再出现 ⟹ 先淘汰它
          if (nx > bestNext) { bestNext = nx; bestAt = f; }
        }
        at = bestAt;
      }
      frames[at] = p;
    }
    cols.push({ page: p, fault, frames: [...frames] });
  });
  return { faults: faults, cols: cols };
}

/* ---- 末帧对照表：同一序列在 LRU / FIFO / OPT 下的逐列结果（真题判据就要这一张） ---- */
function _lruCompare(s) {
  if (s.type !== 'done' || !s.cmp) return '';
  const rows = [
    { name: 'LRU（本模块逐个演示的）', data: s.seq, faults: s.cmp.lruFaults, color: '#4f46e5' },
    { name: 'FIFO（先进先出）', data: s.cmp.fifo.cols, faults: s.cmp.fifo.faults, color: '#0891b2' },
    { name: 'OPT（理论最优）', data: s.cmp.opt.cols, faults: s.cmp.opt.faults, color: '#059669' },
  ];
  const isBest = (r) => r.faults === Math.min.apply(null, rows.map(x => x.faults));
  let th = '<tr><th class="sticky-col"></th>';
  rows[0].data.forEach(c => { th += `<th class="${c.fault ? 'th-fault' : 'th-hit'}">${c.page}</th>`; });
  th += '</tr>';
  const body = rows.map(r => {
    let tr = '<tr><th style="text-align:left;white-space:nowrap;color:' + r.color + '">' + r.name
      + '<div style="font:600 11px system-ui;color:#64748b">缺页 ' + r.faults + ' 次'
      + (isBest(r) ? '（本序列最少）' : '') + '</div></th>';
    r.data.forEach(c => { tr += `<td>${c.fault ? '<b style="color:#e11d48">✚</b>' : '<b style="color:#059669">✓</b>'}</td>`; });
    return tr + '</tr>';
  }).join('');
  const fifoV = s.cmp.fifo.faults, optV = s.cmp.opt.faults, lruV = s.cmp.lruFaults;
  const hint = fifoV > optV
    ? '本序列上 <b>FIFO 比 OPT 多缺页 ' + (fifoV - optV) + ' 次</b>；把「物理块数」加减 1 再跑一遍（左上两个预设），就能看出 FIFO 的 <b>Belady 异常</b>（块数增加、缺页反而增多）。'
    : '本序列上三种算法缺页次数相同（都达到下界）：换一条有"刚被换出又马上要访问"的序列，LRU 的优势才会显现。';
  return '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
    + RC408.ui.sectionTitle('三算法对照（同一条访问序列：✚ = 缺页，✓ = 命中）')
    + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px"><table class="tbl" style="width:100%">'
    + th + body + '</table></div>'
    + '<div style="font:13px/1.7 system-ui;color:#0f172a;margin-top:8px">' + hint + '</div></div>';
}
