'use strict';
/* ============================================================================
 * os-file-alloc.js —— 【操作系统】文件系统：混合索引计算器（即时）（前缀 _fa）
 * 考情：大题常客（2010-30/2012-46/2013-26/2018-46/2022-45/2026-46），固定三问：
 * ① 最大文件长度；② 读某偏移需几次访盘；③ 文件增大用到哪级间接地址。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-file-alloc',
  mode: 'instant',
  title: '文件系统 · 混合索引计算器',

  theory: `
> **为什么要有它**：文件既要能**长得很大**，又要能**快速定位任意偏移**——连续分配做不到，于是用索引。
> **怎么实现**：inode 里放若干**直接地址项** + **一级/二级/三级间接项**，用索引块把地址空间层层放大。
> **记住什么**：**N = 块大小 ÷ 地址项长度**、**最大长度 = (d + N + N²) × 块大小**、访盘次数 1/2/3。

## 混合索引结构（UNIX 风格 inode）
\`\`\`text
inode：直接地址项 d 个（指向数据块）
      + 一级间接项 1 个（指向的块里存 N 个地址项）
      + 二级间接项 1 个（指向的块里存 N 个一级间接块）…
\`\`\`
- **每块可存地址项数 N = 块大小 ÷ 地址项长度**（如 1KB 块、4B 地址项 → N = 256）；
- **最大文件长度 = (d + N + N²) × 块大小**；
- 读一个数据块的**访盘次数**（不含读 inode）：直接 1 次、一级 2 次（先读索引块）、二级 3 次。

## 考点提醒（易错点）
1. **N 只由"块大小 ÷ 地址项长度"决定**，与文件大小无关——分母搞混是本题型第一大坑；
2. 文件**增大**时按"占满直接块 → 一级 → 二级"的顺序推进（2022-45：文件增至 6MB 用到哪级）；
3. 题目若说"读 inode 还要 1 次访盘"，总次数要 **+1**（先读 inode 才知道地址）；
4. 2026-46 还考过 **inode 本身落在哪个盘块** 与**目录删除要动哪些项**——别只会算长度。

> **真题考情**：**6/18 年，大题 4 道**（2012-46、2018-46、2022-45、2026-46；选 2010-30、2013-26），
> 固定三问：**最大文件长度**、**读某偏移需几次访盘**、**文件增大用到哪级间接地址**。
`,

  inputs: [
    { key: 'B', label: '磁盘块大小', type: 'select', default: 1024,
      options: [{ v: 512, t: '512 B' }, { v: 1024, t: '1 KB' }, { v: 2048, t: '2 KB' }, { v: 4096, t: '4 KB' }] },
    { key: 'alen', label: '地址项长度（字节）', type: 'select', default: 4, options: [2, 4, 8].map(v => ({ v, t: `${v} B` })) },
    { key: 'direct', label: '直接地址项个数 d', type: 'text', default: '10' },
    { key: 'ind1', label: '一级间接项个数', type: 'text', default: '1' },
    { key: 'ind2', label: '二级间接项个数', type: 'text', default: '1' },
    { key: 'offset', label: '查询：文件内偏移量（字节，可选）', default: '5000', ph: '如 5000；留空不查询' },
  ],

  quickActions: [
    { label: '2026 真题：4KB 块', run(rt) { rt.setInput('B', 4096); rt.setInput('alen', 4); rt.setInput('direct', '10'); rt.setInput('offset', '6000000'); rt.load(); } },
    { label: '王道经典：1KB/4B', run(rt) { rt.setInput('B', 1024); rt.setInput('alen', 4); rt.setInput('direct', '10'); rt.setInput('offset', '5000'); rt.load(); } },
  ],

  parse(vals) {
    const B = parseInt(vals.B, 10);
    const alen = parseInt(vals.alen, 10);
    const direct = parseInt(vals.direct, 10), i1 = parseInt(vals.ind1, 10), i2 = parseInt(vals.ind2, 10);
    if (![512, 1024, 2048, 4096].includes(B)) throw { message: '块大小无效' };
    if (![2, 4, 8].includes(alen)) throw { message: '地址项长度无效' };
    if (B % alen !== 0) throw { message: '块大小必须能被地址项长度整除' };
    if (!(direct >= 0) || !(i1 >= 0) || !(i2 >= 0)) throw { message: '地址项个数须为非负整数' };
    const N = Math.floor(B / alen);                    // 每块可存地址项数
    const lvl1 = i1 * N * B, lvl2 = i2 * N * N * B;    // 一级/二级间接容量（字节）
    const maxFile = (direct + N + N * N) * B;
    const offset = vals.offset.trim() === '' ? null : parseInt(vals.offset, 10);
    if (offset !== null && (!Number.isInteger(offset) || offset < 0)) throw { message: '偏移量须为非负整数' };
    /* 判定偏移落在哪一级 */
    let where = null, diskReads = null;
    if (offset !== null) {
      const dBytes = direct * B;
      if (offset < dBytes) { where = '直接地址项'; diskReads = 1; }
      else if (offset < dBytes + N * B) { where = '一级间接地址项'; diskReads = 2; }
      else if (offset < dBytes + N * B + N * N * B) { where = '二级间接地址项'; diskReads = 3; }
      else throw { message: `偏移 ${offset} 超出该 inode 可表示的最大文件长度 ${(dBytes + N * B + N * N * B)} B（本题未含三级间接）` };
    }
    return { B, alen, direct, i1, i2, N, maxFile, offset, where, diskReads };
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const fmtKB = b => b >= 1024 * 1024 ? (b / 1024 / 1024).toPrecision(5) + ' MB' : b >= 1024 ? (b / 1024).toPrecision(5) + ' KB' : b + ' B';
    const directCap = m.direct * m.B, lvl1Cap = m.i1 * m.N * m.B, lvl2Cap = m.i2 * m.N * m.N * m.B;
    const maxLen = (m.direct + m.N + m.N * m.N) * m.B;
    const cards =
      RC408.ui.statCard('每块地址项数 N', m.N, `块 ${m.B}B ÷ 地址项 ${m.alen}B`, 'text-indigo-600') +
      RC408.ui.statCard('直接区容量', fmtKB(directCap), `${m.direct} × ${m.B}B`, 'text-emerald-600') +
      RC408.ui.statCard('一级间接容量', fmtKB(lvl1Cap), `${m.i1} × N × ${m.B}B`, 'text-amber-600') +
      RC408.ui.statCard('二级间接容量', fmtKB(lvl2Cap), `${m.i2} × N² × ${m.B}B`, 'text-rose-600');

    const maxCard = `
      <div class="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-900 leading-relaxed">
        <b>最大文件长度</b> = (d + N + N²) × 块大小
        = (${m.direct} + ${m.N} + ${m.N}²) × ${m.B}B
        = <b class="font-mono">${fmtKB(maxLen)}</b>
        （直接 ${fmtKB(directCap)} + 一级 ${fmtKB(lvl1Cap)} + 二级 ${fmtKB(lvl2Cap)}）
      </div>`;

    const queryCard = m.offset !== null ? `
      <div class="rounded-xl border ${m.diskReads === 1 ? 'border-emerald-200 bg-emerald-50/60' : m.diskReads === 2 ? 'border-amber-200 bg-amber-50/60' : 'border-rose-200 bg-rose-50/60'} p-4 text-sm leading-relaxed text-slate-700">
        <b>查询：偏移 ${m.offset} B</b> 落在 <b>${m.where}</b> → 读该数据块需访盘 <b>${m.diskReads} 次</b>
        （${m.diskReads === 1 ? '直接块' : m.diskReads === 2 ? '先读一级索引块，再读数据块' : '先读二级索引块、再读一级索引块、最后读数据块'}）；
        不含"读 inode"那 1 次访盘。
      </div>` : '';

    const structHtml = `
      <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 overflow-x-auto">
        ${RC408.ui.sectionTitle('inode 混合索引结构示意')}
        <div class="flex items-start gap-3 justify-center flex-wrap text-center">
          <div class="rounded-lg bg-indigo-500 text-white px-4 py-3 font-bold text-sm shrink-0">inode<br><span class="text-[10px] font-normal">d=${m.direct} 直接<br>1 一级 · 1 二级</span></div>
          <div class="self-center text-slate-400">→</div>
          <div class="flex flex-col gap-2">
            <div class="flex gap-2">${Array.from({ length: Math.min(m.direct, 5) }, (_, i) => `<div class="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-mono">块${i}</div>`).join('')}${m.direct > 5 ? `<div class="self-center text-xs text-slate-400">…共 ${m.direct} 个直接块</div>` : ''}</div>
            <div class="flex gap-2 items-center"><div class="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-mono">一级索引块（存 ${m.N} 个地址）</div><span class="text-xs text-slate-400">→ 数据块 × ${m.N}</span></div>
            <div class="flex gap-2 items-center"><div class="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-mono">二级索引块（存 ${m.N} 个一级块地址）</div><span class="text-xs text-slate-400">→ 数据块 × ${m.N * m.N}</span></div>
          </div>
        </div>
      </div>`;

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>
        ${structHtml}
        ${maxCard}
        ${queryCard}
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>文件增大时先占满直接块 → 一级 → 二级（2022 真题"文件增至 6MB 用到哪级间接"）；
          读 inode 本身通常算 1 次访盘（若题目给出）；每块地址项数 N = 块大小 ÷ 地址项长度，余数舍去。
        </div>
      </div>`;
  },
});
