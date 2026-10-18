'use strict';
/* ============================================================================
 * vm.js —— 【操作系统】页式虚拟内存 · 地址转换（请求分页 + 快表 TLB）
 * ----------------------------------------------------------------------------
 * 快照设计：每次逻辑地址访问拆成 3~5 帧（另加 init / done）：
 *   { stage:'init'|'split'|'tlb'|'pt'|'fault'|'phys'|'done',
 *     addr / pageNo / offset   逻辑地址及其拆分
 *     hitTlb / tlbIdx          本轮是否 TLB 命中（及命中行下标）
 *     victimPage/victimFrame   缺页时被 LRU 淘汰的页 / 腾出的帧
 *     frameNo / phys           最终帧号与物理地址
 *     pt / tlb / tlbOrd / frames  页表 / 快表 / 快表LRU序 / 主存帧 的整体状态
 *     accesses / tlbHits / ptHits / faults        累计统计 }
 * 演示链路：逻辑地址 → 拆分 → 查TLB →(未命中)→ 查页表 →(缺页)→ 调入 → 物理地址
 * ========================================================================== */

/* 进程固定 16 页（页号 4 位）；页大小决定偏移位数与逻辑地址总位数 */
const _VM_PAGES = 16;
const _VM_OFFSET_BITS = { 512: 9, 1024: 10 };   // 页大小 → 偏移位数
const _VM_TLB_CAP = 4;                          // 快表容量（全相联，LRU 淘汰）

RC408.registerModule({
  id: 'os-vm-paging',
  mode: 'stepper',
  title: '页式虚拟内存 · 地址转换（快表 + 缺页处理）',

  theory: `
> **为什么要有它**：程序比主存大也要能跑——只把**部分页**装入内存，其余留在磁盘，访问不到再按需调入，逻辑地址空间就可以远大于物理内存。
> **怎么实现**：把逻辑地址切成"页号 p + 页内偏移 d"，先查快表 TLB、再查页表；页表太大就分级成"页目录 → 页表"；缺页由缺页中断调入。
> **记住什么**：一次访问的完整链路 + 分页/分段/段页式的位段划分 + 多级页表用"多一次访存"换到了什么。

## 虚拟内存的前提与实现方式

- **前提**：**离散分配**是基础（连续分配做不到"只装一部分"）；**局部性原理**保证缺页不会太频繁；还需要**对换区**存放换出的页。
- **三种实现**：**请求分页**（以页为单位）、**请求分段**（以段为单位）、**请求段页式**（先分段、段内再分页）。
- **容量**：虚拟内存的**最大容量由 CPU 的寻址范围决定**，既不等于内存容量，也不受外存容量限制（2012-25）；实际可用容量还受对换区大小约束。

## 一次地址访问的完整链路

\`\`\`text
逻辑地址 ──拆分──▶ 页号 p + 页内偏移 d
        ├─▶ 查快表 TLB ──命中──▶ 页框号 f ──────────────┐
        └─未命中─▶ 查页表 ─┬─ 存在位=1：页框号 f ────────┤
                            └─ 存在位=0：缺页中断
                                  → 从磁盘调入该页
                                  → 无空闲页框则按置换算法淘汰一页
                                  → 修改页表 ────────────┘
页框号 f 拼上页内偏移 d = 物理地址，访问主存
\`\`\`

## 位段划分与页表大小（计算题的骨架）

- 页大小 2 的 k 次方字节 ⟹ 页内偏移 k 位；逻辑地址位数 − k = 页号位数。
- **页表项数 = 2 的页号位数次方**；**页表占用空间 = 页表项数 × 每项字节数**。
- 例：页 4KB、逻辑地址 32 位、页表项 4B ⟹ 页号 20 位、页表项 2 的 20 次方个 ⟹ 页表 2 的 20 次方 × 4B = **4MB**（2013-46）。
- 页表项里存**页框号**与若干控制位（存在位、访问位、修改位、保护位）；快表项里的标记是**虚页号**。
- 页表基址寄存器（PTBR，多级时是页目录基址寄存器 PDBR）存页表的**物理基址**：**进程切换要刷新，同一进程的线程切换不用**（2018-45）。

## 多级页表：省的是"连续的页表空间"

- 一级页表 4MB 必须连续，拆成"**页目录（1024 项）+ 二级页表（每张 1024 项）**"后，二级页表可以离散存放、按需调入。
- 4KB 页、32 位地址时的位段：**页目录号 10 位 + 页表索引 10 位 + 页内偏移 12 位**；页目录号 = 逻辑地址右移 22 位，页表索引 =（逻辑地址右移 12 位）取低 10 位（2013-46）。
- **代价**：多一次访存；**收益**：页表占用的**连续**空间变小、不必把整张页表都放进内存。
- 它**不加快**地址变换、**不减少**缺页次数、**不减少**页表项总字节数——2014-32 考的就是这三个"不"。
- 两级页表的占用按"页目录 1 页 + 每张页表 1 页"逐级数（2015-46）；两个逻辑地址的页目录号相同 ⟹ 命中同一张二级页表。

## 分段与段页式

- 段式逻辑地址 = **段号 s + 段内偏移 w**；段表项 = **段长 + 段基址**。
- 地址变换要**两次越界检查**：段号 ≥ 段表长度（越界）、段内偏移 ≥ 该段段长（越界），都通过才做"基址 + 偏移"（2016-28）。
- **最大段长由偏移位数决定**：段号 8 位、地址 32 位 ⟹ 偏移 24 位 ⟹ 最大段长 2 的 24 次方字节（2009-27）。
- 分段按**逻辑模块**划分，便于共享与保护、有外部碎片；分页按**固定大小**划分，便于分配、只有内部碎片；段页式先分段、段内再分页，兼取两者。

## 快表 TLB 与有效访问时间

| 情形 | 还要访存几次 | 单次访问时间 |
| --- | --- | --- |
| TLB 命中 | 1 次（只取数据） | 查快表 t + 访存 m |
| TLB 未命中、页在内存 | 2 次（先查页表再取数据） | t + 2m |
| 缺页 | 另加缺页处理（含磁盘 I/O） | 上两者再加缺页开销 |

- 有效访问时间 EAT = 命中率 × (t + m) + (1 − 命中率) × (t + 2m)；再按缺页率加上"缺页率 × 缺页处理时间"。
- 快表是**页表项的缓存**，不是页表的替代：命中省一次访存，未命中仍要查页表。
- 综合题数 TLB 访问次数要算**缺页处理完重新执行指令**的那一次：访问数组 1000 次、首次缺页多查一次 ⟹ 1001 次（2014-45）。

## 缺页处理与页框分配

- 缺页处理五步：**保护现场 → 分配页框（没有空闲框就按置换算法淘汰一页，脏页先写回）→ 从磁盘调入 → 修改页表的存在位与页框号 → 恢复现场、重新执行被中断的指令**（2011-28）。
- **有空闲页框时不需要淘汰**，只把页调入并改存在位——2022-29 的错项就是"一定要淘汰一页"。
- 缺页是**访存时**由硬件发现、陷入内核处理的，与"地址越界"是两回事（2013-30）。
- 驻留集 = 当前分配给进程的页框集合；**固定分配**下页框数不变，因此**不能**做全局置换（2015-30）；可变分配才允许按缺页情况增减。
- **最少页框数由指令的寻址方式决定**（一条指令可能跨页、间接寻址还要多一页），代码段长度与地址空间大小只是影响因素（2025-27）。
- 被淘汰的页框先挂到**空闲页框链**；被重新访问的页可以从链表中取回驻留集（2012-45）。

## 考点提醒（易错点）

1. 先定"页大小 → 偏移位数"再切地址；十六进制地址直接按位切最快；
2. TLB 命中不查页表，未命中要查；两种 EAT 口径别混；
3. 多级页表只省"连续空间"，三个"不"要记牢；
4. 分段是两次越界检查、段表项含段长；分页只有页号越界；
5. 虚拟内存容量由 CPU 寻址范围决定，不是"内存 + 外存"随便加；
6. 缺页处理"有空闲就不淘汰"，脏页换出前要写回。

> **真题考情**：**18/18 年（选 19 + 大 13）**：大 2009-46、2010-46、2012-45、2013-46、2014-45、2015-46、2016-45、2017-45、2018-44、2020-46、2021-44、2024-45、2025-46；
> 选 2009-27、2010-29、2011-28、2012-25、2013-30、2014-28·32、2015-30、2016-28、2019-28·31、2021-29、2022-15、2023-28·30、2025-27、2026-24·28·30。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'addrs', label: '逻辑地址访问序列（十进制或 0x 十六进制）', type: 'textarea', rows: 2, wide: true,
      default: '0x0050, 0x0400, 0x0830, 0x0C48, 0x1040, 0x0054, 0x0058, 0x0410, 0x0834, 0x1404, 0x0C50',
      help: `进程共 ${_VM_PAGES} 页；最多 12 个地址`,
    },
    { key: 'pagesize', label: '页大小', type: 'select', default: 1024, options: [{ v: 512, t: '512 B（偏移 9 位）' }, { v: 1024, t: '1 KB（偏移 10 位）' }] },
    { key: 'frames', label: '主存帧数（物理块数）', type: 'select', default: 5, options: [3, 4, 5, 6].map(v => ({ v, t: `${v} 帧` })) },
  ],

  quickActions: [
    {
      label: '🎲 随机序列', run(rt) {
        const ps = parseInt(rt.inputEls.pagesize.value, 10);
        const maxAddr = _VM_PAGES * ps - 1;
        const seq = [];
        let last = RC408.util.rnd(0, 5);
        for (let i = 0; i < 10; i++) {
          // 40% 概率重复/邻近页（制造 TLB 命中），否则随机新页
          const page = Math.random() < 0.4 ? Math.min(_VM_PAGES - 1, Math.max(0, last + RC408.util.rnd(-1, 1))) : RC408.util.rnd(0, _VM_PAGES - 1);
          last = page;
          seq.push(page * ps + RC408.util.rnd(0, ps - 1));
        }
        rt.setInput('addrs', seq.map(a => '0x' + a.toString(16).toUpperCase().padStart(4, '0')).join(', '));
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const ps = parseInt(vals.pagesize, 10);
    const F = parseInt(vals.frames, 10);
    const offsetBits = _VM_OFFSET_BITS[ps];
    if (!offsetBits) throw { message: '页大小无效' };
    const addrBits = 4 + offsetBits;                       // 页号 4 位 + 偏移
    const maxAddr = _VM_PAGES * ps - 1;
    const tokens = vals.addrs.split(/[^0-9a-fA-FxX]+/).filter(Boolean);
    if (!tokens.length) throw { message: '请输入逻辑地址序列' };
    if (tokens.length > 12) throw { message: '地址序列最长 12 个（便于展示）' };
    const addrs = tokens.map((tk, i) => {
      const v = /^0x/i.test(tk) ? parseInt(tk, 16) : parseInt(tk, 10);
      if (!Number.isFinite(v) || v < 0) throw { message: `第 ${i + 1} 个地址「${tk}」无效` };
      if (v > maxAddr) throw { message: `地址 ${tk} 超出逻辑地址空间（${_VM_PAGES} 页 × ${ps}B = 上限 ${maxAddr}）` };
      return v;
    });
    return { ps, F, offsetBits, addrBits, frameBits: Math.ceil(Math.log2(F)), addrs };
  },

  /* ---------------- ② 纯算法：地址转换全链路快照 ---------------- */
  buildSnapshots(model) {
    const { ps, F, addrs } = model;
    let pt = Array.from({ length: _VM_PAGES }, () => ({ valid: 0, frame: null, last: -1 }));  // 页表
    let frames = Array(F).fill(null);                                                          // 帧号 → 页号
    let tlb = [];                                                                              // 快表 [{page,frame}]
    let tlbOrd = [];                                                                           // 快表 LRU 序（前端最旧）
    let clock = 0;
    let stats = { accesses: 0, tlbHits: 0, ptHits: 0, faults: 0 };
    const snaps = [];
    const state = () => ({ pt: pt.map(e => ({ ...e })), tlb: tlb.map(e => ({ ...e })), tlbOrd: [...tlbOrd], frames: [...frames], ...{ accesses: stats.accesses, tlbHits: stats.tlbHits, ptHits: stats.ptHits, faults: stats.faults } });
    const push = (o) => snaps.push(o);

    push({
      stage: 'init', ...state(), addr: null, pageNo: null, offset: null,
      hitTlb: null, tlbIdx: -1, frameNo: null, phys: null,
      log: `就绪：进程 ${_VM_PAGES} 页，页大小 ${ps}B，主存 ${F} 帧，快表 ${_VM_TLB_CAP} 项（LRU）。将逐个访问 ${addrs.length} 个逻辑地址。`,
      logType: 'info',
      desc: '点击「单步执行」：观察 逻辑地址 → TLB → 页表 →（缺页处理）→ 物理地址 的完整链路',
    });

    addrs.forEach((addr, t) => {
      clock++; stats.accesses = t + 1;
      const pageNo = addr >> model.offsetBits;
      const offset = addr & (ps - 1);

      /* 帧 1：地址拆分 */
      push({
        stage: 'split', ...state(), addr, pageNo, offset,
        hitTlb: null, frameNo: null, phys: null,
        log: `第 ${t + 1} 次访问：逻辑地址 ${_vmHex(addr)} = ${RC408.util.bin(addr, model.addrBits)} → 页号 ${pageNo}（高 4 位），页内偏移 ${offset}（低 ${model.offsetBits} 位）`,
        logType: 'info',
        desc: `逻辑地址拆分：页号 p = ${pageNo}，页内偏移 d = ${offset}`,
      });

      /* 帧 2：查快表 */
      const tlbIdx = tlb.findIndex(e => e.page === pageNo);
      const hitTlb = tlbIdx >= 0;
      if (hitTlb) {
        stats.tlbHits++;
        tlbOrd = [...tlbOrd.filter(p => p !== pageNo), pageNo];   // 命中也要更新 LRU
        pt[pageNo].last = clock;
        push({
          stage: 'tlb', ...state(), addr, pageNo, offset, hitTlb, tlbIdx, frameNo: null, phys: null,
          log: `查快表：命中 ✓ 页 ${pageNo} → 帧号 ${tlb[tlbIdx].frame}，免去查页表的访存（快表命中率高是系统高效的关键）`,
          logType: 'success',
          desc: `TLB 命中！直接得到帧号 ${tlb[tlbIdx].frame}，跳过页表查询`,
        });
      } else {
        push({
          stage: 'tlb', ...state(), addr, pageNo, offset, hitTlb: false, tlbIdx: -1, frameNo: null, phys: null,
          log: `查快表：未命中 ✘（页 ${pageNo} 不在 TLB 中）→ 只能去内存查页表，多花一次访存`,
          logType: 'warn',
          desc: `TLB 未命中 → 需要访问内存中的页表`,
        });

        /* 帧 3：查页表（仅未命中时） */
        const entry = pt[pageNo];
        if (entry.valid) {
          stats.ptHits++;
          pt[pageNo].last = clock;
          tlbOrd = [...tlbOrd.filter(p => p !== pageNo), pageNo];
          push({
            stage: 'pt', ...state(), addr, pageNo, offset, hitTlb: false, ptHit: true, frameNo: null, phys: null,
            log: `查页表：页 ${pageNo} 状态位 = 1，已在主存（帧 ${entry.frame}）✓ —— 同时把该页表项装入 TLB 备用`,
            logType: 'info',
            desc: `页表命中：页 ${pageNo} 在主存帧 ${entry.frame}，无需调页`,
          });
        } else {
          /* ---- 缺页中断 + 调页（必要时 LRU 置换） ---- */
          stats.faults++;
          let victimPage = null;
          let victimFrame = frames.indexOf(null);   // 有空闲帧则直接分配
          if (victimFrame < 0) {
            let minLast = Infinity;
            frames.forEach((p, f) => { if (pt[p].last < minLast) { minLast = pt[p].last; victimPage = p; victimFrame = f; } });
            pt[victimPage] = { valid: 0, frame: null, last: pt[victimPage].last };   // 淘汰：状态位清零
          }
          pt[pageNo] = { valid: 1, frame: victimFrame, last: clock };
          frames[victimFrame] = pageNo;
          push({
            stage: 'fault', ...state(), addr, pageNo, offset, hitTlb: false, ptHit: false,
            victimPage, victimFrame, frameNo: victimFrame, phys: null,
            log: `查页表：页 ${pageNo} 状态位 = 0 → 缺页中断！` +
              (victimPage !== null
                ? `主存已满，按 LRU 淘汰「最久未访问」的页 ${victimPage}（帧 ${victimFrame}），调入页 ${pageNo} 并更新页表`
                : `尚有空闲帧 ${victimFrame}，直接从磁盘调入页 ${pageNo} 并更新页表`),
            logType: 'error',
            desc: victimPage !== null
              ? `缺页 + 置换：页 ${victimPage} 被换出（帧 ${victimFrame}），页 ${pageNo} 换入`
              : `缺页：页 ${pageNo} 装入空闲帧 ${victimFrame}`,
          });
        }

        /* 更新快表（容量 4，LRU 淘汰；页表查到的项装入 TLB） */
        if (tlb.length >= _VM_TLB_CAP) {
          const ev = tlbOrd.shift();
          tlb = tlb.filter(e => e.page !== ev);
        }
        tlb = [...tlb.filter(e => e.page !== pageNo), { page: pageNo, frame: pt[pageNo].frame }];
        tlbOrd = [...tlbOrd.filter(p => p !== pageNo), pageNo];
      }

      /* 帧 4：形成物理地址，访问主存 */
      const frameNo = (hitTlb ? tlb.find(e => e.page === pageNo).frame : pt[pageNo].frame);
      const phys = frameNo * ps + offset;
      push({
        stage: 'phys', ...state(), addr, pageNo, offset, hitTlb, frameNo, phys,
        log: `合成物理地址 = 帧号 ${frameNo} × ${ps} + 偏移 ${offset} = ${phys}（${_vmHex(phys)}）→ 访问主存帧 ${frameNo} ✓`,
        logType: 'success',
        desc: `物理地址 ${_vmHex(phys)}（十进制 ${phys}）：帧号 ${frameNo} 拼上页内偏移 ${offset}`,
      });
    });

    push({
      stage: 'done', ...state(), addr: null, pageNo: null, offset: null, hitTlb: null, frameNo: null, phys: null,
      log: `演示完成：共 ${stats.accesses} 次访问 —— TLB 命中 ${stats.tlbHits} 次，页表命中 ${stats.ptHits} 次，缺页 ${stats.faults} 次（TLB 命中率 ${RC408.util.pct(stats.tlbHits / stats.accesses)}，缺页率 ${RC408.util.pct(stats.faults / stats.accesses)}）`,
      logType: 'success',
      desc: '完成！回顾五个阶段：拆分 → 查TLB → 查页表 → 缺页处理 → 形成物理地址',
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const { ps, F, offsetBits, addrBits, frameBits } = model;
    const isInit = s.stage === 'init', isDone = s.stage === 'done';

    /* 五阶段流程指示条 */
    const stepIdx = { split: 0, tlb: 1, pt: 2, fault: 3, phys: 4 }[s.stage];
    const flowHtml = ['① 地址拆分', '② 查快表 TLB', '③ 查页表', '④ 缺页处理', '⑤ 形成物理地址']
      .map((t, i) => `<span class="chip ${i === stepIdx ? 'chip-check chip-cur' : i < stepIdx ? 'chip-mst' : 'chip-future'}">${t}${i === 3 && !isInit && !isDone ? '' : ''}</span>`)
      .join('<span class="text-slate-300 self-center">→</span>');

    /* 地址拆分 / 物理地址 的位格子（value 为空时显示占位 ·） */
    const bitRow = (prefixBits, prefixCls, total, value) => {
      let html = '';
      for (let p = 0; p < total; p++) {
        const inPrefix = p < prefixBits;
        const v = value === null ? '·' : (value >> (total - 1 - p)) & 1;
        html += `<div class="bit-cell ${inPrefix ? prefixCls : 'bit-host'}" title="第 ${p + 1} 位">${v}</div>`;
      }
      return html;
    };
    const splitCard = `
      <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
        ${RC408.ui.sectionTitle('逻辑地址拆分（琥珀 = 页号 4 位，蓝 = 页内偏移）')}
        <div class="flex gap-1 flex-wrap justify-center">${bitRow(4, 'bit-tag', addrBits, isInit || isDone ? null : s.addr)}</div>
        <p class="text-[11px] text-slate-400 mt-2 text-center font-mono">
          ${isInit || isDone ? '等待访问…' : `逻辑地址 ${_vmHex(s.addr)} = 页号 ${s.pageNo} · 页内偏移 ${s.offset}`}
        </p>
      </div>`;

    /* 快表 TLB */
    const tlbRows = Array.from({ length: _VM_TLB_CAP }, (_, i) => {
      const e = s.tlb[i];
      const hit = s.stage === 'tlb' && s.hitTlb && i === s.tlbIdx;
      return `<tr class="${hit ? 'row-hit' : ''}">
        <td class="${hit ? 'col-cur' : ''}">${e ? `<span class="font-mono font-bold">页 ${e.page}</span>` : '<span class="text-slate-300">空</span>'}</td>
        <td class="${hit ? 'col-cur' : ''} font-mono">${e ? e.frame : '—'}</td>
        <td class="${hit ? 'col-cur' : ''}">${hit ? '<b style="color:#059669">命中 ✓</b>' : e ? '<span class="text-slate-400">占用</span>' : '<span class="text-slate-300">—</span>'}</td>
      </tr>`;
    }).join('');
    const tlbCard = `
      <div>
        ${RC408.ui.sectionTitle(`快表 TLB（容量 ${_VM_TLB_CAP}，相联存储器，LRU 淘汰）`)}
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="tbl w-full"><thead><tr><th>页号</th><th>帧号</th><th>本轮查询</th></tr></thead><tbody>${tlbRows}</tbody></table>
        </div>
        <div class="mt-2 flex flex-wrap gap-1 items-center text-[11px] text-slate-400">
          LRU 序：${s.tlbOrd.length ? s.tlbOrd.map(p => RC408.ui.chip('页' + p, 'chip')).join('<span class="self-center">→</span>') + '<span class="ml-1">（右端 = 最近使用）</span>' : '（空）'}
        </div>
      </div>`;

    /* 页表（16 行，容器限高滚动） */
    const ptRows = s.pt.map((e, p) => {
      const cur = s.pageNo === p && !isInit && !isDone;
      const isFaultRow = s.stage === 'fault' && p === s.pageNo;
      const isVictim = s.stage === 'fault' && p === s.victimPage;
      return `<tr class="${isFaultRow ? 'row-cur' : cur ? 'row-hit' : ''}">
        <td class="font-bold ${cur ? 'col-cur' : ''}">${p}</td>
        <td class="${cur ? 'col-cur' : ''}">${e.valid ? '<b style="color:#059669">1</b>' : '<span style="color:#e11d48">0</span>'}</td>
        <td class="font-mono ${cur ? 'col-cur' : ''}">${e.valid ? e.frame : '<span class="text-slate-300">—</span>'}</td>
        <td class="${cur ? 'col-cur' : ''}">${isVictim ? '<b style="color:#e11d48">被淘汰</b>' : e.last >= 0 ? e.last : '<span class="text-slate-300">—</span>'}</td>
      </tr>`;
    }).join('');
    const ptCard = `
      <div>
        ${RC408.ui.sectionTitle('页表（进程 16 页 → 状态位 / 主存帧号 / 最近访问序）')}
        <div class="overflow-y-auto rounded-xl border border-slate-200" style="max-height:236px">
          <table class="tbl w-full"><thead><tr><th>页号</th><th>状态位</th><th>主存帧号</th><th>最近访问</th></tr></thead><tbody>${ptRows}</tbody></table>
        </div>
      </div>`;

    /* 主存帧 */
    const frameCells = s.frames.map((p, f) => {
      let cls = 'frame-cell', body = p === null ? '—' : `<span class="page-num">${p}</span>`;
      if (s.stage === 'fault' && f === s.victimFrame) {
        cls += ' anim-flash-red';
        body = p === null ? `<span class="page-num anim-slide-in">${s.pageNo}</span>`
          : `<span class="ghost anim-ghost-out">${s.victimPage}</span><span class="page-num anim-slide-in">${s.pageNo}</span>`;
      } else if (s.stage === 'phys' && f === s.frameNo) {
        cls += ' anim-hit';
      }
      return `<div class="flex flex-col items-center gap-1">
        <div class="${cls}">${body}</div>
        <div class="text-[11px] text-slate-400 font-semibold">帧 ${f}</div>
      </div>`;
    }).join('');
    const memCard = `
      <div>
        ${RC408.ui.sectionTitle('主存帧（装入了哪些页；缺页置换时旧页红字上飘）')}
        <div class="flex flex-wrap gap-4 justify-center py-1">${frameCells}</div>
      </div>`;

    /* 物理地址 */
    const physCard = `
      <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
        ${RC408.ui.sectionTitle('物理地址 = 帧号（绿）拼上页内偏移（蓝）')}
        <div class="flex gap-1 flex-wrap justify-center">
          ${bitRow(frameBits, 'bit-idx', frameBits + offsetBits, s.stage === 'phys' ? s.phys : null)}
        </div>
        <p class="text-[11px] text-slate-400 mt-2 text-center font-mono">
          ${s.stage === 'phys' || s.stage === 'fault'
            ? `物理地址 = ${s.frameNo} × ${ps} + ${s.offset} = ${s.phys === null ? '（缺页处理中…）' : _vmHex(s.phys) + '（十进制 ' + s.phys + '）'}`
            : '等待本轮地址转换完成…'}
        </p>
      </div>`;

    /* 统计 */
    const stats =
      RC408.ui.statCard('访问进度', `${s.accesses} / ${model.addrs.length}`, '逻辑地址访问次数') +
      RC408.ui.statCard('TLB 命中', `${s.tlbHits}`, `命中率 ${s.accesses ? U.pct(s.tlbHits / s.accesses) : '—'}`, 'text-emerald-600') +
      RC408.ui.statCard('查页表命中', `${s.ptHits}`, 'TLB 未命中但页已在主存', 'text-indigo-600') +
      RC408.ui.statCard('缺页中断', `${s.faults}`, `缺页率 ${s.accesses ? U.pct(s.faults / s.accesses) : '—'}`, 'text-rose-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="flex flex-wrap gap-1.5 items-center justify-center rounded-xl bg-slate-50 border border-slate-200 p-2.5">
          ${flowHtml}
        </div>

        ${splitCard}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${tlbCard}${ptCard}</div>

        ${memCard}

        ${physCard}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#d97706', '页号字段')}
          ${RC408.ui.legend('#2563eb', '页内偏移字段')}
          ${RC408.ui.legend('#059669', '帧号 / 命中')}
          ${RC408.ui.legend('#e11d48', '缺页 / 被淘汰的页')}
        </div>
      </div>`;
  },
});

/* 十六进制展示（4 位补零） */
function _vmHex(v) {
  return '0x' + v.toString(16).toUpperCase().padStart(4, '0');
}
