'use strict';
/* ============================================================================
 * coa-cache-assoc.js —— 【计算机组成原理】组相联与全相联映射
 * ----------------------------------------------------------------------------
 * 数据模型（parse）：
 *   assoc 路数（0 = 全相联）/ lines 总行数 / B 块大小 / bits 地址位数
 *   numSets = lines ÷ assoc（全相联 = 1）；setBits = log2(numSets)；ways = assoc（全相联 = lines）
 *   tagBits = bits − setBits − offsetBits
 * 不变量（冒烟逐帧锁住）：
 *   I1 地址等式：addr === tag × (numSets × B) + setIdx × B + offset
 *   I2 映射等式：setIdx === block mod numSets，tag === floor(block / numSets)
 *   I3 每帧每个"组"恰好 ways 路；组内 tag 互不相同（同一块不会同时占两路）
 *   I4 统计：hits + cold + conflict === accesses ≤ addrs.length
 *   I5 命中 ⟺ 访问前组内存在 valid=1 且 tag 相同的路
 *   I6 替换：仅当组内无空路时发生；被淘汰的路 = 访问前"最近使用"值最小的那条
 * 快照（init + 每次访问一帧 + done 总账）：
 *   { step/addr/block/setIdx/tag/offset
 *     before    本组"访问前"的各路 {valid,tag,last}（比较器与 LRU 都读它）
 *     sets      全部组×路的最新状态
 *     hit/way/victim/hadVictimData   结果与承载路
 *     results   done 帧的逐条总账；cmp = 三映射对照
 *     hits/misses/cold/conflict/accesses }
 * ⚠ 渲染只读 model / snap：全序列随 model.seq 传进去（**不读全局 RC408.Runner**，窗56 经验 2）；
 *   容器布局一律内联 style（Tailwind 离线会塌版，窗56 经验 1）。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-cache-assoc',
  mode: 'stepper',
  title: '组相联与全相联映射',

  theory: `
> **为什么要有它**：直接映射不灵活——两个热块撞同一行就互相踢出；全相联又要太多比较器。**组相联是折中**：先按直接映射"定组"，再在组内全相联，代价只是每路一个 Tag 比较器。
> **怎么实现**：**组数 = 总行数 ÷ 路数**，**组号 = 主存块号 mod 组数**（直接定组）；组内任选一路，都满时按 **LRU** 淘汰组内最久未用的行。
> **记住什么**：**路数 = 组内 Tag 比较器个数**（并行比较）+ 地址三段划分 + **容量要算上有效位、Tag 与 LRU 位**。

## 三种映射的统一视角

| 路数 | 组数 | 退化为 | 组号位数 |
| --- | --- | --- | --- |
| 1 | = 总行数 | 直接映射 | log₂(行数) |
| 2 / 4 / 8 … | 总行数 ÷ 路数 | 组相联（本模块） | log₂(组数) |
| = 总行数 | 1 | 全相联 | 0（Tag = 完整块号） |

## 地址划分与组内判定

- 地址 = **Tag + 组号 + 块内偏移**；**组号 = 块号 mod 组数**，**Tag = ⌊块号 ÷ 组数⌋**；
- **组数一步算**：组数 = **数据区容量 ÷（块大小 × 路数）**。别先算"组大小 = 数据区 ÷ 路数"再折块数——2025-43 的数据区 32KB、块 64B、8 路 ⟹ 组数 = 32KB ÷（64B × 8） = **64**，组号 6 位；绕两步算容易把"组内块数"和"组内路数"混掉；
- **老题用的是另一套字段名**：主存字块标记 = **Tag**，Cache 字块标记 = **组号**（直接映射时是行号），字块内地址 = **块内偏移**（2011-44、2015-15 都是这套叫法）；
- 组号位数 = log₂(组数)，所以同样总行数下 **Tag 比直接映射更短**（组内有了选择余地）；
- 组内每一路各配一个 **Tag 比较器**、**并行**比较 → **路数 = 比较器个数**，而**每个比较器的位数 = Tag 位数**（2022-16 选项把它写成"8 个 20 位比较器"就是这个意思）；
- **题目给的是字节地址时，先折成块号**：块号 = ⌊字节地址 ÷ 块大小⌋（块号从 0 开始），再取 mod 组数。2009-14 的 129 号单元：129 ÷ 32 = 4 ⟹ 块 4 ⟹ 组 4；2026-18 的 1028 ÷ 32 = 32 ⟹ 32 mod 256 = 32；
- 命中要求：该行**有效位 = 1** 且**某一路的 Tag 与地址 Tag 相同**（两个条件与直接映射一样，只是候选从"一行"变成"一组"）。

## LRU 怎么走

1. **命中**：不换行，但要把这一路标成"最近使用"——**漏掉这一步，后面的淘汰就会挑错人**；
2. **缺失且组内有空路**：直接装入空路；
3. **缺失且组已满**：淘汰组内"最近使用"值最小的那一路。
手算口诀：每访问一次就把组内各路按"最近使用"重排，命中的挪到最前；缺失时顶掉排在最后的那个。

## 缺失的三种原因

- **强制（冷）缺失**：这个块**第一次**被访问——任何 Cache 都躲不掉；
- **冲突缺失**：这个块访问过、但被组内其他块挤掉了，再访问时不在；
- **容量缺失**：Cache 太小，**即使全相联**也装不下。
做题时先问"这个块之前来过没有"：没来过就是强制；来过还没有，再看是不是组内被挤掉的。（本模块的统计口径：全相联下的重访缺失记**容量**，组相联下的重访缺失一律记**冲突**。）

## 容量与开销

- **数据区 = 总行数 × 块大小**；
- 每行的标记项 = **有效位 1 位 + Tag 若干位 + LRU 位**（每行 ⌈log₂路数⌉ 位，用来记最近使用）；
- **写策略决定要不要加脏位**：**回写**（Write Back）⟹ 每行多 **1 位修改位（脏位）**；**直写 / 写直达**（Write Through）⟹ **没有修改位**。2018-44 是回写所以要加，2020-44 明说直写所以不加；
- **总容量 = 数据位数 + 行数 × 标记项位数**；路数越大命中率越高，比较器与 LRU 位也越贵。
- **Cache–主存可以直写也可以回写，主存–外存的换页只能用回写**：写回省主存带宽，但要靠脏位记"这一行被改过"；直写实现简单，但每次写都要等主存。

## 缺失率与平均访问时间

- **缺失率 = 缺失次数 ÷ 访问总次数**，而**缺失次数按"块"统计**：一个块里连续访问多个字节只算一次缺失。2020-44 里 s 占满 64 个块、每块首次访问都缺失 ⟹ 缺失次数 = 块数 = 64；
- **平均访问时间 = 命中时间 + 缺失率 × 缺失代价**（缺失代价 = 从主存搬一个块的额外时间）。例如命中 1 个周期、缺失代价 50 个周期、缺失率 2% ⟹ 平均 1 + 0.02 × 50 = 2 个周期；
- **两个地址能不能落在同一页**：只要 ⌊地址 ÷ 页大小⌋ 相等就在同一页，与它们差多远无关（2019-46 就是拿这个判 push 与 ret 是否同页）。

## 问法速查

| 题目怎么问 | 怎么答 |
| --- | --- |
| 某主存块映射到哪一组 | 块号 mod 组数，与 Tag 无关 |
| 给数据区容量、块大小、路数，求组号 / Tag 位数 | 组数 = 数据区 ÷（块大小 × 路数）⟹ 组号位数 = log₂(组数)，Tag = 地址位数 − 组号位数 − 块内偏移位数 |
| 给地址序列，推 LRU 替换过程与命中率 | 逐次维护组内"最近使用"顺序；**命中也要更新** |
| 求组内 Tag 比较器个数 | = 路数（每路一个、并行比较） |
| 求 Cache 总容量 | 数据区 + 有效位 + Tag + LRU 位，别漏后三项 |
| 为什么命中率比直接映射高 | 组内可换路，消掉了"两个热块撞同一行必互相踢出"的抖动 |

> **真题考情**：**11/18 年（选 4 + 大题 7）**：大 2011-44、2016-45、2018-44、2019-46、2020-44（8 路）、2023-43（4 路）、2025-43（8 路）；选 2009-14、2012-17、2022-16（比较器个数）、2026-18（块号 mod 组数）。
> 其中 2011-44 的 Cache 本体是直接映射、组相联部分是 TLB；Cache 整体（含直接映射）**17/18 年、大题 8 道**。
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
      default: '0, 128, 16, 144, 0, 128, 16, 144',
      help: '十进制或 0x 十六进制，最多 14 个；须小于 2^地址位数',
    },
  ],

  quickActions: [
    {
      label: '🌀 2 路冲突密集（同组互踢）',
      run(rt) {
        rt.setInput('assoc', 2); rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 64, 128, 192, 0, 256, 0'); rt.load();
      },
    },
    {
      label: '🌐 同序列 · 全相联对照',
      run(rt) {
        rt.setInput('assoc', 0); rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 64, 128, 192, 0, 256, 0'); rt.load();
      },
    },
    {
      label: '🔄 4 路：命中也要更新 LRU',
      run(rt) {
        rt.setInput('assoc', 4); rt.setInput('lines', 8); rt.setInput('bsize', 16);
        rt.setInput('addrs', '0, 64, 128, 192, 0, 256, 64'); rt.load();
      },
    },
    {
      label: '🏗️ 8 路：真题大题形态',
      run(rt) {
        rt.setInput('assoc', 8); rt.setInput('lines', 16); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 128, 256, 384, 512, 640, 768, 896, 0, 1024'); rt.load();
      },
    },
    {
      label: '🧊 冷启动：填满一组再替换',
      run(rt) {
        rt.setInput('assoc', 4); rt.setInput('lines', 8); rt.setInput('bsize', 16);
        rt.setInput('addrs', '0, 32, 64, 96, 128'); rt.load();
      },
    },
    {
      label: '✅ 2 路装得下两个热块',
      run(rt) {
        rt.setInput('assoc', 2); rt.setInput('lines', 8); rt.setInput('bsize', 16);
        rt.setInput('addrs', '0, 64, 0, 64, 128, 64'); rt.load();
      },
    },
    {
      label: '📦 容量缺失：全相联也装不下',
      run(rt) {
        rt.setInput('assoc', 0); rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 16, 32, 48, 64, 80, 96, 112, 128, 0'); rt.load();
      },
    },
    {
      label: '🎲 随机序列（每次不同）', run(rt) {
        const B = parseInt((rt.inputEls && rt.inputEls.bsize && rt.inputEls.bsize.value) || 16, 10);
        const seq = [];
        let blk = RC408.util.rnd(0, 3);
        for (let i = 0; i < 10; i++) {
          if (Math.random() < 0.45 && seq.length) blk = seq[seq.length - 1].blk + (Math.random() < 0.5 ? 0 : 4);
          else blk = RC408.util.rnd(0, 6);
          seq.push({ blk, addr: blk * B + RC408.util.rnd(0, B - 1) });
        }
        rt.setInput('addrs', seq.map(x => x.addr).join(', '));
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const assoc = parseInt(vals.assoc, 10);            // 0 表示全相联
    const lines = parseInt(vals.lines, 10);
    const B = parseInt(vals.bsize, 10);
    const bits = parseInt(vals.bits, 10);
    if (![0, 2, 4, 8].includes(assoc)) throw { message: '路数须为 2 / 4 / 8，全相联请选「全相联（只有一组）」' };
    if (![8, 16].includes(lines)) throw { message: '总行数须为 8 / 16' };
    if (![8, 16, 32].includes(B)) throw { message: '块大小须为 8 / 16 / 32 字节' };
    if (![8, 12, 16].includes(bits)) throw { message: '地址位数须为 8 / 12 / 16' };
    if (assoc > 0 && lines % assoc !== 0) throw { message: `${lines} 行不能被 ${assoc} 路整除，请换一组参数` };
    const offsetBits = Math.log2(B);
    const numSets = assoc === 0 ? 1 : lines / assoc;
    const setBits = numSets > 1 ? Math.log2(numSets) : 0;
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
    const sets = Array.from({ length: numSets }, () => Array.from({ length: ways }, () => ({ valid: 0, tag: null, last: -1 })));
    const results = [];
    let clock = 0;
    let hits = 0, cold = 0, conflict = 0, capMiss = 0;

    const cloneSets = () => sets.map(set => set.map(w => ({ ...w })));
    const seen = new Set();                   // 缺失按原因分类：首次访问 = 强制；被换出后重访 = 冲突 / 容量
    const isFullAssoc = model.assoc === 0;

    const snaps = [{
      step: 'init',
      sets: cloneSets(), results: [], cmp: null,
      hits: 0, misses: 0, cold: 0, conflict: 0, capMiss: 0, accesses: 0,
      addr: null, block: null, setIdx: null, tag: null, offset: null,
      hit: false, cause: '', way: -1, victim: null, hadVictimData: false, before: null, lruWay: -1,
      log: `就绪：Cache ${model.lines} 行 = ${numSets} 组 × ${ways} 路，块大小 ${B}B。映射规则：组号 = 主存块号 mod ${numSets}，组内 LRU 替换。`,
      logType: 'info',
      desc: '点击「单步执行」：同组内的行可以互相替换（这是与直接映射的本质区别）',
    }];

    addrs.forEach((addr, t) => {
      clock++;
      const block = addr >> offsetBits;
      const setIdx = numSets > 1 ? (block & (numSets - 1)) : 0;
      const tag = block >> setBits;
      const offset = addr & (B - 1);
      const set = sets[setIdx];
      const before = set.map(w => ({ ...w }));

      const way = set.findIndex(w => w.valid && w.tag === tag);
      const hit = way >= 0;
      let victim = null, hadVictimData = false, lruWay = -1, cause = '';

      if (hit) {
        hits++;
        set[way].last = clock;
        results.push({ i: t + 1, addr, block, setIdx, tag, offset, hit: true, cause: 'hit', way, victim: null, hits, rate: hits / (t + 1) });
        snaps.push({
          step: 'access', addr, block, setIdx, tag, offset, hit: true, cause: 'hit', way, victim: null, hadVictimData: false, before, lruWay: -1,
          sets: cloneSets(), results: [],
          hits, misses: cold + conflict + capMiss, cold, conflict, capMiss, accesses: t + 1,
          log: `访问 ${addr}：组号 = 块号 ${block} mod ${numSets} = ${setIdx}；组内并行比较 → 路 ${way} 的 Tag 匹配 → **命中** ✓（同时把路 ${way} 标成最近使用）`,
          logType: 'success',
          desc: `命中于${numSets > 1 ? `组 ${setIdx} 的` : ''}路 ${way}（Tag = ${tag}）；命中也要更新「最近使用」`,
        });
      } else {
        const seenBefore = seen.has(block);
        seen.add(block);
        if (!seenBefore) { cold++; cause = 'cold'; }
        else if (isFullAssoc) { capMiss++; cause = 'capacity'; }
        else { conflict++; cause = 'conflict'; }

        let victimWay = set.findIndex(w => !w.valid);
        if (victimWay < 0) {
          let minLast = Infinity;
          set.forEach((w, wi) => { if (w.last < minLast) { minLast = w.last; victimWay = wi; } });
          victim = { way: victimWay, tag: set[victimWay].tag, block: (set[victimWay].tag << setBits) | setIdx, last: set[victimWay].last };
          hadVictimData = true;
          lruWay = victimWay;
        } else {
          victim = { way: victimWay, tag: null, block: null, last: -1 };
        }
        set[victimWay] = { valid: 1, tag, last: clock };
        results.push({ i: t + 1, addr, block, setIdx, tag, offset, hit: false, cause, way: victimWay, victim: victim && victim.tag !== null ? { ...victim } : null, hits, rate: hits / (t + 1) });
        snaps.push({
          step: 'access', addr, block, setIdx, tag, offset, hit: false, cause, way: victimWay, victim, hadVictimData, before, lruWay,
          sets: cloneSets(), results: [],
          hits, misses: cold + conflict + capMiss, cold, conflict, capMiss, accesses: t + 1,
          log: `访问 ${addr}：组 ${setIdx} 内无匹配 → ${_caCauseName(cause)}。` +
            (hadVictimData
              ? `组内已满，LRU 淘汰路 ${victimWay} 的旧块（Tag=${victim.tag}，上次使用在第 ${victim.last} 次访问），装入新块（Tag=${tag}）`
              : `组内有空闲路 ${victimWay}，直接装入（Tag=${tag}）`),
          logType: hadVictimData ? 'error' : 'warn',
          desc: hadVictimData
            ? `${_caCauseName(cause)}：路 ${victimWay} 最久未用（第 ${victim.last} 次访问）→ 被替换`
            : `${_caCauseName(cause)}：装入空闲路 ${victimWay}`,
        });
      }
    });

    const n = addrs.length;
    const rate = n ? hits / n : 0;
    const direct = _caRefDirect(addrs, model.lines, B);
    const full = _caRefFull(addrs, model.lines, B);
    const missTotal = cold + conflict + capMiss;
    const missTxt = `强制 ${cold} + 冲突 ${conflict}` + (capMiss ? ` + 容量 ${capMiss}` : '');
    snaps.push({
      step: 'done',
      sets: cloneSets(), results: results.map(r => ({ ...r })),
      cmp: { direct, full, cur: { hits, misses: missTotal, rate, cold, conflict, capMiss } },
      addr: null, block: null, setIdx: null, tag: null, offset: null,
      hit: false, cause: '', way: -1, victim: null, hadVictimData: false, before: null, lruWay: -1,
      hits, misses: missTotal, cold, conflict, capMiss, accesses: n,
      log: `演示结束：${n} 次访问，命中 ${hits} 次（命中率 ${RC408.util.pct(rate)}），缺失 ${missTotal} 次（${missTxt}）。同一序列：直接映射命中 ${direct.hits} 次、全相联命中 ${full.hits} 次——组相联的"组内弹性"正是它命中率高于直接映射的原因。`,
      logType: 'success',
      desc: `末帧总账：本配置命中率 ${RC408.util.pct(rate)}｜直接映射 ${RC408.util.pct(direct.rate)}｜全相联 ${RC408.util.pct(full.rate)}`,
    });

    /* 渲染只读 model：全序列随它传进去（不读全局 Runner） */
    model.seq = results.map(r => ({ ...r }));
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const ways = model.ways;
    const numSets = model.numSets;
    const isFull = model.assoc === 0;
    const hasAddr = s.addr !== null;
    const isDone = s.step === 'done';

    /* 容器布局一律内联 style：离线 harness 会摘掉 Tailwind（§4.7 窗26 立） */
    const sec = (title, body) =>
      `<div class="c59-panel" style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">${RC408.ui.sectionTitle(title)}${body}</div>`;
    const leg = (color, text) =>
      `<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:12px;height:12px;border-radius:999px;background:${color}"></span>${text}</span>`;

    /* ---- ① 地址划分：Tag | 组号 | 偏移（全相联无组号段） ---- */
    const segCells = (from, to, cls) => Array.from({ length: Math.max(0, to - from) }, (_, i) => {
      const p = from + i;
      const v = hasAddr ? (s.addr >> (model.bits - 1 - p)) & 1 : '·';
      return `<div class="bit-cell ${cls}" style="width:26px;height:32px;font-size:12px" title="第 ${p + 1} 位">${v}</div>`;
    }).join('');
    const addrGrid = `
      <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:12px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="display:flex;gap:4px">${segCells(0, model.tagBits, 'bit-tag')}</div>
          <div style="font:700 10px system-ui;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:2px 8px">标记 Tag（${model.tagBits} 位）= ${hasAddr ? s.tag : '·'}</div>
        </div>
        ${isFull ? '' : `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="display:flex;gap:4px">${segCells(model.tagBits, model.tagBits + model.setBits, 'bit-idx')}</div>
          <div style="font:700 10px system-ui;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:2px 8px">组号（${model.setBits} 位）= ${hasAddr ? s.setIdx : '·'}</div>
        </div>`}
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="display:flex;gap:4px">${segCells(model.tagBits + model.setBits, model.bits, 'bit-off')}</div>
          <div style="font:700 10px system-ui;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:2px 8px">块内偏移（${model.offsetBits} 位）</div>
        </div>
      </div>
      ${hasAddr ? `<p style="font:11px Consolas,monospace;color:#64748b;margin-top:8px;text-align:center">地址 ${s.addr}（${_caHex2(s.addr, model.bits)}）→ 块号 ${s.block} → ${isFull ? '唯一的组（全相联）' : `组 ${s.setIdx}（= ${s.block} mod ${numSets}）`}</p>
      <p style="font:11px Consolas,monospace;color:#94a3b8;margin-top:2px;text-align:center">等式：Tag ${s.tag} × (${numSets}×${model.B}) + 组号 ${s.setIdx} × ${model.B} + 偏移 ${s.offset} = ${s.tag * numSets * model.B + s.setIdx * model.B + s.offset} = 地址 ${s.addr}</p>` : '<p style="font:11px system-ui;color:#94a3b8;margin-top:6px;text-align:center">等待访问…</p>'}`;

    /* ---- ② 组内并行比较（路数 = 比较器个数） ---- */
    const cmpCells = hasAddr && s.before ? s.before.map((w, wi) => {
      const eq = !!(w.valid && w.tag === s.tag);
      const bg = eq ? '#ecfdf5' : '#fff';
      const bd = eq ? '#6ee7b7' : '#e2e8f0';
      return `<div style="flex:1 1 90px;min-width:80px;border:1px solid ${bd};background:${bg};border-radius:10px;padding:6px 8px;text-align:center">
        <div style="font:700 10.5px system-ui;color:#94a3b8">${isFull ? '路' : '比较器'} ${wi}</div>
        <div style="font:700 12px Consolas,monospace;color:#334155">Tag ${w.valid ? w.tag : '空'}</div>
        <div style="font:700 11px system-ui;color:${eq ? '#047857' : '#cbd5e1'}">${w.valid ? (eq ? '= 匹配 ✓' : '≠ 不匹配') : '（空行）'}</div>
      </div>`;
    }).join('') : '';
    const judgeText = !hasAddr ? '等待访问…'
      : s.hit ? `组内 ${ways} 个比较器并行比较 → 路 ${s.way} 匹配 → 命中 ✓`
        : s.hadVictimData ? `${_caCauseName(s.cause)}，组已满：淘汰「最近使用」最旧的路 ${s.way}（第 ${s.victim.last} 次访问用过），装入新块`
          : `${_caCauseName(s.cause)}：组内有空闲路 ${s.way}，直接装入`;
    const judgeHtml = hasAddr ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px">${cmpCells}</div>
      <div style="margin-top:8px;border:1px dashed ${s.hit ? '#6ee7b7' : '#fda4af'};background:${s.hit ? '#f0fdf4' : '#fff7f7'};border-radius:10px;padding:8px 10px;font:700 12.5px system-ui;color:${s.hit ? '#047857' : '#be123c'}">${judgeText}</div>` : '<p style="font:12px system-ui;color:#94a3b8">等待访问…</p>';

    /* ---- ③ 组 × 路表 ---- */
    const setCards = s.sets.map((set, si) => {
      const active = hasAddr && s.setIdx === si;
      const rows = set.map((w, wi) => {
        const isHit = active && s.hit && s.way === wi;
        const isVictim = active && !s.hit && s.victim && s.victim.way === wi && s.hadVictimData;
        const isPlaced = active && !s.hit && s.way === wi;
        const lastTxt = w.valid ? String(w.last) : '—';
        const tagCell = w.valid
          ? (isVictim ? `<span style="position:relative;display:inline-block"><span class="ghost anim-ghost-out">${w.tag}</span><span class="anim-slide-in">${s.tag}</span></span>` : w.tag)
          : '<span style="color:#cbd5e1">—</span>';
        return `<tr class="${isHit ? 'row-hit' : isVictim || isPlaced ? 'row-cur' : ''}">
          <td class="font-bold ${isHit || isVictim || isPlaced ? 'col-cur' : ''}">路 ${wi}</td>
          <td class="${isVictim ? 'col-cur' : ''}">${w.valid ? '<b style="color:#059669">1 ✓</b>' : '<span style="color:#cbd5e1">0</span>'}</td>
          <td class="font-mono ${isVictim ? 'col-cur' : ''}">${tagCell}</td>
          <td class="font-mono" style="font-family:Consolas,monospace;font-size:11px">${w.valid ? (w.tag * numSets + si) : '—'}</td>
          <td class="font-mono" style="font-family:Consolas,monospace">${lastTxt}</td>
          <td class="${isHit ? 'col-cur' : ''}">${isHit ? '<b style="color:#059669">命中 ✓</b>' : isVictim ? '<b style="color:#e11d48">被 LRU 淘汰</b>' : isPlaced ? '<b style="color:#b45309">新装入 ▲</b>' : w.valid ? '<span style="color:#94a3b8">占用</span>' : '<span style="color:#cbd5e1">空闲</span>'}</td>
        </tr>`;
      }).join('');
      return `<div class="c59-panel" style="border:1px solid ${active ? '#a5b4fc' : '#e2e8f0'};background:${active ? '#eef2ff80' : '#fff'};border-radius:12px;padding:8px 10px">
        <div style="font:700 11px system-ui;color:${active ? '#4f46e5' : '#94a3b8'};margin-bottom:6px">组 ${si}（${ways} 路 · 命中块必落入此组）</div>
        <div style="overflow-x:auto">
          <table class="tbl" style="width:100%"><thead><tr><th>路</th><th>有效</th><th>Tag</th><th>主存块</th><th>最近使用</th><th>本轮</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>`;
    }).join('');

    /* ---- ④ 容量账（数据区 + 有效位 + Tag + LRU 位） ---- */
    const dataBits = model.lines * model.B * 8;
    const lruBits = ways > 1 ? Math.ceil(Math.log2(ways)) : 0;
    const perLineBits = 1 + model.tagBits + lruBits;
    const tagStoreBits = model.lines * perLineBits;
    const capHtml = sec('容量账（数据区 + 标记项）', `
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <span class="chip" style="border-color:#bfdbfe;color:#1d4ed8;background:#eff6ff">数据区 = ${model.lines} 行 × ${model.B} B = ${model.lines * model.B} B（${dataBits} 位）</span>
        <span class="chip" style="border-color:#fde68a;color:#b45309;background:#fffbeb">每行标记 = 有效位 1 + Tag ${model.tagBits}${lruBits ? ` + LRU ${lruBits}` : ''} = ${perLineBits} 位</span>
        <span class="chip" style="border-color:#a7f3d0;color:#047857;background:#ecfdf5">标记合计 = ${model.lines} × ${perLineBits} = ${tagStoreBits} 位</span>
        <span class="chip" style="border-color:#e9d5ff;color:#7e22ce;background:#faf5ff">总容量 = ${dataBits} + ${tagStoreBits} = ${dataBits + tagStoreBits} 位（≈ ${((dataBits + tagStoreBits) / 8).toFixed(1)} B）</span>
      </div>
      <p style="font:11.5px system-ui;color:#64748b;margin-top:8px">路数 = 组内 Tag 比较器个数（并行比较）；LRU 位按每行 ⌈log₂路数⌉ 位计${isFull ? '（全相联时每行都要比较全部行）' : ''}。题目若只问"数据区容量"就只算第一项。</p>`);

    /* ---- ⑤ 访问序列徽片 ---- */
    const seqHtml = model.addrs.map((a, j) => {
      const r = j < s.accesses ? model.seq[j] : null;
      let cls = 'chip-future';
      if (r) cls = r.hit ? 'chip-hit' : 'chip-fault';
      if (r && j === s.accesses - 1 && hasAddr) cls += ' chip-cur';
      const title = r
        ? `地址 ${a}：${r.hit ? '命中' : '缺失'}（块 ${r.block} → 组 ${r.setIdx}，Tag ${r.tag}，路 ${r.way}）`
        : `地址 ${a}：尚未访问`;
      return RC408.ui.chip(a, cls, title);
    }).join('');

    /* ---- ⑥ 末帧：逐条总账 + 三映射对照 ---- */
    const cmp = s.cmp;
    const doneHtml = isDone && cmp ? `
      ${sec('逐条总账（命中率 = 命中次数 ÷ 访问总次数）', `
        <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px">
          <table class="tbl" style="width:100%">
            <thead><tr><th>#</th><th>地址</th><th>块号</th><th>组号</th><th>Tag</th><th>承载路</th><th>结果</th><th>累计命中率</th></tr></thead>
            <tbody>${(s.results || []).map(r => `<tr class="${r.hit ? 'row-hit' : r.victim ? 'row-cur' : ''}">
              <td>${r.i}</td>
              <td style="font-family:Consolas,monospace">${_caHex2(r.addr, model.bits)}<span style="color:#94a3b8"> / ${r.addr}</span></td>
              <td>${r.block}</td><td>${r.setIdx}</td><td>${r.tag}</td><td>${r.way}</td>
              <td style="font-weight:700;color:${r.hit ? '#059669' : r.victim ? '#e11d48' : '#b45309'}">${r.hit ? '命中' : r.cause === 'cold' ? '冷缺失' : r.cause === 'capacity' ? '容量缺失' : '冲突缺失'}</td>
              <td>${U.pct(r.rate)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`)}

      ${sec('同一序列 · 三种映射横向对照（命中率的差距就是"组内弹性"的价值）', `
        <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px">
          <table class="tbl" style="width:100%">
            <thead><tr><th>配置</th><th>组织</th><th>比较器</th><th>命中 / 访问</th><th>命中率</th></tr></thead>
            <tbody>
              <tr><td>直接映射</td><td>${model.lines} 行 × 1 路</td><td>1 个 / 组</td><td>${cmp.direct.hits} / ${model.addrs.length}</td><td>${U.pct(cmp.direct.rate)}</td></tr>
              <tr class="row-hit"><td><b>本配置</b></td><td>${numSets} 组 × ${ways} 路</td><td>${ways} 个 / 组</td><td><b>${cmp.cur.hits} / ${model.addrs.length}</b></td><td><b>${U.pct(cmp.cur.rate)}</b></td></tr>
              <tr><td>全相联</td><td>1 组 × ${model.lines} 路</td><td>${model.lines} 个 / 组</td><td>${cmp.full.hits} / ${model.addrs.length}</td><td>${U.pct(cmp.full.rate)}</td></tr>
            </tbody>
          </table>
        </div>
        <p style="font:12px system-ui;color:#475569;margin-top:8px">总账：访问 ${s.accesses} 次，命中 ${s.hits}、缺失 ${s.misses}（强制 ${s.cold} + 冲突 ${s.conflict}），命中率 <b>${U.pct(s.accesses ? s.hits / s.accesses : 0)}</b>。
        ${isFull ? '当前就是全相联，第三行与"本配置"相同。' : (cmp.cur.rate > cmp.direct.rate ? '本配置比直接映射高，正是"组内可以换路"换来的。' : '这条序列上本配置没赢过直接映射——组内也会互相踢，换条序列再比。')}</p>`)}

      ${capHtml}

      <div class="c59-panel" style="display:flex;flex-wrap:wrap;gap:6px 20px;font:12px system-ui;color:#64748b;border-top:1px solid #f1f5f9;padding-top:10px">
        ${leg('#d97706', 'Tag 字段')}
        ${leg('#059669', '组号字段 / 命中')}
        ${leg('#e11d48', '被 LRU 淘汰的行')}
        ${leg('#2563eb', '块内偏移')}
      </div>` : '';

    /* ---- ⑦ 组装 ---- */
    const rate = s.accesses ? s.hits / s.accesses : 0;
    const stats =
      RC408.ui.statCard('访问进度', `${s.accesses} / ${model.addrs.length}`, `${isFull ? '全相联' : model.assoc + ' 路组相联'}（${numSets} 组）`) +
      RC408.ui.statCard('命中', s.hits, `命中率 ${U.pct(rate)}`, 'text-emerald-600') +
      RC408.ui.statCard('缺失', s.misses, `强制 ${s.cold} + 冲突 ${s.conflict}` + (s.capMiss ? ` + 容量 ${s.capMiss}` : ''), 'text-rose-600') +
      RC408.ui.statCard('Tag 比较器', `${ways} 个/组`, '组内每路一个，并行比较（2022 真题）', 'text-amber-600');

    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">${stats}</div>
        ${isDone ? doneHtml : `
        ${sec(`主存地址划分（${isFull ? '全相联：无组号字段，Tag = 完整块号' : `琥珀 = Tag ${model.tagBits} 位，绿 = 组号 ${model.setBits} 位，蓝 = 偏移 ${model.offsetBits} 位`}）`, addrGrid)}
        ${sec(`组内判定（${ways} 路 → ${ways} 个 Tag 比较器并行比较）`, judgeHtml)}
        <div class="c59-panel" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px">${setCards}</div>
        ${capHtml}
        ${sec('访问序列（红 = 缺失，绿 = 命中，描边 = 当前）', `<div style="display:flex;flex-wrap:wrap;gap:6px">${seqHtml}</div>`)}
        <div class="c59-panel" style="display:flex;flex-wrap:wrap;gap:6px 20px;font:12px system-ui;color:#64748b;border-top:1px solid #f1f5f9;padding-top:10px">
          ${leg('#d97706', 'Tag 字段')}
          ${leg('#059669', '组号字段 / 命中')}
          ${leg('#e11d48', '被 LRU 淘汰的行')}
          ${leg('#2563eb', '块内偏移')}
        </div>`}
      </div>`;
  },
});

/* ---- 独立参考实现（第二条路径：只用本文件局部状态，供末帧对照用） ---- */
/** 直接映射：行号 = 块号 mod L，冲突必换、无替换算法 */
function _caRefDirect(addrs, L, B) {
  const off = Math.log2(B), idxBits = Math.log2(L);
  const lines = Array.from({ length: L }, () => ({ valid: 0, tag: null }));
  let hits = 0;
  addrs.forEach(a => {
    const blk = a >> off, idx = blk & (L - 1), tag = blk >> idxBits;
    const ln = lines[idx];
    if (ln.valid && ln.tag === tag) hits++;
    else { ln.valid = 1; ln.tag = tag; }
  });
  return { hits, misses: addrs.length - hits, rate: addrs.length ? hits / addrs.length : 0 };
}
/** 全相联：只有一组、L 路、LRU */
function _caRefFull(addrs, L, B) {
  const off = Math.log2(B);
  const ways = Array.from({ length: L }, () => ({ valid: 0, tag: null, last: -1 }));
  let clock = 0, hits = 0;
  addrs.forEach(a => {
    clock++;
    const tag = a >> off;
    const w = ways.findIndex(x => x.valid && x.tag === tag);
    if (w >= 0) { hits++; ways[w].last = clock; return; }
    let v = ways.findIndex(x => !x.valid);
    if (v < 0) { let min = Infinity; ways.forEach((x, i) => { if (x.last < min) { min = x.last; v = i; } }); }
    ways[v] = { valid: 1, tag, last: clock };
  });
  return { hits, misses: addrs.length - hits, rate: addrs.length ? hits / addrs.length : 0 };
}
/** 十六进制展示：0x1C */
function _caHex2(v, bits) {
  return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
}
/** 缺失原因（日志 / 判定行共用一套措辞） */
function _caCauseName(cause) {
  return cause === 'hit' ? '命中'
    : cause === 'cold' ? '冷缺失（该块首次访问）'
      : cause === 'capacity' ? '容量缺失（全相联也装不下）'
        : '冲突缺失（该块被换出后重访）';
}
