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
> **为什么要有它**：文件既可能长得很大，又要能快速定位任意偏移、还要能高效插入与扩展——物理结构决定这三件事能不能同时满足。
> **怎么实现**：连续 / 链接 / 索引三种物理结构各有取舍；UNIX 用"inode 直接地址项 + 一级/二级/三级间接项"把地址空间层层放大；目录项用"文件名 + inode 号"把名字映射到文件。
> **记住什么**：三种物理结构的对照 + 混合索引的 N、最大长度、访盘次数 + 硬链接与符号链接的差别。

## 三种物理结构

| 结构 | 怎么存 | 随机访问 | 扩展 | 代价 |
| --- | --- | --- | --- | --- |
| 连续 | 文件占一段连续盘块，FCB 记起址与长度 | **最快**，一次定位 | 难，可能要挪动整段 | 无额外指针块，适合顺序播放（2013-24） |
| 链接 | 每块末尾存下一块的指针，或把指针集中到 FAT | **不支持**，只能顺序找 | 容易，任意块挂上即可 | 找第 i 块要 i 次访盘 |
| 索引 | 索引块集中存该文件的块号 | 支持 | 容易 | 索引块本身要访盘，大文件要多级索引 |

- 2009-28 的判断口径：链式不能随机访问、连续不易扩展 ⟹ 既能随机访问又易扩展的是**索引**结构。
- **插入记录**的访盘次数（2014-46）：顺序结构要把插入点后的记录整体后移——29 条记录读出加写回 58 次、再写新记录 1 次 = **59 次**；链接结构只需找到第 29 块（29 次）、写新块 1 次、改前驱指针 1 次 = **31 次**。

## 目录、FCB 与 inode

- **FCB（文件控制块）**三类信息：基本信息（文件名、物理位置、大小）、**存取控制信息**（权限）、使用信息（创建时间、打开计数）——"按名存取"就靠它（2009-30）。
- **目录项 = 文件名 + inode 号**；文件属性、权限、物理地址都在 **inode** 里，不在目录项里（2020-31、2022-45、2025-29）。
- **打开文件**：open 只把 FCB / inode 调入内存并建"打开文件表"项，**不读文件内容**（2014-29）；两个进程各有一份文件描述符，但可指向同一个 inode（2017-31）。
- **当前目录（工作目录）**：相对路径从当前目录开始，省去从根逐层检索（2010-31）；绝对路径从根开始。
- **删除文件**：删目录项与 inode（引用计数减到 0 才真正删），**不删目录**，并释放其占用的盘块与内存缓冲区（2013-23）。
- **FCB 集中存放**（把目录当文件、FCB 聚在一块）能减少按名查找时的磁头移动与访盘次数（2011-46）。

## 混合索引：三个必算量

- **每块地址项数 N = 块大小 ÷ 地址项长度**（1KB 块、4B 项 ⟹ N = 256）；
- **最大文件长度 =（直接项数 d + N + N 的二次方 + N 的三次方）× 块大小**——有几级间接就加到几级；2018-46 是 8 + 1024 + 1024² + 1024³ 个块 × 4KB ⟹ 32KB + 4MB + 4GB + 4TB；
- **读一个数据块的访盘次数**（inode 已在内存）：直接 **1 次**、一级 **2 次**（先读索引块）、二级 **3 次**；inode 不在内存再 +1。
- 2010-30 的算法：4 个直接块 + 2 个一级间接 + 1 个二级间接，每块 64 项 ⟹ 4×256B + 2×64×256B + 64²×256B = 1057KB。
- 2012-46 的"索引表区只有 512B"：块号 4B ⟹ 128 个直接项 ⟹ 128KB；若另有"预分配连续区"，要把连续区与直接索引区**相加**。
- 2015-29 的偏移判断：先算各段**累计容量**（10KB 以内走直接、10KB 至 266KB 走一级、再大走二级），再定访盘次数。

## 文件共享：硬链接与符号链接

| 方式 | 做什么 | 删除时 |
| --- | --- | --- |
| 硬链接 | 多个目录项指向**同一个 inode**，inode 记**引用计数** | 计数减 1，减到 0 才真正删文件（2009-31） |
| 符号链接（软链接） | 新建一个文件，内容是**目标路径** | 删原文件不影响链接本身，但链接悬空，访问时才发现失效 |

- 建立硬链接：引用计数 +1；建立符号链接：新文件自己的计数为 1，**不增加**原文件的计数（2009-31）。
- 硬链接不能跨文件系统（inode 号只在同一文件系统内唯一），符号链接可以。
- **VFS（虚拟文件系统）**：给不同文件系统套一层统一接口，屏蔽差异、支持本地与网络文件系统；它本身不加快访问速度（2025-28）。

## 考点提醒（易错点）

1. N 只由"块大小 ÷ 地址项长度"决定，与文件大小无关；
2. 最大长度要把**每一级**都算进去，别漏三级间接；
3. 访盘次数：直接 1、一级 2、二级 3；题目说"inode 不在内存"就再 +1；
4. "打开"不等于"读入内容"；权限存在 inode，不在目录项；
5. 硬链接靠引用计数、符号链接靠路径，删除语义完全不同；
6. 插入记录：顺序结构要整体后移（59 次），链接结构只改指针（31 次）。

> **真题考情**：**14/18 年（选 18 + 大 6）**：选 2009-28·30·31、2010-30·31、2013-23·24·26、2014-29、2015-29、2017-26·31、2020-23·24·31、2023-31、2025-28·29；
> 大 2011-46、2012-46、2014-46、2018-46、2022-45、2026-46。
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
