'use strict';
/* ============================================================================
 * coa-cache-assoc.js —— 【计算机组成原理】组相联与全相联映射
 * ----------------------------------------------------------------------------
 * 真题考情：本模块 **11/18 年（选 4 + 大题 7）**，**组相联是近年大题的主流形态**
 * （2020-44 8路、2022-16 比较器、2023-43 4路、2025-43 8路）；Cache 整体（含直接映射）17/18 年、大题 8 道，
 * 直接映射见 coa-cache-direct 模块。
 *
 * 快照设计：每次地址访问一帧（另加 init/done）：
 *   { addr, block, setIdx, tag, offset   地址拆分
 *     hit / way                          命中与否及所在路
 *     victim                             替换时被 LRU 淘汰的行
 *     sets                               全部组×路的状态 [{valid,tag,last}]
 *     hits/misses/cold/conflict          累计统计 }
 * 规则：组号 = 主存块号 mod 组数（直接定组）；组内任意路可放；满则组内 LRU 淘汰。
 * 全相联 = 只有一个"组"，组号字段为 0 位。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-cache-assoc',
  mode: 'stepper',
  title: '组相联与全相联映射',

  theory: `
> **为什么要有它**：直接映射不灵活（同一行反复互踢），全相联又要太多比较器——**组相联是两者的折中**：先按直接映射"定组"，再在组内全相联。
> **怎么实现**：**组数 = 总行数 ÷ 路数**，**组号 = 主存块号 mod 组数**（直接定组）；组内任选一路，都满时按 **LRU** 淘汰组内最久未用的行。
> **记住什么**：**路数 = 组内 Tag 比较器个数**（并行比较）+ 地址三段划分 + 总容量要算上**有效位与 LRU 位**。

## 三种映射的统一视角
| 路数 | 组数 | 退化为 | 组号位数 |
| --- | --- | --- | --- |
| 1 | = 总行数 | **直接映射** | log₂(行数) |
| 2 / 4 / 8 … | 总行数 ÷ 路数 | **组相联**（本模块） | log₂(组数) |
| = 总行数 | 1 | **全相联** | 0（Tag = 完整块号） |

## 地址划分与硬件代价
- 地址 = **Tag + 组号 + 块内偏移**；组号位数 = log₂(组数)，**Tag 比直接映射更短**（组内有了选择余地）；
- **比较器**：组内每一路各配一个 Tag 比较器、**并行**比较 → **路数 = 比较器个数**（2022-16 真题）；
- LRU 需要每行附加"最近使用"计数 / 位；**路数越大命中率越高、硬件也越贵**。

## 考点提醒（易错点）
1. "某主存块映射到哪一组"只看 **块号 mod 组数**，与 Tag 无关；
2. 给地址序列推 **LRU 替换过程与最终命中率**（本模块可逐帧练），别漏掉"**命中也要更新最近使用标记**"；
3. 算**总容量**要加上每行的有效位，路数 > 1 时还要加 LRU 位 / 计数位；
4. 近年大题的主流形态是**组相联 + 虚拟存储综合**：地址先经 TLB / 页表翻译，再拆 Cache 三段。

> **真题考情**：**11/18 年（选 4 + 大题 7）**：大 2011-44、2016-45、2018-44、2019-46、2020-44（8 路）、
> 2023-43（4 路）、2025-43（8 路）；选 2009-14、2012-17、2022-16（比较器个数）、2026-18。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'assoc', label: '映射方式（路数）', type: 'select', default: 4,
      options: [{ v: 2, t: '2 路组相联' }, { v: 4, t: '4 路组相联' }, { v: 8, t: '8 路组相联' }, { v: 0, t: '全相联（只有一组）' }],
    },
    { key: 'lines', label: 'Cache 总行数', type: 'select', default: 8, options: [{ v: 8, t: '8 行' }, { v: 16, t: '16 行' }] },
    { key: 'bsize', label: '块大小（字节）', type: 'select', default: 16, options: [{ v: 8, t: '8 B' }, { v: 16, t: '16 B' }, { v: 32, t: '32 B' }] },
    { key: 'bits', label: '主存地址位数', type: 'select', default: 12, options: [{ v: 8, t: '8 位' }, { v: 12, t: '12 位' }, { v: 16, t: '16 位' }] },
    {
      key: 'addrs', label: '主存地址访问序列', type: 'textarea', rows: 2, wide: true,
      default: '0x010, 0x020, 0x030, 0x040, 0x010, 0x050, 0x030',
      help: '十进制或 0x 十六进制，最多 14 个；须小于 2^地址位数',
    },
  ],

  quickActions: [
    { label: '冲突密集示例', run(rt) { rt.setInput('assoc', 2); rt.setInput('addrs', '0, 64, 128, 192, 0, 256, 0'); rt.load(); } },
    { label: '全相联对比示例', run(rt) { rt.setInput('assoc', 0); rt.setInput('addrs', '0, 64, 128, 192, 0, 256, 0'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const assoc = parseInt(vals.assoc, 10);            // 0 表示全相联
    const lines = parseInt(vals.lines, 10);
    const B = parseInt(vals.bsize, 10);
    const bits = parseInt(vals.bits, 10);
    const offsetBits = Math.log2(B);
    const numSets = assoc === 0 ? 1 : lines / assoc;
    const setBits = assoc === 0 ? 0 : Math.log2(numSets);
    const ways = assoc === 0 ? lines : assoc;
    const tagBits = bits - setBits - offsetBits;
    if (tagBits < 1) throw { message: `地址位数不足：偏移 ${offsetBits} 位 + 组号 ${setBits} 位之后标记位不足 1 位，请增大地址位数或减少组数` };
    const maxAddr = Math.pow(2, bits) - 1;
    const tokens = vals.addrs.split(/[^0-9a-fA-FxX]+/).filter(Boolean);
    if (!tokens.length) throw { message: '请输入地址序列' };
    if (tokens.length > 14) throw { message: '地址序列最长 14 个（便于展示）' };
    const addrs = tokens.map((tk, i) => {
      const v = /^0x/i.test(tk) ? parseInt(tk, 16) : parseInt(tk, 10);
      if (!Number.isFinite(v) || v < 0) throw { message: `第 ${i + 1} 个地址「${tk}」无效` };
      if (v > maxAddr) throw { message: `地址 ${tk} 超出 ${bits} 位地址空间上限 ${maxAddr}` };
      return v;
    });
    return { assoc, ways, numSets, lines, B, bits, offsetBits, setBits, tagBits, addrs };
  },

  /* ---------------- ② 纯算法：逐地址访问产出快照 ---------------- */
  buildSnapshots(model) {
    const { ways, numSets, B, offsetBits, setBits, addrs } = model;
    let sets = Array.from({ length: numSets }, () => Array.from({ length: ways }, () => ({ valid: 0, tag: null, last: -1 })));
    let clock = 0;
    let hits = 0, cold = 0, conflict = 0;

    const snaps = [{
      step: 'init',
      sets: sets.map(set => set.map(w => ({ ...w }))),
      hits: 0, misses: 0, cold: 0, conflict: 0, accesses: 0,
      addr: null, block: null, setIdx: null, tag: null, offset: null, hit: false, way: -1, victim: null, hadVictimData: false,
      log: `就绪：Cache ${model.lines} 行 = ${numSets} 组 × ${ways} 路，块大小 ${B}B。映射规则：组号 = 主存块号 mod ${numSets}，组内 LRU 替换。`,
      logType: 'info',
      desc: '点击「单步执行」：同组内的行可互相替换（这是与直接映射的本质区别）',
    }];

    addrs.forEach((addr, t) => {
      clock++;
      const block = addr >> offsetBits;
      const setIdx = numSets > 1 ? (block & (numSets - 1)) : 0;
      const tag = block >> setBits;
      const offset = addr & (B - 1);
      const set = sets[setIdx];

      const way = set.findIndex(w => w.valid && w.tag === tag);
      let hit = way >= 0;
      let victim = null, hadVictimData = false;

      if (hit) {
        hits++;
        set[way].last = clock;
        snaps.push({
          step: 'access', addr, block, setIdx, tag, offset, hit, way, victim: null, hadVictimData: false,
          sets: sets.map(set2 => set2.map(w => ({ ...w }))),
          hits, misses: cold + conflict, cold, conflict, accesses: t + 1,
          log: `访问 ${addr}：组号 = 块号 ${block} mod ${numSets} = ${setIdx}；组内并行比较 → 路 ${way} 的 Tag 匹配 → **命中** ✓`,
          logType: 'success',
          desc: `命中于 ${numSets > 1 ? `组 ${setIdx} 的` : ''}路 ${way}（Tag = ${tag}）`,
        });
      } else {
        const isConflict = set.some(w => w.valid);
        if (isConflict) conflict++; else cold++;
        let victimWay = set.findIndex(w => !w.valid);
        if (victimWay < 0) {
          let minLast = Infinity;
          set.forEach((w, wi) => { if (w.last < minLast) { minLast = w.last; victimWay = wi; } });
          victim = { way: victimWay, tag: set[victimWay].tag, block: (set[victimWay].tag << setBits) | setIdx };
          hadVictimData = true;
        } else {
          victim = { way: victimWay, tag: null, block: null };
        }
        set[victimWay] = { valid: 1, tag, last: clock };
        snaps.push({
          step: 'access', addr, block, setIdx, tag, offset, hit: false, way: victimWay, victim, hadVictimData,
          sets: sets.map(set2 => set2.map(w => ({ ...w }))),
          hits, misses: cold + conflict, cold, conflict, accesses: t + 1,
          log: `访问 ${addr}：组 ${setIdx} 内无匹配 → 缺失。` +
            (hadVictimData
              ? `组内已满，LRU 淘汰路 ${victimWay} 的旧块（Tag=${victim.tag}），装入新块（Tag=${tag}）`
              : `组内有空闲路 ${victimWay}，直接装入（Tag=${tag}）`),
          logType: hadVictimData ? 'error' : 'warn',
          desc: hadVictimData ? `组 ${setIdx} 冲突缺失：路 ${victimWay} 旧块被替换` : `组 ${setIdx} 冷缺失：装入空闲路 ${victimWay}`,
        });
      }
    });

    snaps.push({
      step: 'done',
      sets: sets.map(set => set.map(w => ({ ...w }))),
      addr: null, block: null, setIdx: null, tag: null, offset: null, hit: false, way: -1, victim: null, hadVictimData: false,
      hits, misses: cold + conflict, cold, conflict, accesses: addrs.length,
      log: `演示结束：${addrs.length} 次访问，命中 ${hits} 次（命中率 ${RC408.util.pct(hits / addrs.length)}），缺失 ${cold + conflict} 次（强制 ${cold} + 冲突 ${conflict}）。组相联的组内"弹性"正是它命中率高于直接映射的原因。`,
      logType: 'success',
      desc: `完成！命中率 ${RC408.util.pct(hits / addrs.length)}`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const ways = model.assoc === 0 ? model.lines : model.assoc;   // 全相联：所有行都在唯一的组里
    const isFull = model.assoc === 0;
    const hasAddr = s.addr !== null;

    /* 地址划分：Tag | 组号 | Offset（全相联无组号段） */
    const segCells = (from, to, cls) => Array.from({ length: to - from }, (_, i) => {
      const p = from + i;
      const v = hasAddr ? (s.addr >> (model.bits - 1 - p)) & 1 : '·';
      return `<div class="bit-cell ${cls}" style="width:26px;height:32px;font-size:12px" title="第 ${p + 1} 位">${v}</div>`;
    }).join('');
    const addrGrid = `
      <div class="flex flex-wrap justify-center items-start gap-3">
        <div class="flex flex-col items-center gap-1">
          <div class="flex gap-1">${segCells(0, model.tagBits, 'bit-tag')}</div>
          <div class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">标记 Tag（${model.tagBits} 位）= ${hasAddr ? s.tag : '·'}</div>
        </div>
        ${isFull ? '' : `
        <div class="flex flex-col items-center gap-1">
          <div class="flex gap-1">${segCells(model.tagBits, model.tagBits + model.setBits, 'bit-idx')}</div>
          <div class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">组号（${model.setBits} 位）= ${hasAddr ? s.setIdx : '·'}</div>
        </div>`}
        <div class="flex flex-col items-center gap-1">
          <div class="flex gap-1">${segCells(model.tagBits + model.setBits, model.bits, 'bit-off')}</div>
          <div class="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">块内偏移（${model.offsetBits} 位）</div>
        </div>
      </div>
      ${hasAddr ? `<p class="text-[11px] text-slate-400 mt-2 text-center font-mono">地址 ${s.addr}（0x${s.addr.toString(16).toUpperCase()}）→ 主存块号 ${s.block} → ${isFull ? '唯一的组（全相联）' : `组 ${s.block % model.numSets}`}</p>` : '<p class="text-[11px] text-slate-400 mt-2 text-center">等待访问…</p>'}`;

    /* 组 × 路表格 */
    const setCards = s.sets.map((set, si) => {
      const active = hasAddr && s.setIdx === si;
      const rows = set.map((w, wi) => {
        const isHit = active && s.hit && s.way === wi;
        const isVictim = active && !s.hit && s.victim && s.victim.way === wi && s.hadVictimData;
        const isPlaced = active && !s.hit && s.way === wi;
        return `<tr class="${isHit ? 'row-hit' : isVictim || isPlaced ? 'row-cur' : ''}">
          <td class="font-bold ${isHit || isVictim || isPlaced ? 'col-cur' : ''}">路 ${wi}</td>
          <td class="${isVictim ? 'col-cur' : ''}">${w.valid ? '<b style="color:#059669">1 ✓</b>' : '<span style="color:#cbd5e1">0</span>'}</td>
          <td class="font-mono ${isVictim ? 'col-cur' : ''}">
            ${w.valid ? (isVictim ? `<span style="position:relative" class="inline-block"><span class="ghost anim-ghost-out">${w.tag}</span><span class="anim-slide-in">${s.tag}</span></span>` : w.tag) : '<span class="text-slate-300">—</span>'}
          </td>
          <td class="font-mono text-[11px] ${isVictim ? 'col-cur' : ''}">${w.valid ? (w.tag << model.setBits) | si : '—'}</td>
          <td class="${isHit ? 'col-cur' : ''}">${isHit ? '<b style="color:#059669">命中 ✓</b>' : isVictim ? '<b style="color:#e11d48">被 LRU 淘汰</b>' : isPlaced ? '<b style="color:#b45309">新装入 ▲</b>' : w.valid ? '<span class="text-slate-400">占用</span>' : '<span class="text-slate-300">空闲</span>'}</td>
        </tr>`;
      }).join('');
      return `<div class="rounded-xl border ${active ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'} p-2.5">
        <div class="text-[11px] font-bold ${active ? 'text-indigo-600' : 'text-slate-400'} mb-1">组 ${si}（本组 ${ways} 路 · 命中块必落入此组）</div>
        <table class="tbl w-full"><thead><tr><th>路</th><th>有效</th><th>Tag</th><th>主存块</th><th>本轮</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }).join('');

    /* 统计 */
    const rate = s.accesses ? s.hits / s.accesses : 0;
    const stats =
      RC408.ui.statCard('访问进度', `${s.accesses} / ${model.addrs.length}`, `${isFull ? '全相联' : model.assoc + ' 路组相联'}（${model.numSets} 组）`) +
      RC408.ui.statCard('命中', s.hits, `命中率 ${U.pct(rate)}`, 'text-emerald-600') +
      RC408.ui.statCard('缺失', s.misses, `强制 ${s.cold} + 冲突 ${s.conflict}`, 'text-rose-600') +
      RC408.ui.statCard('Tag 比较器', `${model.assoc === 0 ? model.lines : model.assoc} 个/组`, '组内每路一个，并行比较（2022 真题）', 'text-amber-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle(`主存地址划分（${isFull ? '全相联：无组号字段，Tag = 完整块号' : `琥珀 = Tag ${model.tagBits} 位，绿 = 组号 ${model.setBits} 位，蓝 = 偏移 ${model.offsetBits} 位`}）`)}
          ${addrGrid}
        </div>

        <div>
          ${RC408.ui.sectionTitle(`Cache：${model.numSets} 组 × ${ways} 路（当前访问的组高亮；组内 LRU 淘汰时旧 Tag 红字上飘）`)}
          <div class="grid grid-cols-1 ${model.numSets > 2 ? 'md:grid-cols-2' : ''} gap-3">${setCards}</div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#d97706', 'Tag 字段')}
          ${RC408.ui.legend('#059669', '组号字段 / 命中')}
          ${RC408.ui.legend('#e11d48', '被 LRU 淘汰的行')}
          ${RC408.ui.legend('#2563eb', '块内偏移')}
        </div>
      </div>`;
  },
});
