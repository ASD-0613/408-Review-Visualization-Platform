'use strict';
/* ============================================================================
 * coa-cache-direct.js —— 【计算机组成原理】Cache 直接映射（Direct Mapping）
 * ----------------------------------------------------------------------------
 * 数据模型（parse）：
 *   L 行数 / B 块大小（字节）/ bits 主存地址位数
 *   offsetBits = log2(B)，indexBits = log2(L)，tagBits = bits - offsetBits - indexBits
 * 不变量（冒烟逐帧锁住）：
 *   I1 地址等式：addr === tag × (L×B) + index × B + offset        （三段划分自洽）
 *   I2 映射等式：index === block mod L，tag === floor(block / L)，block === floor(addr / B)
 *   I3 行状态：每行 { valid ∈ {0,1}, tag, block }；valid=0 时 tag/block 必为 null
 *   I4 统计：hits + cold + conflict === accesses ≤ addrs.length
 *   I5 判定：命中 ⟺ 访问前 valid=1 且 tag 相同（两条件，缺一不可）
 * 快照（init + 每次访问一帧 + done 总账）：
 *   { step:'init'|'access'|'done', type:'init'|'hit'|'cold'|'conflict'|'done',
 *     addr/block/index/tag/offset   本次访问的地址与三段划分（init/done 为 null）
 *     before {valid,tag,block}      该行"访问前"的样子（命中判定两条件要用它）
 *     validBit / tagMatch           两个条件的实测值
 *     evicted                       冲突时被换出的旧行内容
 *     lines                         全部 Cache 行当前内容
 *     results                       done 帧的逐条总账
 *     hits/misses/cold/conflict/accesses  累计统计 }
 * ⚠ 全序列随 model.seq 传进渲染（**不许读全局 RC408.Runner**）：离线 harness / Node 逐帧渲染里
 *   Runner 不一定在跑，读它会静默取到空数组（窗56 经验 2）。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-cache-direct',
  mode: 'stepper',
  title: 'Cache 直接映射（Direct Mapping）',

  theory: `
> **为什么要有它**：CPU 与主存有约百倍的速度鸿沟，Cache 靠**局部性原理**（时间 + 空间）把常用的主存块副本放到近处，让**平均访存时间**接近 Cache 的速度；直接映射是三种映射里**硬件最省**的一种——每个主存块只能进唯一确定的一行。
> **怎么实现**：**行号 = 主存块号 mod 行数**（行数是 2 的幂，等价于取块号低 k 位），地址随之被切成 **标记 Tag / 行号 Index / 块内偏移 Offset** 三段；判命中只看两个条件：**有效位 = 1** 且 **Tag 相同**。
> **记住什么**：**三段位数的划分**（本考点核心）+ 三类结果的区分（命中 / 强制缺失 / 冲突缺失）+ **容量与标记开销**怎么算。

## 地址划分

| 字段 | 位数 | 作用 |
| --- | --- | --- |
| 块内偏移 Offset | log₂(块大小) | 块内寻址具体字节（按字节编址时） |
| 行号 Index | log₂(行数) | 直接指出映射到哪一行 = 块号的低 k 位 |
| 标记 Tag | 地址位数 − Index − Offset | 区分"落在同一行里的不同块" |

三段划分必须满足等式：**地址 = Tag × (行数 × 块大小) + 行号 × 块大小 + 偏移**——三段任何一段算错，这个等式都配不平。

## 一次访问怎么判

1. 由地址取出 **Index**，定位到唯一一行（直接映射没有"组内挑路"这一步）；
2. 两个条件**同时**成立才算命中：该行**有效位 = 1**、该行 **Tag = 地址的 Tag**；
3. 否则缺失，按**原因**分两类：**强制（冷）缺失** = 这个块**第一次**被访问（哪怕该行里原来有别的块、要把它换出去）；**冲突缺失** = 这个块**之前访问过**、被换出后又要用。⚠ 机械判据只看得到"有效位 / Tag"，**真正的分类要看"这个块见过没有"**——本模块的日志与总账都按原因分类。

## 容量与开销

- **数据区容量 = 行数 × 块大小**（例如 16 行 × 32B = 512B）；
- 每行还要存**标记项**：**有效位 1 位 + Tag 若干位**；直接映射不需要替换位（没有 LRU / FIFO 要记）；
- 所以 **总容量 = 数据位数 + 行数 × (1 + Tag 位数)**；若采用写回策略还要再加 1 位脏位，写直达则不加。
- **"Cache 行至少多少位" = 数据位 + 标记位**，两边都要算：数据位 = 块大小 × 8。2021-16：数据区 32KB、块 32B ⟹ 1024 行，Offset 5 位、Index 10 位、Tag = 32 − 10 − 5 = 17 位；题目说**回写**，再加 1 位脏位 ⟹ 行位数 = 32 × 8 + 17 + 1（有效位）+ 1（脏位）= **275**。只算标记位会落到 257 那一档。
- **标记项里加不加脏位 / 替换位，看题面两句话**：**写回**（Write Back）⟹ 有脏位，**写直达**（Write Through）⟹ 无脏位；**直接映射** ⟹ 无替换控制位，**N 路组相联** ⟹ 每行 \\(\\log_2 N\\) 位 LRU；题面明说"不考虑一致性维护与替换算法控制位"就一律不加（2015-15）。
- **总容量 = 行数 ×（块大小 + 标记项字节数）**，标记项先按位算完再折成字节：2010-44 的标记项 = Tag 19 位 + 有效位 1 位 = 20 位 = 2.5B，8 行 ×（64B + 2.5B）= **532B**。

## 局部性原理与命中率

- **时间局部性**：刚被访问过的单元很快会**再次**被访问——循环体里的指令反复执行、同一个变量被反复引用；
- **空间局部性**：一个单元被访问后，它**附近**的单元很快会被访问——顺序执行的指令、按下标顺序访问的数组；
- 判"这属于哪种局部性"：**指令本身循环**算时间局部性，**对数组 a 的顺序访问**算空间局部性（2017-14）；
- **命中率 = 命中次数 ÷ 访问总次数**。题目给的是**缺失**次数时要先减：命中率 = 1 − 缺失次数 ÷ 总次数——2009-21 的陷阱就是把"缺失 50 次"当成了"命中 50 次"；
- **缺失率 = 1 − 命中率**。一个主存块里装 4 个整数时，只有块内第一个整数的第一次访问缺失、其余都命中 ⟹ 8 次访问里只缺 1 次，缺失率 12.5%（2016-15）。

## 与主存、外存的分工

- **Cache–主存**由**硬件**实现（判缺失、选替换、回写全在硬件里），对程序员透明；**主存–外存（虚存）**由**操作系统**用软件（缺页异常 + 页面置换）实现。
- 为什么分工相反：Cache 缺失是**大概率事件**、必须快到不停机，所以靠硬件；**缺页很少发生但开销极大**（要读盘、要改页表），交给软件才划算（2024-16）。
- **映射关系不同**：Cache 用直接映射或组相联；**主存–外存之间一个虚页可以放进主存任意一个空闲页框**，等价于**全相联**——用"直接映射"去描述虚存就是错项（2024-16 的 D 就在这）。
- **写策略**：Cache–主存可以写回也可以全写；**主存–外存的换页只能写回**（页面被改过才写回，脏位就是记这个的）。
- **指令 Cache 与数据 Cache 为什么要分开**：取指与取数各走一路，流水线里取指段与访存段不再争同一个 Cache 而互相阻塞（2014-16）。

## 问法速查

| 题目怎么问 | 怎么答 |
| --- | --- |
| 给地址位数、行数、块大小，求三段位数 | 先算 Offset = log₂(块大小)、Index = log₂(行数)，Tag = 总位数 − 两者 |
| 给一串地址，求命中率 | 命中率 = 命中次数 ÷ 访问总次数；**看清题目给的是缺失次数还是命中次数**（"缺失 50 次"不等于"命中 50 次"） |
| 为什么两个块会互相踢出 | 它们的块号 mod 行数相同 ⟹ 落同一行、Tag 不同 ⟹ 每次访问都冲突（抖动） |
| 强制 / 冲突 / 容量缺失怎么分 | 强制 = 该块首次访问；冲突 = 访问过又被换出；容量 = 全相联也装不下（直接映射不会出现容量缺失） |
| 求 Cache 总容量 | 数据区 + 标记项（有效位 + Tag），别只算数据区 |

> **真题考情**：**8/18 年（选 7 + 大题 1）**：选 2009-21、2014-16、2015-15、2016-15、2017-14、2021-16、2024-16；大 2010-44。
> 这 8 题含命中率、局部性、指令/数据 Cache 分离等相邻问法，**三段划分的直接考法**见 2015-15、2021-16；Cache 整体（含组相联）**17/18 年、大题 8 道**。
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
      label: '📚 教材式：顺序访问再回头',
      run(rt) {
        rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 16, 32, 48, 0, 16'); rt.load();
      },
    },
    {
      label: '🧩 同块不同偏移（空间局部性）',
      run(rt) {
        rt.setInput('lines', 8); rt.setInput('bsize', 16);
        rt.setInput('addrs', '0, 4, 8, 12, 16'); rt.load();
      },
    },
    {
      label: '🌀 抖动：两个块抢同一行',
      run(rt) {
        rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 128, 0, 128, 0, 128'); rt.load();
      },
    },
    {
      label: '📏 16 位大地址',
      run(rt) {
        rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 16);
        rt.setInput('addrs', '0x1230, 0x1240, 0x1230, 0x2000'); rt.load();
      },
    },
    {
      label: '📊 命中率账：5 访 3 缺',
      run(rt) {
        rt.setInput('lines', 8); rt.setInput('bsize', 16); rt.setInput('bits', 12);
        rt.setInput('addrs', '0, 16, 32, 0, 16'); rt.load();
      },
    },
    {
      label: '🎲 随机序列（每次不同）', run(rt) {
        const B = parseInt((rt.inputEls && rt.inputEls.bsize && rt.inputEls.bsize.value) || 16, 10);
        const seq = [];
        let blk = RC408.util.rnd(0, 3);
        for (let i = 0; i < 10; i++) {
          // 40% 概率复用 / 相邻块（制造命中与冲突），否则随机新块
          if (Math.random() < 0.4 && seq.length) blk = seq[seq.length - 1].blk + (Math.random() < 0.5 ? 0 : 8);
          else blk = RC408.util.rnd(0, 7);
          seq.push({ blk, addr: blk * B + RC408.util.rnd(0, B - 1) });
        }
        rt.setInput('addrs', seq.map(x => x.addr).join(', '));
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const L = parseInt(vals.lines, 10), B = parseInt(vals.bsize, 10), bits = parseInt(vals.bits, 10);
    const offsetBits = Math.log2(B), indexBits = Math.log2(L);
    if (![4, 8, 16].includes(L) || ![4, 8, 16].includes(B)) throw { message: '行数与块大小须为 4 / 8 / 16' };
    if (![8, 12, 16].includes(bits)) throw { message: '地址位数须为 8 / 12 / 16' };
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
    const lines = Array.from({ length: L }, () => ({ valid: 0, tag: null, block: null }));
    const results = [];                       // 末帧总账（也是序列徽片的数据源）
    const seen = new Set();                   // 缺失分类按"原因"：首次访问 = 强制，被换出后重访 = 冲突
    let hits = 0, cold = 0, conflict = 0;

    const snaps = [{
      step: 'init', type: 'init', addr: null, block: null, index: null, tag: null, offset: null,
      before: null, validBit: 0, tagMatch: false, evicted: null,
      lines: lines.map(l => ({ ...l })), results: [],
      hits: 0, misses: 0, cold: 0, conflict: 0, accesses: 0,
      log: `就绪：Cache ${L} 行 × 块大小 ${B}B，地址 ${bits} 位 = 标记 ${tagBits} | 行号 ${indexBits} | 偏移 ${offsetBits}。映射规则：行号 = 主存块号 mod ${L}。`,
      logType: 'info',
      desc: '点击「单步执行」逐个访问地址；三色格子 = Tag / 行号 / 偏移三段划分',
    }];

    addrs.forEach((addr, t) => {
      const block = addr >> offsetBits;          // 主存块号 = floor(addr / B)
      const index = block & (L - 1);             // 行号 = block mod L（L 为 2 的幂 → 取低位）
      const tag = block >> indexBits;            // 标记 = floor(block / L)
      const offset = addr & (B - 1);             // 块内偏移
      const line = lines[index];
      const before = { ...line };
      const validBit = line.valid ? 1 : 0;
      const tagMatch = validBit === 1 && line.tag === tag;
      let type, evicted = null, log, logType, desc;

      if (tagMatch) {
        /* ---- 命中：两个条件都成立 ---- */
        hits++;
        type = 'hit';
        log = `访问 ${_caHex(addr, bits)}（十进制 ${addr}）→ 块号 ${block} → 行 ${index}，有效位=1 且 Tag=${tag} 匹配 → 命中 ✓`;
        logType = 'success';
        desc = `地址 ${addr} 命中于行 ${index}（有效位 1 + Tag 相同）`;
      } else {
        /* ---- 缺失：先记"是不是第一次访问这个块"（这决定缺失原因），再无条件占用该行 ---- */
        const seenBefore = seen.has(block);
        seen.add(block);
        if (validBit) evicted = { ...line };              // 该行原有旧块，被无条件换出
        line.valid = 1; line.tag = tag; line.block = block;
        if (!seenBefore) {
          cold++; type = 'cold';
          log = `访问 ${_caHex(addr, bits)}（十进制 ${addr}）→ 块号 ${block} → 行 ${index}，块 ${block} 首次访问 → 强制缺失，装入该行` +
            (evicted ? `（原块 ${evicted.block} 被无条件换出）` : '（该行原本为空）');
          logType = 'warn';
          desc = `地址 ${addr} 首次访问块 ${block} → 强制缺失，装入行 ${index}` + (evicted ? `，换出块 ${evicted.block}` : '');
        } else {
          conflict++; type = 'conflict';
          log = `访问 ${_caHex(addr, bits)}（十进制 ${addr}）→ 块号 ${block} → 行 ${index}，块 ${block} 之前被换出过，这次仍落同一行 → 冲突缺失 ✘ 旧块 ${evicted ? evicted.block : '—'} 被无条件换出`;
          logType = 'error';
          desc = `地址 ${addr} 重访块 ${block} → 冲突缺失` + (evicted ? `，旧块 ${evicted.block} 被换出` : '');
        }
      }

      results.push({
        i: t + 1, addr, block, index, tag, offset, type,
        evicted: evicted ? { ...evicted } : null,
        hits, rate: hits / (t + 1),
      });

      snaps.push({
        step: 'access', type, addr, block, index, tag, offset,
        before, validBit, tagMatch, evicted,
        lines: lines.map(l => ({ ...l })), results: [],
        hits, misses: cold + conflict, cold, conflict, accesses: t + 1,
        log, logType, desc,
      });
    });

    const n = addrs.length;
    snaps.push({
      step: 'done', type: 'done', addr: null, block: null, index: null, tag: null, offset: null,
      before: null, validBit: 0, tagMatch: false, evicted: null,
      lines: lines.map(l => ({ ...l })), results: results.map(r => ({ ...r })),
      hits, misses: cold + conflict, cold, conflict, accesses: n,
      log: `演示结束：${n} 次访问，命中 ${hits} 次（命中率 ${RC408.util.pct(n ? hits / n : 0)}），缺失 ${cold + conflict} 次（强制 ${cold} + 冲突 ${conflict}）。直接映射命中率受限的根因就是"一行只认特定块"，两个热块撞同一行时会互相踢出。`,
      logType: 'success',
      desc: `末帧总账：命中率 ${RC408.util.pct(n ? hits / n : 0)}（命中 ${hits} / 访问 ${n}），强制 ${cold} + 冲突 ${conflict}`,
    });

    /* 渲染只读 model：全序列随它传进去（离线逐帧渲染时全局 Runner 可能不在跑） */
    model.seq = results.map(r => ({ ...r }));
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const { L, B, bits, offsetBits, indexBits, tagBits } = model;
    const hasAddr = s.addr !== null;
    const isDone = s.type === 'done';

    /* 容器布局一律内联 style：Tailwind 在本站来自仓库内兜底，离线 harness 会摘掉它（§4.7 窗26 立） */
    const sec = (title, body) =>
      `<div class="c59-panel" style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">${RC408.ui.sectionTitle(title)}${body}</div>`;

    /* ---- ① 地址划分位格（Tag 琥珀 / 行号 绿 / 偏移 蓝） ---- */
    const seg = (from, to, cls, label) => {
      let html = '';
      for (let p = from; p < to; p++) {
        const v = hasAddr ? (s.addr >> (bits - 1 - p)) & 1 : '·';
        html += `<div class="bit-cell ${cls}" title="第 ${p + 1} 位（从最高位起）">${v}</div>`;
      }
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <div style="display:flex;gap:4px">${html}</div>
        <div style="font:700 10px system-ui;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:2px 8px">${label}</div>
      </div>`;
    };
    const addrGrid = hasAddr ? `
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:flex-start">
        ${seg(0, tagBits, 'bit-tag', `标记 Tag（${tagBits} 位）= ${s.tag}`)}
        ${seg(tagBits, tagBits + indexBits, 'bit-idx', `行号 Index（${indexBits} 位）= ${s.index}`)}
        ${seg(tagBits + indexBits, bits, 'bit-off', `块内偏移 Offset（${offsetBits} 位）= ${s.offset}`)}
      </div>
      <p style="font:11px Consolas,monospace;color:#94a3b8;margin-top:8px;text-align:center">地址 ${_caHex(s.addr, bits)} = ${U.bin(s.addr, bits)}（十进制 ${s.addr}）</p>
      <p style="font:11px Consolas,monospace;color:#64748b;margin-top:4px;text-align:center">等式：Tag ${s.tag} × (${L}×${B}) + 行号 ${s.index} × ${B} + 偏移 ${s.offset} = ${s.tag * L * B + s.index * B + s.offset} = 地址 ${s.addr}</p>`
      : `<p style="font:13px system-ui;color:#94a3b8;text-align:center;padding:14px 0">单步执行后，这里将展示当前地址的 Tag / 行号 / 偏移三段划分</p>`;

    /* ---- ② 命中判定：两个条件 ---- */
    const condBox = (label, ok, detail) => {
      const c = ok ? { bd: '#a7f3d0', bg: '#ecfdf5', fg: '#047857' } : { bd: '#fecdd3', bg: '#fff1f2', fg: '#be123c' };
      return `<div style="flex:1 1 220px;min-width:0;border:1px solid ${c.bd};background:${c.bg};border-radius:10px;padding:8px 10px">
        <div style="font:700 11px system-ui;color:#64748b">${label}</div>
        <div style="font:800 13px system-ui;color:${c.fg};margin-top:2px">${ok ? '成立 ✓' : '不成立 ✗'}<span style="font:600 12px system-ui;color:#475569;margin-left:6px">${detail}</span></div>
      </div>`;
    };
    const verdict = s.type === 'hit'
      ? { ok: true, text: '命中：两个条件都成立，直接用 Cache 里的副本' }
      : s.type === 'cold'
        ? { ok: false, text: `强制缺失：块 ${s.block} 首次访问` + (s.evicted ? `（该行原有块 ${s.evicted.block}，被无条件换出）` : '（该行原本为空）') }
        : { ok: false, text: `冲突缺失：块 ${s.block} 之前被换出过，重访时仍落同一行（Tag ${s.tag} ≠ 行内 Tag ${s.before ? s.before.tag : '—'}），旧块被无条件换出` };
    const judgeHtml = hasAddr ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${condBox('条件① 该行有效位 = 1', s.validBit === 1, `访问前有效位 = ${s.validBit}`)}
        ${condBox('条件② 该行 Tag = 地址 Tag', !!(s.before && s.tagMatch), `地址 Tag = ${s.tag}，行内 Tag = ${s.before && s.before.tag !== null ? s.before.tag : '空'}`)}
      </div>
      <div style="margin-top:8px;border:1px dashed ${verdict.ok ? '#6ee7b7' : '#fda4af'};border-radius:10px;padding:8px 10px;font:700 12.5px system-ui;color:${verdict.ok ? '#047857' : '#be123c'};background:${verdict.ok ? '#f0fdf4' : '#fff7f7'}">${verdict.text}</div>`
      : '<p style="font:12px system-ui;color:#94a3b8">等待访问…</p>';

    /* ---- ③ 映射公式 ---- */
    const formula = hasAddr ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <span class="chip" style="border-color:#f59e0b;color:#b45309;background:#fffbeb">主存块号 = floor(${s.addr} / ${B}) = ${s.block}</span>
        <span style="color:#94a3b8">→</span>
        <span class="chip" style="border-color:#10b981;color:#047857;background:#ecfdf5">Cache 行号 = ${s.block} mod ${L} = ${s.index}</span>
        <span style="color:#94a3b8">→</span>
        <span class="chip" style="border-color:#d97706;color:#92400e;background:#fffbeb">Tag = floor(${s.block} / ${L}) = ${s.tag}</span>
      </div>
      <p style="font:11.5px system-ui;color:#64748b;margin-top:8px">行 ${s.index} 只认块号 ≡ ${s.index}（mod ${L}）的块：${[0, 1, 2, 3].map(k => s.index + k * L).join(' / ')} …（对应 Tag 0 / 1 / 2 / 3 …）——这就是"两个块撞同一行"的由来。</p>`
      : '<span style="font:12px system-ui;color:#94a3b8">等待访问…</span>';

    /* ---- ④ Cache 行状态表 ---- */
    const rows = s.lines.map((ln, i) => {
      const isCur = hasAddr && i === s.index;
      let status = '<span style="color:#cbd5e1">—</span>';
      let rowCls = '', tagCell = ln.valid ? String(ln.tag) : '<span style="color:#cbd5e1">—</span>';

      if (isCur) {
        if (s.type === 'hit') {
          rowCls = 'row-hit';
          status = '<b style="color:#059669">命中 ✓</b>';
        } else if (s.evicted) {
          rowCls = 'row-cur';
          status = `<b style="color:#e11d48">旧块 ${s.evicted.block} 被换出</b>`;
          tagCell = `<span style="position:relative" class="inline-block"><span class="ghost anim-ghost-out">${s.evicted.tag}</span><span class="anim-slide-in">${s.tag}</span></span>`;
        } else {
          rowCls = 'row-cur';
          status = '<b style="color:#b45309">新装入 ▲</b>';
        }
      } else if (ln.valid) {
        status = '<span style="color:#94a3b8">占用</span>';
      } else {
        status = '<span style="color:#cbd5e1">空闲</span>';
      }

      return `<tr class="${rowCls}">
        <td class="${isCur ? 'col-cur' : ''}" style="font-weight:700">行 ${i}</td>
        <td class="${isCur ? 'col-cur' : ''}">${ln.valid ? '<b style="color:#059669">1 ✓</b>' : '<span style="color:#cbd5e1">0</span>'}</td>
        <td class="${isCur ? 'col-cur' : ''}" style="font-family:Consolas,monospace;font-weight:700">${tagCell}</td>
        <td class="${isCur ? 'col-cur' : ''}" style="font-family:Consolas,monospace">${ln.valid ? '块 ' + ln.block : '<span style="color:#cbd5e1">—</span>'}</td>
        <td class="${isCur ? 'col-cur' : ''}">${status}</td>
      </tr>`;
    }).join('');

    const tableHtml = sec(`Cache 行状态（直接映射：每块只能进固定的一行）`, `
      <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px">
        <table class="tbl" style="width:100%">
          <thead><tr><th>行号</th><th>有效位</th><th>标记 Tag</th><th>缓存的主存块</th><th>本行状态</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`);

    /* ---- ⑤ 容量与标记开销（静态账，逐帧都能看） ---- */
    const dataBits = L * B * 8;
    const tagStoreBits = L * (1 + tagBits);
    const capHtml = sec('容量账（数据区 + 标记项）', `
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <span class="chip" style="border-color:#bfdbfe;color:#1d4ed8;background:#eff6ff">数据区 = ${L} 行 × ${B} B = ${L * B} B（${dataBits} 位）</span>
        <span class="chip" style="border-color:#fde68a;color:#b45309;background:#fffbeb">每行标记项 = 有效位 1 + Tag ${tagBits} = ${1 + tagBits} 位</span>
        <span class="chip" style="border-color:#a7f3d0;color:#047857;background:#ecfdf5">标记合计 = ${L} × ${1 + tagBits} = ${tagStoreBits} 位</span>
        <span class="chip" style="border-color:#e9d5ff;color:#7e22ce;background:#faf5ff">总容量 = ${dataBits} + ${tagStoreBits} = ${dataBits + tagStoreBits} 位（≈ ${((dataBits + tagStoreBits) / 8).toFixed(1)} B）</span>
      </div>
      <p style="font:11.5px system-ui;color:#64748b;margin-top:8px">直接映射不设替换控制位；只有采用写回（write-back）策略时才再加 1 位脏位。题目若只问"数据区容量"就只算第一项。</p>`);

    /* ---- ⑥ 访问序列徽片（数据源 = model.seq，不读全局 Runner） ---- */
    const seqHtml = model.addrs.map((a, j) => {
      const done = j < s.accesses;
      const r = done ? model.seq[j] : null;
      let cls = 'chip-future';
      if (r) cls = r.type === 'hit' ? 'chip-hit' : 'chip-fault';
      if (done && j === s.accesses - 1 && hasAddr) cls += ' chip-cur';
      const title = r
        ? `地址 ${a}：${r.type === 'hit' ? '命中' : r.type === 'cold' ? '强制缺失' : '冲突缺失'}（块 ${r.block} → 行 ${r.index}，Tag ${r.tag}）`
        : `地址 ${a}：尚未访问`;
      return RC408.ui.chip(a, cls, title);
    }).join('');

    /* ---- ⑦ 末帧总账：逐条结果 + 抖动诊断 ---- */
    const conflictByLine = {};
    (s.results || []).forEach(r => {
      if (r.type === 'conflict') conflictByLine[r.index] = (conflictByLine[r.index] || 0) + 1;
    });
    const worst = Object.keys(conflictByLine).map(Number).sort((a, b) => conflictByLine[b] - conflictByLine[a])[0];
    const doneHtml = isDone ? `
      ${sec('逐条总账（命中率 = 命中次数 ÷ 访问总次数）', `
        <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px">
          <table class="tbl" style="width:100%">
            <thead><tr><th>#</th><th>地址</th><th>块号</th><th>行号</th><th>Tag</th><th>结果</th><th>累计命中率</th></tr></thead>
            <tbody>${(s.results || []).map(r => `<tr class="${r.type === 'hit' ? 'row-hit' : r.type === 'conflict' ? 'row-cur' : ''}">
              <td>${r.i}</td>
              <td style="font-family:Consolas,monospace">${_caHex(r.addr, bits)}<span style="color:#94a3b8"> / ${r.addr}</span></td>
              <td>${r.block}</td><td>${r.index}</td><td>${r.tag}</td>
              <td style="font-weight:700;color:${r.type === 'hit' ? '#059669' : r.type === 'conflict' ? '#e11d48' : '#b45309'}">${r.type === 'hit' ? '命中' : r.type === 'cold' ? '强制缺失' : '冲突缺失'}</td>
              <td>${U.pct(r.rate)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        ${worst !== undefined && conflictByLine[worst] >= 2 ? `<p style="font:12px system-ui;color:#be123c;margin-top:8px">⚠ 抖动诊断：行 ${worst} 被换出 ${conflictByLine[worst]} 次 —— 多个热块撞同一行。想消除它，只能换组相联 / 全相联（见同章「组相联与全相联映射」）。</p>` : ''}
        <p style="font:12px system-ui;color:#475569;margin-top:8px">总账：访问 ${s.accesses} 次，命中 ${s.hits}、缺失 ${s.misses}（强制 ${s.cold} + 冲突 ${s.conflict}），命中率 <b>${U.pct(s.accesses ? s.hits / s.accesses : 0)}</b>。</p>`)}

      ${capHtml}

      <div class="c59-panel" style="display:flex;flex-wrap:wrap;gap:6px 20px;font:12px system-ui;color:#64748b;border-top:1px solid #f1f5f9;padding-top:10px">
        ${RC408.ui.legend('#d97706', '标记 Tag 位段')}
        ${RC408.ui.legend('#059669', '行号 Index 位段 / 命中')}
        ${RC408.ui.legend('#2563eb', '块内偏移 Offset 位段')}
        ${RC408.ui.legend('#e11d48', '冲突缺失（旧块被换出）')}
      </div>` : '';

    /* ---- ⑧ 组装 ---- */
    const rate = s.accesses ? s.hits / s.accesses : 0;
    const stats =
      RC408.ui.statCard('访问进度', `${s.accesses} / ${model.addrs.length}`, '已处理地址数') +
      RC408.ui.statCard('命中', s.hits, '有效位=1 且 Tag 相同', 'text-emerald-600') +
      RC408.ui.statCard('缺失', s.misses, `强制 ${s.cold} + 冲突 ${s.conflict}`, 'text-rose-600') +
      RC408.ui.statCard('命中率', U.pct(rate), '命中 ÷ 总访问', rate >= 0.5 ? 'text-indigo-600' : 'text-rose-600');

    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">${stats}</div>
        ${isDone ? doneHtml : `
        ${sec(`主存地址划分（琥珀 = Tag，绿 = 行号，蓝 = 偏移）`, addrGrid)}
        ${sec('命中判定（两个条件缺一不可）', judgeHtml)}
        ${sec('映射过程', formula)}
        ${tableHtml}
        ${capHtml}
        ${sec('访问序列（红 = 缺失，绿 = 命中，描边 = 当前）', `<div style="display:flex;flex-wrap:wrap;gap:6px">${seqHtml}</div>`)}
        <div class="c59-panel" style="display:flex;flex-wrap:wrap;gap:6px 20px;font:12px system-ui;color:#64748b;border-top:1px solid #f1f5f9;padding-top:10px">
          ${RC408.ui.legend('#d97706', '标记 Tag 位段')}
          ${RC408.ui.legend('#059669', '行号 Index 位段')}
          ${RC408.ui.legend('#2563eb', '块内偏移 Offset 位段')}
          ${RC408.ui.legend('#e11d48', '冲突缺失（旧块被换出）')}
        </div>`}
      </div>`;
  },
});

/* ---- 模块内部工具（前缀 ca 防止全局冲突） ---- */
/** 十六进制展示：0x1C */
function _caHex(v, bits) {
  return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
}
