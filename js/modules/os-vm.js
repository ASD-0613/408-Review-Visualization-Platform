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
> **真题考情**：18 年中 **13 年**考页式虚拟存储/地址转换（09/10/12/13/14/15/16/17/18/20/22/24/25），其中 **10 次以上为大题**且横跨计组与操作系统两科（二级页表、TLB、缺页综合 Cache 是固定套路）——408 分值最高的单一考点。

## 虚拟内存要解决什么
程序比主存大也能跑：只把**部分页**装入内存，其余留在磁盘上，访问不到时再按需调入——
这就是**请求分页存储管理**（408 分值最高的考点之一）。

## 一次地址访问的完整链路
\`\`\`text
逻辑地址 ──拆分──▶ 页号 p + 页内偏移 d
        ├──▶ 查快表 TLB（相联存储器）──命中──▶ 得到帧号 f ──┐
        └──未命中──▶ 查页表 ──┬── 状态位=1：得帧号 f ──────┤
                              └── 状态位=0：缺页中断！
                                    → 由 OS 从磁盘调入该页
                                    → 内存满则按置换算法（如 LRU）淘汰一页
                                    → 修改页表 ◀──────────────────┘
帧号 f 拼上偏移 d = 物理地址，访问主存
\`\`\`

## 关键机构
| 机构 | 作用 |
| --- | --- |
| 页表 | 页号 → (状态位, 主存帧号)，每个进程一张，存于内存 |
| 快表 TLB | 页表项的高速缓存（相联存储器），命中则**免去查页表的访存** |
| 缺页中断 | 状态位=0 时发出，由缺页中断处理程序完成调入与页表更新 |

## 有效访问时间（考点）
- 命中率 h、查 TLB 时间 t、访存一次时间 m：
  EAT = h×(t+m) + (1−h)×(t + 2m)（未命中要先查页表再访存，缺页时代价更大）；
- TLB 命中率通常可达 90% 以上，是"以小博中"的经典设计（页表在内存，TLB 在 CPU 内）。

## 考点提示
- 给逻辑地址求**页号 / 页内偏移 / 物理地址**：除以页大小取整 / 取余，或直接按二进制切分；
- TLB 是页表的缓存：**TLB 命中 → 不查页表**；TLB 未命中 → 仍需查页表（快表不是页表的替代）；
- 缺页处理流程（中断现场保护 → 调页 → 更新页表 → 重新执行指令）要能完整复述。
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
