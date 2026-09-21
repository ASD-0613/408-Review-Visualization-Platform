'use strict';
/* ============================================================================
 * cache.js —— 【计算机组成原理】Cache 直接映射（Direct Mapping）
 * ----------------------------------------------------------------------------
 * 快照设计（每访问一个地址产生一帧，另加一帧初始状态）：
 *   { type:'init'|'hit'|'cold'|'conflict',
 *     addr        本次访问的主存地址（十进制）
 *     block       主存块号 = addr >> offsetBits
 *     index       映射到的 Cache 行号 = block mod L
 *     tag         标记 = block >> indexBits
 *     evicted     conflict 时被替换的旧行内容 {valid,tag,block}
 *     lines       全部 Cache 行的当前内容 [{valid,tag,block}|null...]
 *     hits/misses/cold/conflict/accesses  累计统计 }
 * 地址划分：tagBits(琥珀) | indexBits(绿) | offsetBits(蓝)，格子颜色即三段划分。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-cache-direct',
  mode: 'stepper',
  title: 'Cache 直接映射（Direct Mapping）',

  theory: `
> **为什么要有它**：CPU 与主存有约百倍的速度鸿沟，Cache 靠**局部性原理**（时间 + 空间）把常用的主存块副本放到近处，让**平均访存时间**接近 Cache 的速度。
> **怎么实现**：直接映射——每个主存块只能进**唯一确定**的一行：**行号 = 主存块号 mod 行数**；地址随之被切成 Tag / 行号 / 块内偏移三段。
> **记住什么**：**三段地址位数的划分**（本考点核心）+ 命中判定（有效位 = 1 且 Tag 相同）+ 直接映射的**冲突抖动**。

## 地址划分（考试核心）
| 字段 | 位数 | 作用 |
| --- | --- | --- |
| 块内偏移 Offset | log₂(块大小) | 块内寻址具体字节 |
| 行号 Index | log₂(行数) | 直接指出映射到哪一行 |
| 标记 Tag | 其余高位 | 判断该行装的是不是要找的块 |

## 访问判命中
1. 由地址取出 Index，定位到 Cache 行；
2. 该行**有效位 = 1** 且 **Tag 与地址的 Tag 相同** → **命中**，直接读 Cache；
3. 否则**缺失**：把主存块调入该行——有效位为 0 是**冷（强制）缺失**，有效位为 1 但 Tag 不同是**冲突缺失**（旧块被无条件替换）。

## 考点提醒（易错点）
1. 已知地址位数、行数、块大小 → **划分三段位数并算出 Tag / Index / Offset 的值**，是本考点的必考题；
2. **命中率 = 命中次数 ÷ 访问总次数**；注意区分强制缺失与冲突缺失；
3. 缺点是不灵活：两个频繁交替访问的块若映射到**同一行**，会互相踢出（**抖动 / Thrashing**）——这正是全相联、组相联要解决的问题；
4. 好处是硬件极简、**无需替换算法**，容量计算也**不必加 LRU 位**（只要有效位）。

> **真题考情**：**8/18 年（选 7 + 大题 1）**：选 2009-21、2014-16、2015-15、2016-15、2017-14、2021-16、2024-16；
> 大 2010-44。Cache 整体（含组相联）**17/18 年、大题 8 道**。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'addrs', label: '主存地址访问序列', wide: true,
      default: '0, 8, 24, 16, 132, 4, 40, 8',
      ph: '例：0, 4, 8 或 0x0C, 132', help: '支持十进制 / 0x 十六进制，逗号或空格分隔，最多 20 个',
    },
    { key: 'lines', label: 'Cache 行数', type: 'select', default: 8, options: [4, 8, 16].map(v => ({ v, t: `${v} 行` })) },
    { key: 'bsize', label: '块大小（字节）', type: 'select', default: 16, options: [4, 8, 16].map(v => ({ v, t: `${v} B` })) },
    { key: 'bits', label: '主存地址位数', type: 'select', default: 12, options: [8, 12, 16].map(v => ({ v, t: `${v} 位` })) },
  ],

  quickActions: [
    {
      label: '🎲 随机序列（含冲突）', run(rt) {
        const B = parseInt(rt.inputEls.bsize.value, 10);
        const seq = [];
        let blk = RC408.util.rnd(0, 3);
        for (let i = 0; i < 10; i++) {
          // 40% 概率复用/相邻块（制造命中与冲突），否则随机新块
          if (Math.random() < 0.4 && seq.length) blk = seq[seq.length - 1].blk + (Math.random() < 0.5 ? 0 : 8);
          else blk = RC408.util.rnd(0, 15);
          seq.push({ blk, addr: blk * B + RC408.util.rnd(0, B - 1) });
        }
        rt.setInput('addrs', seq.map(x => x.addr).join(', '));
        rt.load();
      },
    },
    { label: '抖动示例', run(rt) { rt.setInput('addrs', '0, 128, 0, 128, 0, 128'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const L = parseInt(vals.lines, 10), B = parseInt(vals.bsize, 10), bits = parseInt(vals.bits, 10);
    const offsetBits = Math.log2(B), indexBits = Math.log2(L);
    if (![4, 8, 16].includes(L) || ![4, 8, 16].includes(B)) throw { message: '行数与块大小须为 4 / 8 / 16' };
    const tagBits = bits - offsetBits - indexBits;
    if (tagBits < 1) {
      throw { message: `地址位数不足：偏移 ${offsetBits} 位 + 行号 ${indexBits} 位已占满 ${bits} 位，标记位至少需要 1 位（请增大地址位数）` };
    }
    const maxAddr = Math.pow(2, bits) - 1;
    const tokens = vals.addrs.split(/[^0-9a-fA-FxX]+/).filter(Boolean);
    if (!tokens.length) throw { message: '请输入地址序列，如 0, 8, 24' };
    if (tokens.length > 20) throw { message: '地址序列最长 20 个（便于展示）' };
    const addrs = tokens.map((tk, i) => {
      const v = /^0x/i.test(tk) ? parseInt(tk, 16) : parseInt(tk, 10);
      if (!Number.isFinite(v) || v < 0) throw { message: `第 ${i + 1} 个地址「${tk}」无效` };
      if (v > maxAddr) throw { message: `地址 ${tk} 超出 ${bits} 位地址空间上限（${maxAddr}）` };
      return v;
    });
    return { L, B, bits, offsetBits, indexBits, tagBits, addrs };
  },

  /* ---------------- ② 纯算法：逐地址访问产出快照 ---------------- */
  buildSnapshots(model) {
    const { L, B, offsetBits, indexBits, tagBits, addrs, bits } = model;
    let lines = Array.from({ length: L }, () => ({ valid: 0, tag: null, block: null }));
    let hits = 0, cold = 0, conflict = 0;

    const snaps = [{
      type: 'init', addr: null, block: null, index: null, tag: null, evicted: null,
      lines: lines.map(l => ({ ...l })), hits: 0, misses: 0, cold: 0, conflict: 0, accesses: 0,
      log: `就绪：Cache ${L} 行 × 块大小 ${B}B，地址 ${bits} 位 = 标记 ${tagBits} | 行号 ${indexBits} | 偏移 ${offsetBits}。映射规则：主存块号 mod ${L} = 行号。`,
      logType: 'info',
      desc: '点击「单步执行」逐个访问地址；三色格子 = Tag / Index / Offset 三段划分',
    }];

    addrs.forEach((addr, t) => {
      const block = addr >> offsetBits;          // 主存块号
      const index = block & (L - 1);             // 行号（L 为 2 的幂 → 取模即取低位）
      const tag = block >> indexBits;            // 标记
      const line = lines[index];
      let hit = false, evicted = null, log, logType, type;

      if (line.valid && line.tag === tag) {
        /* ---- 命中 ---- */
        hit = true; hits++;
        type = 'hit';
        log = `访问 ${_caHex(addr, bits)}（十进制 ${addr}）→ 块号 ${block} → 行 ${index}，有效位=1 且 Tag=${tag} 匹配 → 命中 ✓`;
        logType = 'success';
      } else if (line.valid) {
        /* ---- 冲突缺失：旧块被替换 ---- */
        evicted = { ...line }; conflict++;
        line.valid = 1; line.tag = tag; line.block = block;
        type = 'conflict';
        log = `访问 ${_caHex(addr, bits)}（十进制 ${addr}）→ 块号 ${block} → 行 ${index}，Tag=${tag} ≠ 旧 Tag=${evicted.tag} → 冲突缺失 ✘ 旧块 ${evicted.block} 被替换，装入新块`;
        logType = 'error';
      } else {
        /* ---- 强制（冷启动）缺失 ---- */
        cold++;
        line.valid = 1; line.tag = tag; line.block = block;
        type = 'cold';
        log = `访问 ${_caHex(addr, bits)}（十进制 ${addr}）→ 块号 ${block} → 行 ${index}，该行为空 → 强制缺失，装入主存块 ${block}（Tag=${tag}）`;
        logType = 'warn';
      }

      snaps.push({
        type, addr, block, index, tag, evicted,
        lines: lines.map(l => ({ ...l })),
        hits, misses: cold + conflict, cold, conflict, accesses: t + 1,
        log, logType,
        desc: hit
          ? `地址 ${addr} 命中于行 ${index}（Tag 相同）`
          : type === 'conflict'
            ? `地址 ${addr} 与旧块冲突于行 ${index} → 旧块闪烁被替换`
            : `地址 ${addr} 首次访问 → 装入行 ${index}`,
      });
    });

    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const { L, B, bits, offsetBits, indexBits, tagBits } = model;
    const hasAddr = s.addr !== null;

    /* ---- ① 地址划分格子（Tag/Index/Offset 三段） ---- */
    const seg = (from, to, cls) => {                 // [from, to) 段的位格子（0 = 最高位）
      let html = '';
      for (let p = from; p < to; p++) {
        const v = hasAddr ? (s.addr >> (bits - 1 - p)) & 1 : '·';
        html += `<div class="bit-cell ${cls}" title="第 ${p + 1} 位（从最高位起）">${v}</div>`;
      }
      return html;
    };
    const addrGrid = hasAddr ? `
      <div class="flex gap-2 flex-wrap justify-center items-start">
        <div class="flex flex-col items-center gap-1.5">
          <div class="flex gap-1">${seg(0, tagBits, 'bit-tag')}</div>
          <div class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">标记 Tag（${tagBits} 位）= ${s.tag}</div>
        </div>
        <div class="flex flex-col items-center gap-1.5">
          <div class="flex gap-1">${seg(tagBits, tagBits + indexBits, 'bit-idx')}</div>
          <div class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">行号 Index（${indexBits} 位）= ${s.index}</div>
        </div>
        <div class="flex flex-col items-center gap-1.5">
          <div class="flex gap-1">${seg(tagBits + indexBits, bits, 'bit-off')}</div>
          <div class="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">块内偏移 Offset（${offsetBits} 位）</div>
        </div>
      </div>
      <p class="text-[11px] text-slate-400 mt-2 text-center font-mono">地址 ${_caHex(s.addr, bits)} = ${U.bin(s.addr, bits)}（十进制 ${s.addr}）</p>`
      : `<p class="text-sm text-slate-400 text-center py-4">单步执行后，这里将展示当前地址的 Tag / Index / Offset 三段划分</p>`;

    /* ---- ② 映射公式 ---- */
    const formula = hasAddr ? `
      <div class="flex flex-wrap gap-1.5 items-center">
        <span class="chip" style="border-color:#f59e0b;color:#b45309;background:#fffbeb">主存块号 = ⌊${s.addr} / ${B}⌋ = ${s.block}</span>
        <span class="text-slate-400">→</span>
        <span class="chip" style="border-color:#10b981;color:#047857;background:#ecfdf5">Cache 行号 = ${s.block} mod ${L} = ${s.index}</span>
        <span class="text-slate-400">→</span>
        <span class="chip" style="border-color:#d97706;color:#92400e;background:#fffbeb">Tag = ${s.block} div ${L} = ${s.tag}</span>
      </div>` : '<span class="text-xs text-slate-400">等待访问…</span>';

    /* ---- ③ Cache 行状态表 ---- */
    const snaps = RC408.Runner.snaps;
    const rows = s.lines.map((ln, i) => {
      const isCur = hasAddr && i === s.index;
      let status = '<span class="text-slate-300">—</span>';
      let rowCls = '', tagCell = ln.valid ? String(ln.tag) : '<span class="text-slate-300">—</span>';

      if (isCur) {
        if (s.type === 'hit') {
          rowCls = 'row-hit';
          status = '<b style="color:#059669">命中 ✓</b>';
        } else if (s.type === 'conflict') {
          rowCls = 'row-cur';
          status = `<b style="color:#e11d48">旧块 ${s.evicted.block} 被替换</b>`;
          tagCell = `<span style="position:relative" class="inline-block"><span class="ghost anim-ghost-out">${s.evicted.tag}</span><span class="anim-slide-in">${s.tag}</span></span>`;
        } else {
          rowCls = 'row-cur';
          status = '<b style="color:#b45309">新装入 ▲</b>';
        }
      } else if (ln.valid) {
        status = '<span class="text-slate-400">占用</span>';
      } else {
        status = '<span class="text-slate-300">空闲</span>';
      }

      return `<tr class="${rowCls}">
        <td class="${isCur ? 'col-cur' : ''} font-bold">行 ${i}</td>
        <td class="${isCur ? 'col-cur' : ''}">${ln.valid ? '<b style="color:#059669">1 ✓</b>' : '<span style="color:#cbd5e1">0</span>'}</td>
        <td class="${isCur ? 'col-cur' : ''} font-mono font-bold">${tagCell}</td>
        <td class="${isCur ? 'col-cur' : ''} font-mono">${ln.valid ? '块 ' + ln.block : '<span class="text-slate-300">—</span>'}</td>
        <td class="${isCur ? 'col-cur' : ''}">${status}</td>
      </tr>`;
    }).join('');

    const tableHtml = `
      <div>
        ${RC408.ui.sectionTitle('Cache 行状态（直接映射：每块只能进固定的一行）')}
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="tbl w-full">
            <thead><tr><th>行号</th><th>有效位</th><th>标记 Tag</th><th>缓存的主存块</th><th>本行状态</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    /* ---- ④ 访问序列徽片 ---- */
    const seqHtml = model.addrs.map((a, j) => {
      let cls = 'chip-future';
      if (j < s.accesses && snaps[j + 1]) cls = snaps[j + 1].type === 'hit' ? 'chip-hit' : 'chip-fault';
      if (j === s.accesses - 1 && hasAddr) cls += ' chip-cur';
      return RC408.ui.chip(a, cls, `地址 ${a}（块 ${a >> offsetBits} → 行 ${(a >> offsetBits) & (L - 1)}）`);
    }).join('');

    /* ---- ⑤ 统计 ---- */
    const rate = s.accesses ? s.hits / s.accesses : 0;
    const stats =
      RC408.ui.statCard('访问进度', `${s.accesses} / ${model.addrs.length}`, '已处理地址数') +
      RC408.ui.statCard('命中', s.hits, '有效位=1 且 Tag 相同', 'text-emerald-600') +
      RC408.ui.statCard('缺失', s.misses, `强制 ${s.cold} + 冲突 ${s.conflict}`, 'text-rose-600') +
      RC408.ui.statCard('命中率', U.pct(rate), '命中 ÷ 总访问', rate >= 0.5 ? 'text-indigo-600' : 'text-rose-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('主存地址划分（琥珀 = Tag，绿 = Index，蓝 = Offset）')}
          ${addrGrid}
        </div>

        <div>${RC408.ui.sectionTitle('映射过程')}${formula}</div>

        ${tableHtml}

        <div>
          ${RC408.ui.sectionTitle('访问序列（红 = 缺失，绿 = 命中，描边 = 当前）')}
          <div class="flex flex-wrap gap-1.5">${seqHtml}</div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#d97706', '标记 Tag 位段')}
          ${RC408.ui.legend('#059669', '行号 Index 位段')}
          ${RC408.ui.legend('#2563eb', '块内偏移 Offset 位段')}
          ${RC408.ui.legend('#e11d48', '冲突缺失（旧块被替换）')}
        </div>
      </div>`;
  },
});

/* ---- 模块内部工具（前缀 ca 防止全局冲突） ---- */
/** 十六进制展示：0x1C */
function _caHex(v, bits) {
  return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
}
