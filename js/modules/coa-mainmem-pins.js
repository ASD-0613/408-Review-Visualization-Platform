'use strict';
/* ============================================================================
 * coa-mainmem-pins.js —— 【计算机组成原理】主存芯片引脚与交叉编址（即时计算器）
 * 模式：instant（改输入即出结果，无快照；前缀 _mp）
 * 考点：
 *   ① 芯片引脚核算：**地址线位数 → 地址引脚数**（DRAM 行列地址复用取 max，不复用取全量）
 *      + **数据引脚 = 数据位宽**；并由"行 × 列 = 单元数"反选最省引脚、刷新开销最小的行列结构；
 *   ② 多体交叉编址：**体号 = 地址低位**（低位交叉）/ **地址高位分段**（高位交叉），
 *      由"跨几轮"算读取一段数据要几个存储周期，顺带检测访存冲突与算带宽。
 *
 * 数据模型与不变量（先看这里再看实现；§3.8-13：数组字段别当标量用）
 *   · **量的单位**：`cap` / `capPer` 一律是**存储单元数**（不是字节数）；`width` / `unitBits`
 *     是**位（bit）**；地址一律是**字节地址**（按字节编址）。三种量不许串（§3.8-12 的量纲教训）。
 *   · **地址引脚数公式**（本模块第一考点）：
 *       不复用：addrPins = k = ⌈log₂N⌉                    （N = 单元数，行列地址各走各的引脚）
 *       复用  ：addrPins = max(⌈log₂r⌉, ⌈log₂c⌉)           （r × c = N，行/列地址分时共用一组引脚）
 *     ⚠ **不是 k/2**：只有 r = c 那一对才恰好等于 k/2；(1, N) 那一对仍是 k（max(0, k) = k）。
 *       不变量：任意一对都有 addrPins ≤ k；且 pins 是"行、列位数中较大的那个"。
 *   · **行列备选表**：只枚举 **2 的幂**的因子对（题目口径；r 从 2⁰ 到 2^⌊k/2⌋，c = N/r）。
 *       推荐对 = 先取 **addrPins 最小**，并列时取 **r 最小**（DRAM 按行刷新，行数少 ⟹ 刷新开销小）。
 *   · **体号公式**（第二考点；bpu = unitBits/8 = 一个体一次提供的字节数）：
 *       低位交叉：body = ⌊字节地址 / bpu⌋ mod m      （连续地址轮流落到不同体，可并行）
 *       高位交叉：body = ⌊字节地址 / segBytes⌋        （segBytes = capPer × bpu，每个体占一整段）
 *     ⚠ 试题口径里 unitBits = 8 ⟹ bpu = 1 ⟹ **body = 字节地址 mod m**（2017-13 的 mod 4、
 *       2026-15 的 mod 8、2015-18 的"模块序号 = 访存地址 % 交叉模块数"都是它）。
 *   · **存储周期数**（第二考点最易错的一处）：
 *       块号 block(x) = ⌊x / bpu⌋；轮号 round(x) = ⌊block(x) / m⌋
 *       低位交叉：rounds = round(addr + L − 1) − round(addr) + 1   ← **数"跨了几轮"，不是 ⌈L/(m·bpu)⌉**
 *       高位交叉：rounds = block(addr + L − 1) − block(addr) + 1    （一次访存只命中一个体）
 *     ★ 依据 2017-13：L = 8 字节、m = 4、bpu = 1、addr 低 2 位 = 2 ⟹ 从**体 2** 起跨 3 轮
 *       （体 2,3 ／ 0,1,2,3 ／ 0,1）⟹ 官方答案 **3** 个存储周期；写成 ⌈8/4⌉ = 2 就错了。
 *   · **访存冲突**（低位交叉）：同一体号在**相邻 m 次**访存里出现两次 ⟹ 冲突（2015-18 的官方表述
 *     "给定的访存地址在相邻的四次访问中出现在同一个存储模块内"，四 = m）。
 *   · **带宽**：低位交叉连续读 m 个字耗时 T + (m−1)·r ⟹ 带宽 = m·W/(T+(m−1)r)（W = 总线宽度）；
 *     顺序（高位交叉）只有 W/T。单位换算：1 位/ns = 1e9 bit/s = 125 MB/s。
 *
 * 守卫上限 vs 合法输入上界（§3.8-17⑦：守卫必须 ≥ 合法输入上界，否则静默截断）
 *   单元数上限 2^40（≪ 2^53，双精度整数精确）；地址上限 2^53−1；序列最多 24 个地址；
 *   逐字节图与逐根引脚图都只画前 24 / 16 个（多出来的在画面上写明"未逐项绘出"，模型里仍是全量）。
 * ========================================================================== */

(function () {
  const NUM_MAX = Math.pow(2, 40);      // 单元数上限（2^40 ≈ 1.1e12，双精度仍精确）
  const ADDR_MAX = Math.pow(2, 53);     // 字节地址上限
  const PIN_DRAW_MAX = 16;              // 逐根绘出的引脚上限（超过只写数量）
  const CELL_DRAW_MAX = 24;             // 逐字节绘出的上限
  const SEQ_MAX = 24;                   // 访存序列最多几个地址
  const BODY_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316'];

  /** 表示 0 .. n−1 至少需要多少位。（不用 Math.log2：n 恰为 2 的幂时浮点边界会差 1） */
  function bitsFor(n) {
    let b = 0, p = 1;
    while (p < n) { p *= 2; b++; }
    return b;
  }

  function isPow2(n) { return Number.isFinite(n) && n > 0 && (n & (n - 1)) === 0; }

  /** 2 的幂 → 2^e 写法（画面上展示位数用） */
  function p2(n) { return '2^' + Math.round(Math.log2(n)); }

  /** 单元数 → 教材写法：4194304 → 4M、2048 → 2K（K/M/G 都按 1024 进） */
  function fmtUnits(n) {
    if (n >= 1024 * 1024 * 1024 && n % (1024 * 1024 * 1024) === 0) return (n / (1024 * 1024 * 1024)) + 'G';
    if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return (n / (1024 * 1024)) + 'M';
    if (n >= 1024 && n % 1024 === 0) return (n / 1024) + 'K';
    return String(n);
  }

  /** 字节数 → 人类可读 */
  function fmtBytes(b) {
    if (b >= 1024 * 1024 * 1024 && b % (1024 * 1024 * 1024) === 0) return (b / (1024 * 1024 * 1024)) + 'GB';
    if (b >= 1024 * 1024 && b % (1024 * 1024) === 0) return (b / (1024 * 1024)) + 'MB';
    if (b >= 1024 && b % 1024 === 0) return (b / 1024) + 'KB';
    return b + 'B';
  }

  function hex(v, pad) {
    return '0x' + v.toString(16).toUpperCase().padStart(pad, '0');
  }

  /** 十六进制位数（按地址空间大小定，至少 2 位） */
  function hexPad(totalBytes) { return Math.max(2, Math.ceil(bitsFor(Math.max(2, totalBytes)) / 4)); }

  /** 非负整数（带上下限与"必须为正"开关） */
  function intOf(raw, name, lo, hi, mustPositive) {
    const t = String(raw == null ? '' : raw).trim();
    if (!/^\d+$/.test(t)) throw { message: name + '要填非负整数（现在填的是「' + (t || '空') + '」）' };
    const x = Number(t);
    if (x > hi) throw { message: name + '最多 ' + hi + '（现在填的是 ' + x + '）' };
    if (mustPositive ? x < lo : x < 0) throw { message: name + '至少 ' + lo + '（现在填的是 ' + x + '）' };
    return x;
  }

  /** 正实数（T / r 这类允许小数） */
  function numOf(raw, name, lo, hi) {
    const t = String(raw == null ? '' : raw).trim();
    if (!/^\d+(?:\.\d+)?$/.test(t)) throw { message: name + '要填正数（现在填的是「' + (t || '空') + '」）' };
    const x = Number(t);
    if (!(x >= lo) || x > hi) throw { message: name + '要在 ' + lo + ' ~ ' + hi + ' 之间（现在填的是 ' + x + '）' };
    return x;
  }

  /**
   * 单元数解析：`2048` / `2K` / `4M` / `2^11` / `8192*8192`（乘法式，用于"8192×8192"这种规格）。
   * ⚠ 这里的 K/M/G 是**单元数**的量级，与"字节数"无关（量纲自洽由调用方保证）。
   */
  function unitsOf(raw, what) {
    const t = String(raw == null ? '' : raw).trim().replace(/[\s,_]/g, '').replace(/[×xX＊*]/g, '*');
    if (!t) throw { message: '请填写' + what };
    let m = t.match(/^2\^(\d+)$/);
    if (m) {
      const e = Number(m[1]);
      if (e > 40) throw { message: what + '写成了 2^' + e + '，超过演示上限 2^40' };
      return Math.pow(2, e);
    }
    if (t.indexOf('*') >= 0) {
      const parts = t.split('*');
      if (parts.length !== 2) throw { message: what + '的乘法式只支持两个因子（如 8192*8192）' };
      const a = unitsOf(parts[0], what), b = unitsOf(parts[1], what);
      const v = a * b;
      if (!(v <= NUM_MAX)) throw { message: what + '算出来 ' + v + '，超过演示上限 2^40' };
      return v;
    }
    m = t.match(/^(\d+(?:\.\d+)?)([KkMmGg])$/);
    if (m) {
      const mult = { k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[m[2].toLowerCase()];
      const v = Math.round(parseFloat(m[1]) * mult);
      if (!(v <= NUM_MAX)) throw { message: what + '算出来 ' + v + '，超过演示上限 2^40' };
      return v;
    }
    if (/^\d+$/.test(t)) {
      const v = Number(t);
      if (v < 1) throw { message: what + '至少 1' };
      if (v > NUM_MAX) throw { message: what + '最多 2^40（现在填的是 ' + v + '）' };
      return v;
    }
    throw { message: what + '「' + String(raw).trim() + '」写法不认识：可写 2048 / 2K / 4M / 2^11 / 8192*8192' };
  }

  /** 字节地址解析：十进制（8004）／0x 前缀（0x0018001D）／H 后缀（804001AH） */
  function addrOf(raw, what) {
    const t = String(raw == null ? '' : raw).trim().replace(/[\s,_]/g, '');
    if (!t) throw { message: '请填写' + what };
    let m = t.match(/^0[xX]([0-9a-fA-F]+)$/);
    if (m) return chk(parseInt(m[1], 16), raw, what);
    m = t.match(/^([0-9a-fA-F]+)[hH]$/);
    if (m) return chk(parseInt(m[1], 16), raw, what);
    if (/^\d+$/.test(t)) return chk(parseInt(t, 10), raw, what);
    throw { message: what + '「' + String(raw).trim() + '」不是合法地址：写十进制（8004）、0x0018001D 或 804001AH' };
  }
  function chk(v, raw, what) {
    if (!Number.isFinite(v) || v < 0) throw { message: what + '「' + raw + '」不是合法地址' };
    if (v > ADDR_MAX) throw { message: what + '「' + raw + '」超过地址上限 2^53' };
    return v;
  }

  /* ------------------------------ 模式①：芯片引脚 ------------------------------ */

  /** 由"单元数 + 数据位宽 + 是否行列复用 + 指定的行数"算全部派生量 */
  function buildPins(vals) {
    const cap = unitsOf(vals.cap, '芯片存储单元数');
    const width = intOf(vals.width, '数据位宽（位）', 1, 1024, true);
    const reuse = vals.reuse !== 'no';
    const k = bitsFor(cap);

    /* 行列备选：只枚举 2 的幂因子对（题目口径）。cap 不是 2 的幂时就只有 (1, cap) 这一对。 */
    const pairs = [];
    if (isPow2(cap)) {
      for (let i = 0; i * 2 <= k; i++) {
        const r = Math.pow(2, i), c = cap / r;
        pairs.push({ r: r, c: c, rBits: bitsFor(r), cBits: bitsFor(c), pins: reuse ? Math.max(bitsFor(r), bitsFor(c)) : k });
      }
    } else {
      pairs.push({ r: 1, c: cap, rBits: 0, cBits: bitsFor(cap), pins: reuse ? bitsFor(cap) : k });
    }

    /* 推荐对：先 min(地址引脚)，并列再取 r 最小（行数少 ⟹ 刷新开销小） */
    let reco = pairs[0];
    pairs.forEach(p => {
      if (p.pins < reco.pins || (p.pins === reco.pins && p.r < reco.r)) reco = p;
    });

    /* 用户指定行数：必须是 2 的幂且整除 cap */
    const rowsIn = intOf(vals.rowsIn, '指定的行数 r（0 = 自动）', 0, NUM_MAX, false);
    let pick = reco, pickSrc = '自动推荐';
    if (rowsIn > 0) {
      let want = rowsIn;
      if (!isPow2(want)) throw { message: '指定的行数 r = ' + want + ' 不是 2 的幂（DRAM 的行、列数都按 2 的幂给）' };
      if (cap % want !== 0) throw { message: '指定的行数 r = ' + want + ' 不能整除单元数 ' + cap + '（要满足 r × c = 单元数）' };
      const c = cap / want;
      const pair = pairs.filter(p => p.r === want && p.c === c)[0];
      if (!pair) throw { message: '行数 r = ' + want + ' 对应的列数 c = ' + c + ' 不在可选范围内' };
      pick = pair; pickSrc = '按你指定';
    }

    const addrPins = reuse ? pick.pins : k;
    return {
      mode: 'pins',
      cap: cap, width: width, reuse: reuse, k: k,
      pairs: pairs, pick: pick, pickSrc: pickSrc, reco: reco,
      capText: fmtUnits(cap),
      spec: fmtUnits(cap) + '×' + width + ' 位',
      totalAddrBits: k,
      addrPins: addrPins,
      dataPins: width,
      totalPins: addrPins + width,
      /* 复用时的"引脚共用"说明：行、列各几位 */
      rowBits: reuse ? pick.rBits : k,
      colBits: reuse ? pick.cBits : 0,
      /* 引脚数与"地址线位数"的差（复用省下来的根数） */
      savedPins: k - addrPins,
      minPins: Math.min.apply(null, pairs.map(p => p.pins)),
      hint: '',
    };
  }

  /* ------------------------------ 模式②：交叉编址 ------------------------------ */

  function buildIl(vals) {
    const m = intOf(vals.mods, '存储体数 m', 2, 64, true);
    if (!isPow2(m)) throw { message: '存储体数必须是 2 的幂（低位交叉的体号取地址低位，必须能整除 2^k）' };
    const unitBits = intOf(vals.unitBits, '每个体的数据位宽（位）', 8, 128, true);
    if (unitBits % 8 !== 0) throw { message: '每个体的数据位宽必须是 8 的倍数（按字节编址，一个体一次至少给 1 字节）' };
    const bpu = unitBits / 8;                                  // 一个体一次提供的字节数
    const capPer = unitsOf(vals.capPer, '每个体的存储单元数');
    const order = vals.order === 'high' ? 'high' : 'low';
    const addr = addrOf(vals.addrIn, '目标地址');
    const len = intOf(vals.lenIn, '要读取的字节数 L', 1, 65536, true);

    const segBytes = capPer * bpu;                             // 高位交叉下一个体占的字节数
    const totalBytes = m * segBytes;
    const pad = hexPad(totalBytes);
    if (addr >= totalBytes) throw { message: '目标地址 ' + hex(addr, pad) + ' 超出一共 ' + fmtBytes(totalBytes) + ' 的地址空间' };
    if (order === 'high' && addr + len > totalBytes) {
      throw { message: '地址 + 长度 = ' + (addr + len) + ' 字节，超出存储空间 ' + fmtBytes(totalBytes) };
    }

    const busBits = m * unitBits;                              // 存储器总线宽度（m 个体并行）
    const busBytes = m * bpu;                                  // 一个存储周期能取多少字节

    const firstBlock = Math.floor(addr / bpu);
    const lastBlock = Math.floor((addr + len - 1) / bpu);
    let body, inner, rounds, blocks;
    if (order === 'low') {
      body = firstBlock % m;
      inner = Math.floor(firstBlock / m);                      // 体内块号
      rounds = Math.floor(lastBlock / m) - Math.floor(firstBlock / m) + 1;
      blocks = lastBlock - firstBlock + 1;
    } else {
      body = Math.floor(addr / segBytes);
      inner = addr % segBytes;
      rounds = lastBlock - firstBlock + 1;
      blocks = rounds;
    }

    /* 逐字节落体（只画前 CELL_DRAW_MAX 个）。⚠ round 存的是**相对轮号**（从 0 起）：
       绝对轮号动辄上亿（轮号 = ⌊块号/m⌋），画面上要的是"第 1 轮 / 第 2 轮"。 */
    const cells = [];
    const drawLen = Math.min(len, CELL_DRAW_MAX);
    const baseRound = Math.floor(firstBlock / m);
    for (let j = 0; j < drawLen; j++) {
      const a = addr + j;
      const blk = Math.floor(a / bpu);
      cells.push({
        j: j, addr: a,
        body: order === 'low' ? (blk % m) : Math.floor(a / segBytes),
        round: order === 'low' ? (Math.floor(blk / m) - baseRound) : 0,
      });
    }

    /* 各体一览 */
    const bodies = [];
    for (let i = 0; i < m; i++) {
      if (order === 'low') {
        bodies.push({ i: i, text: '块号 ≡ ' + i + ' (mod ' + m + ')', start: i * bpu, kind: 'low' });
      } else {
        bodies.push({
          i: i, start: i * segBytes, end: (i + 1) * segBytes - 1, kind: 'high',
          text: hex(i * segBytes, pad) + ' ~ ' + hex((i + 1) * segBytes - 1, pad),
        });
      }
    }

    /* 访存冲突（只看低位交叉：高位交叉一个体是一整段连续地址，不存在"同体冲突"的说法） */
    const seqRaw = String(vals.seq == null ? '' : vals.seq).trim();
    const seq = [];
    if (seqRaw) {
      const parts = seqRaw.split(/[,，、;；\s]+/).filter(s => s !== '');
      if (parts.length > SEQ_MAX) throw { message: '地址序列最多 ' + SEQ_MAX + ' 个（现在填了 ' + parts.length + ' 个）' };
      parts.forEach((p, i) => {
        const a = addrOf(p, '地址序列第 ' + (i + 1) + ' 个');
        seq.push({ i: i, addr: a, body: order === 'low' ? (Math.floor(a / bpu) % m) : Math.floor(a / segBytes), conflict: -1 });
      });
      if (order === 'low') {
        for (let i = 0; i < seq.length; i++) {
          for (let j = 0; j <= i - 1; j++) {
            if (seq[i].body === seq[j].body && (i - j) < m) seq[i].conflict = j;   // 取最近的那个
          }
        }
      }
    }
    const conflicts = seq.filter(s => s.conflict >= 0).length;

    /* 带宽：低位交叉连续读 m 个字耗时 T + (m−1)·r；顺序存储只有 W/T */
    const T = numOf(vals.T, '存取周期 T（ns）', 0.001, 1e6);
    const rBus = numOf(vals.rBus, '总线传送周期 r（ns）', 0.001, 1e6);
    const tLow = T + (m - 1) * rBus;
    const bwLow = m * busBits / tLow;                          // 位/ns
    const bwSeq = busBits / T;

    return {
      mode: 'il',
      m: m, unitBits: unitBits, bpu: bpu, capPer: capPer, order: order,
      addr: addr, len: len, addrText: String(vals.addrIn == null ? '' : vals.addrIn).trim(),
      pad: pad, busBits: busBits, busBytes: busBytes,
      segBytes: segBytes, totalBytes: totalBytes,
      body: body, inner: inner, rounds: rounds, blocks: blocks,
      cells: cells, drawnCells: drawLen, cellsTruncated: len > drawLen,
      bodies: bodies,
      seq: seq, conflicts: conflicts, seqChecked: order === 'low',
      T: T, rBus: rBus, tLow: tLow, bwLow: bwLow, bwSeq: bwSeq, speedup: bwLow / bwSeq,
      hint: '',
    };
  }

  RC408.registerModule({
    id: 'coa-mainmem-pins',
    mode: 'instant',
    title: '主存芯片引脚与交叉编址',

    theory: `
> **为什么要有它**：主存是"**芯片 → 内存条 → 地址空间**"三级拼出来的，考场上真正要算的只有两件事——这块芯片**对外要引出多少根引脚**，以及连续地址**究竟落在哪一个存储体上**。
> **怎么实现**：引脚数由"地址位数 + 数据位数"决定，而 DRAM 把行、列地址**分时复用同一组地址引脚**（先送行地址、再送列地址），所以地址引脚只取行列中**位数较大的那个**；交叉编址则把**地址低位当体号**，让连续地址轮流落到不同体上，靠并行换带宽。
> **记住什么**：地址引脚 = 行列位数的**较大者**（不是两者之和、也不是地址位数的一半）；低位交叉下**同体地址相差体数的整数倍**；读一段数据要几个存储周期，看它**跨了几轮**，不是"字节数 ÷ 体数"。

## 一、芯片引脚：地址线怎么变成引脚（模式①）
- 芯片规格 = **单元数 × 数据位宽**（如 4M×8 位 = \\(2^{22}\\) 个单元、每个单元 8 位）；
- **地址线位数** \\(k=\\lceil\\log_2 N\\rceil\\)（\\(N\\) = 单元数；4M ⟹ 22 位、8192×8192 ⟹ 26 位）；
- 存储阵列是**行 × 列**的二维结构，\\(r\\times c=N\\)：
  - **地址不复用**：地址引脚 = \\(k\\)（行、列地址各走各的引脚）；
  - **DRAM 地址复用**：行地址 \\(\\lceil\\log_2 r\\rceil\\) 位与列地址 \\(\\lceil\\log_2 c\\rceil\\) 位**共用同一组引脚**、靠 RAS/CAS 分时选通 ⟹ **地址引脚 = \\(\\max(\\lceil\\log_2 r\\rceil,\\lceil\\log_2 c\\rceil)\\)**；
- **数据引脚 = 数据位宽**（×8 ⟹ 8 根）。题目问"地址引脚和数据引脚总数"就是把两者相加；
- **行列怎么选最省引脚**：两个位数越接近，\\(\\max\\) 越小 ⟹ 取 \\(r\\)、\\(c\\) 最接近的一对；位数相同时再取**行数少**的那对（DRAM 按行刷新，行数少 ⟹ 刷新开销小）。

## 二、多体交叉编址：地址落在哪个体（模式②）
- 设**体（模块）数 \\(m\\)**、每个体一次给 \\(w\\) 位（即 \\(w/8\\) 字节），则**存储器总线宽度 = \\(m\\times w\\)**；
- **低位交叉（多模块交叉）**：体号 = \\(\\lfloor\\text{byte}/{(w/8)}\\rfloor \\bmod m\\) —— 连续地址**轮流**落到不同体，一个存储周期内 \\(m\\) 个体**并行**各送一个数据块；
- **高位交叉（顺序）**：体号 = \\(\\lfloor\\text{byte}/\\text{seg}\\rfloor\\)（seg = 每体字节数）—— 每个体占**一整段连续地址**，一次访存只命中一个体，没有并行性；
- **读 \\(L\\) 字节要几个存储周期**：数**跨了几轮**——先算块号 \\(b=\\lfloor\\text{byte}/(w/8)\\rfloor\\)、再算轮号 \\(\\lfloor b/m\\rfloor\\)，轮数 = 末轮 − 首轮 + 1；**低位交叉数轮、高位交叉数块**；
- **带宽**：低位交叉连续读 \\(m\\) 个字耗时 \\(T+(m-1)r\\) ⟹ 带宽 = \\(mW/(T+(m-1)r)\\)（\\(T\\) 存取周期、\\(r\\) 总线传送周期），理想上限 \\(W/r\\)；顺序存储只有 \\(W/T\\)。

## 三、考点提醒（易错点）
1. **地址引脚 ≠ 地址线位数**：复用后引脚数只有地址线位数的一半左右。2022-17 的"芯片的地址引脚为 26 位"就是这么错的——\\(\\log_2(8192\\times8192)=26\\) 位地址线，复用后只有 **13 根**引脚；
2. **行列位数取 \\(\\max\\)，不是求和**：2018-17 的 (32, 64) 与 (64, 32) 都只要 \\(\\max(5,6)=6\\) 根，而 (2048, 1)、(1, 2048) 要 11 根 ⟹ 先排除 A、D；再按"行数少、刷新开销小"选 **C**；
3. **体号看"地址低位"**：4 体下 8000 与 8004 同体（都 \\(\\bmod 4=0\\)），这就是 2015-18 的答案；8 体下地址 \\(\\bmod 8\\) 相同的才同芯片（2026-15）；
4. **周期数不是"字节数 ÷ 体数"**：2017-13 的 8 字节从**体 2** 起算，跨 3 轮（2,3 ／ 0,1,2,3 ／ 0,1）⟹ **3** 个存储周期；只有整轮对齐时 \\(\\lceil L/(m\\cdot w/8)\\rceil\\) 才碰巧对；
5. **"每次最多读写 W 位"是硬件上限**：地址没有整轮对齐，就一定会多跨一轮；
6. 别与相邻考点混淆：**芯片扩展（位扩展 / 字扩展 / 片选译码 / MAR·MDR 位数）**属 coa-mainmem 模块，本条目只算**引脚位宽**与**体号 / 周期数**。

> **真题考情**：**6/18 年（全为选择题，无大题）**——选 2014-15（256MB 由 4M×8 的 DRAM 组成，地址引脚 + 数据引脚 = 19）、2015-18（4 体交叉编址，序列里 8004 与 8000 同体 ⟹ 访存冲突）、2017-13（4 片 64M×8 交叉编址 + 32 位总线，读 double 要 3 个存储周期）、2018-17（2K×1 的 DRAM 取行、列数：地址引脚最少且刷新开销小 ⟹ 32×64）、2022-17（8 片 8192×8192×8 内存条四项叙述纠错 ⟹ 芯片地址引脚 13 根）、2026-15（8 片 64M×8 交叉编址，与 0018 001DH 同一芯片的地址）。
`,

    /* ---------------- 输入表单（每个 input 都必须显式给 default，见 §3.1-6 / §3.8-11） ---------------- */
    inputs: [
      { key: 'mode', label: '要算什么', type: 'select', default: 'pins', wide: true,
        options: [
          { v: 'pins', t: '① 芯片引脚：地址位数 → 地址引脚 / 行列结构 / 数据引脚' },
          { v: 'il', t: '② 交叉编址：体号 / 存储周期数 / 访存冲突 / 带宽' },
        ] },
      { key: 'cap', label: '芯片存储单元数【模式①】（可写 4M、2048、2^11、8192*8192）', default: '4M', wide: true,
        help: '芯片规格里的单元数。4M×8 写 4M；8192×8192×8 位写 8192*8192；2K×1 写 2048' },
      { key: 'width', label: '数据位宽（位）【模式①】', default: '8',
        help: '每个单元的数据位数 = 数据引脚数。4M×8 写 8；2K×1 写 1' },
      { key: 'reuse', label: 'DRAM 行列地址是否复用【模式①】', type: 'select', default: 'yes',
        options: [
          { v: 'yes', t: '复用（地址引脚 = 行、列位数的较大者）' },
          { v: 'no', t: '不复用（地址引脚 = 全部地址线）' },
        ] },
      { key: 'rowsIn', label: '指定的行数 r（0 = 自动取推荐）【模式①】', default: '0',
        help: '填 2 的幂且能整除单元数，用来核对"我选的 r、c 对不对"；留 0 就自动给出地址引脚最少、行数最少的那一对' },
      { key: 'mods', label: '存储体（芯片）数 m【模式②】', default: '8',
        help: '必须是 2 的幂。2017-13 是 4；2026-15 是 8' },
      { key: 'unitBits', label: '每个体的数据位宽（位）【模式②】', default: '8',
        help: '一个体一次提供多少位；真题里都是 8 位（= 1 字节），所以总线宽度 = m × 8' },
      { key: 'capPer', label: '每个体的存储单元数【模式②】', default: '64M',
        help: '用于算总容量与高位交叉的地址分段。64M×8 位的芯片写 64M' },
      { key: 'order', label: '编址方式【模式②】', type: 'select', default: 'low',
        options: [
          { v: 'low', t: '低位交叉（地址低位作体号，可并行取数）' },
          { v: 'high', t: '高位交叉（每个体占一整段连续地址）' },
        ] },
      { key: 'addrIn', label: '目标地址【模式②】（十进制 / 0x 前缀 / H 后缀）', default: '0x0018001D', wide: true,
        help: '想看哪个地址落在哪个体。例：0x0018001D（2026-15）、804001AH（2017-13）、8004（2015-18）' },
      { key: 'lenIn', label: '要读取的字节数 L【模式②】', default: '8',
        help: '这段数据跨几个存储周期；double 型变量写 8，单个字节写 1' },
      { key: 'seq', label: '访存地址序列（逗号分隔，留空跳过）【模式②】', default: '8005,8006,8007,8008,8001,8002,8003,8004,8000', wide: true,
        help: '低位交叉下检测"同一体号出现在相邻 m 次访存里"的冲突（2015-18 同款序列）；最多 24 个' },
      { key: 'T', label: '存取周期 T（ns）【模式②，算带宽】', default: '100' },
      { key: 'rBus', label: '总线传送周期 r（ns）【模式②，算带宽】', default: '25' },
    ],

    /* ---------------- 预设（冒烟用假 rt 逐个跑通并核对标签承诺，§3.5-15） ---------------- */
    quickActions: [
      { label: '🎯 2014-15：256MB 由 4M×8 的 DRAM 组成 → 地址引脚 11 + 数据引脚 8 = 19',
        run(rt) { rt.setInput('mode', 'pins'); rt.setInput('cap', '4M'); rt.setInput('width', '8'); rt.setInput('reuse', 'yes'); rt.setInput('rowsIn', '0'); rt.load(); } },
      { label: '🎯 2018-17：2K×1 的 DRAM 选行列结构 → (32, 64) 只要 6 根地址引脚、行数还最少',
        run(rt) { rt.setInput('mode', 'pins'); rt.setInput('cap', '2048'); rt.setInput('width', '1'); rt.setInput('reuse', 'yes'); rt.setInput('rowsIn', '32'); rt.load(); } },
      { label: '🎯 2022-17：8192×8192×8 的芯片 → 26 位地址线，复用后只有 13 根地址引脚',
        run(rt) { rt.setInput('mode', 'pins'); rt.setInput('cap', '8192*8192'); rt.setInput('width', '8'); rt.setInput('reuse', 'yes'); rt.setInput('rowsIn', '0'); rt.load(); } },
      { label: '📗 地址不复用：4M×8 全引脚 → 地址 22 + 数据 8 = 30',
        run(rt) { rt.setInput('mode', 'pins'); rt.setInput('cap', '4M'); rt.setInput('width', '8'); rt.setInput('reuse', 'no'); rt.setInput('rowsIn', '0'); rt.load(); } },
      { label: '🎯 2026-15：8 片 64M×8 交叉编址 → 0018 001DH 与 0000 01D5H 同体（体 5）',
        run(rt) { rt.setInput('mode', 'il'); rt.setInput('mods', '8'); rt.setInput('unitBits', '8'); rt.setInput('capPer', '64M'); rt.setInput('order', 'low'); rt.setInput('addrIn', '0x0018001D'); rt.setInput('lenIn', '8'); rt.setInput('seq', ''); rt.load(); } },
      { label: '🎯 2017-13：4 片 64M×8 + 32 位总线，读 double → 从体 2 起跨 3 轮 = 3 个存储周期',
        run(rt) { rt.setInput('mode', 'il'); rt.setInput('mods', '4'); rt.setInput('unitBits', '8'); rt.setInput('capPer', '64M'); rt.setInput('order', 'low'); rt.setInput('addrIn', '804001AH'); rt.setInput('lenIn', '8'); rt.setInput('seq', ''); rt.load(); } },
      { label: '🎯 2015-18：4 体交叉编址 → 序列里只有 8004 与 8000 同体，构成访存冲突',
        run(rt) { rt.setInput('mode', 'il'); rt.setInput('mods', '4'); rt.setInput('unitBits', '8'); rt.setInput('capPer', '64M'); rt.setInput('order', 'low'); rt.setInput('addrIn', '8004'); rt.setInput('lenIn', '1'); rt.setInput('seq', '8005,8006,8007,8008,8001,8002,8003,8004,8000'); rt.load(); } },
      { label: '📘 高位交叉：8 个体各占一整段连续地址（无并行，只能顺序访问）',
        run(rt) { rt.setInput('mode', 'il'); rt.setInput('mods', '8'); rt.setInput('unitBits', '8'); rt.setInput('capPer', '64M'); rt.setInput('order', 'high'); rt.setInput('addrIn', '0x0018001D'); rt.setInput('lenIn', '8'); rt.setInput('seq', ''); rt.load(); } },
    ],

    parse(vals) {
      return vals.mode === 'il' ? buildIl(vals) : buildPins(vals);
    },

    /* ======================== 渲染（纯渲染，只读 model） ======================== */
    render(ctx) {
      const m = ctx.model, stage = ctx.stage;
      const esc = RC408.util.esc;
      const card = (title, body) =>
        '<div class="rounded-xl bg-white border border-slate-200 px-4 py-3">' +
        RC408.ui.sectionTitle(title) + body + '</div>';

      /* ---------------- 模式① 芯片引脚 ---------------- */
      if (m.mode === 'pins') {
        stage.innerHTML =
          '<div class="space-y-4">' +
          '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
          RC408.ui.statCard('地址线位数', m.k + ' 位',
            '单元数 ' + m.capText + (isPow2(m.cap) ? (' = ' + p2(m.cap)) : '') + ' ⟹ ⌈log₂N⌉', 'text-indigo-600') +
          RC408.ui.statCard('地址引脚', m.addrPins + ' 根',
            m.reuse ? ('复用：max(行 ' + m.pick.rBits + ', 列 ' + m.pick.cBits + ')' + (m.savedPins > 0 ? '，比不复用省 ' + m.savedPins + ' 根' : ''))
              : '不复用：行、列地址各走各的引脚',
            m.reuse ? 'text-emerald-600' : 'text-slate-800') +
          RC408.ui.statCard('数据引脚', m.dataPins + ' 根', '= 数据位宽 ' + m.width + ' 位', 'text-rose-600') +
          RC408.ui.statCard('地址 + 数据引脚合计', m.totalPins + ' 根',
            m.addrPins + ' + ' + m.dataPins + '（题目问的"总数"就是它）', 'text-amber-600') +
          '</div>' +
          card('① 芯片引脚图（左：地址引脚；右：数据引脚）', pinSvg(m, esc)) +
          (m.reuse ? card('② 行列地址分时复用（同一组引脚送两次）', timeBar(m)) : '') +
          card('③ 行 × 列结构备选表（' + m.pairs.length + ' 种：r 取 ' +
            (isPow2(m.cap) ? (p2(m.pairs[0].r) + ' ~ ' + p2(m.pairs[m.pairs.length - 1].r)) : '1') + '）', pairTable(m, esc)) +
          '<div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">' +
          '💡 <b>考点提醒：</b>① <b>地址引脚 = 行、列位数的较大者</b>（复用），不是两者之和、也不是地址位数的一半；' +
          '② 最省引脚的是 <b>r、c 最接近</b>的那一对；位数并列时再取 <b>行数少</b>的（DRAM 按行刷新，行数少 ⟹ 刷新开销小）；' +
          '③ <b>数据引脚只由位宽决定</b>，与容量无关；④ 题目问"地址引脚和数据引脚总数"时把两者相加即可。</div>' +
          '</div>';
        return;
      }

      /* ---------------- 模式② 交叉编址 ---------------- */
      const isLow = m.order === 'low';
      stage.innerHTML =
        '<div class="space-y-4">' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
        RC408.ui.statCard('存储器总线宽度', m.busBits + ' 位', m.m + ' 个体 × ' + m.unitBits + ' 位 = ' + m.busBytes + ' 字节/周期', 'text-indigo-600') +
        RC408.ui.statCard('地址 ' + hex(m.addr, m.pad) + ' 落在', '体 ' + m.body, isLow ? ('体号 = ⌊地址/' + m.bpu + '⌋ mod ' + m.m) : ('体号 = ⌊地址/' + m.segBytes + '⌋（每体 ' + fmtBytes(m.segBytes) + '）'), 'text-amber-600') +
        RC408.ui.statCard('体内' + (isLow ? '块号' : '偏移'), m.inner, isLow ? '同一体内地址相差 ' + m.m + ' 个块' : '距本段首地址 ' + m.inner + ' 字节', 'text-slate-800') +
        RC408.ui.statCard('读取 ' + m.len + ' 字节', m.rounds + ' 个存储周期',
          isLow ? ('跨 ' + m.rounds + ' 轮（块 ' + m.blocks + ' 个）') : ('跨 ' + m.blocks + ' 块，一次访存只命中一个体'), 'text-rose-600') +
        '</div>' +
        card('① ' + m.m + ' 个存储体（琥珀色 = 本次命中的体）', bodyRow(m, esc)) +
        card('② 逐字节落体（' + m.drawnCells + ' / ' + m.len + ' 字节' + (m.cellsTruncated ? '，只画前 ' + CELL_DRAW_MAX + ' 个' : '') + '）', byteRow(m, esc)) +
        card('③ 访存冲突检测（' + (m.seq.length ? m.seq.length + ' 个地址，冲突 ' + m.conflicts + ' 处' : '未填序列') + '）', seqTable(m, esc)) +
        card('④ 带宽（连续读 ' + m.m + ' 个字）', bandwidth(m, esc)) +
        '<div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">' +
        '💡 <b>考点提醒：</b>① 低位交叉的体号就是 <b>地址低位</b>（真题口径下 = 字节地址 mod m）；' +
        '② <b>存储周期数看"跨几轮"</b>，不是"字节数 ÷ 体数"——2017-13 的 8 字节从体 2 起算要 <b>3</b> 个周期；' +
        '③ 只有 <b>整轮对齐</b>时 ⌈L ÷ 每周期字节数⌉ 才碰巧对；④ 高位交叉每个体占一整段连续地址，' +
        '<b>没有并行性</b>（不存在"同体冲突"这种说法）；⑤ 乱序题要用"相邻 m 次访存内出现同一体号"判冲突。</div>' +
        '</div>';
    },

    logs(m) {
      if (m.mode === 'pins') {
        const out = [{
          type: 'info',
          text: '芯片 ' + m.spec + '：单元数 ' + m.cap + ' ⟹ 地址线 ' + m.k + ' 位',
        }];
        if (m.reuse) {
          out.push({ type: 'info', text: '行列复用：' + m.pickSrc + '的行列结构 r = ' + m.pick.r + '、c = ' + m.pick.c + ' ⟹ 行地址 ' + m.pick.rBits + ' 位、列地址 ' + m.pick.cBits + ' 位，共用同一组引脚' });
        } else {
          out.push({ type: 'info', text: '地址不复用：行、列地址各走各的引脚 ⟹ 地址引脚 = 地址线位数 ' + m.k + ' 位' });
        }
        out.push({ type: 'info', text: '地址引脚 ' + m.addrPins + ' 根 + 数据引脚 ' + m.dataPins + ' 根 = 共 ' + m.totalPins + ' 根' });
        out.push({
          type: 'success',
          text: '最省引脚的行列结构是 r = ' + m.reco.r + '、c = ' + m.reco.c + '（地址引脚 ' + m.reco.pins + ' 根）' +
            (m.reco.r !== m.pick.r ? '；当前选的是 r = ' + m.pick.r + '、c = ' + m.pick.c : '（与当前选择一致）'),
        });
        return out;
      }
      const isLow = m.order === 'low';
      const out = [
        { type: 'info', text: m.m + ' 个体 × ' + m.unitBits + ' 位 ⟹ 存储器总线宽度 ' + m.busBits + ' 位 = 一个存储周期取 ' + m.busBytes + ' 字节' },
        { type: 'info', text: (isLow ? '低位交叉' : '高位交叉') + '：地址 ' + hex(m.addr, m.pad) + ' ⟹ 体 ' + m.body + '，体内' + (isLow ? '块号' : '偏移') + ' ' + m.inner },
        { type: 'success', text: '读 ' + m.len + ' 字节 ⟹ ' + m.rounds + ' 个存储周期' + (isLow ? '（跨 ' + m.rounds + ' 轮、' + m.blocks + ' 个块）' : '（一次只命中一个体）') },
      ];
      if (m.seq.length) {
        out.push({
          type: m.conflicts ? 'warn' : 'info',
          text: m.seqChecked
            ? ('序列 ' + m.seq.length + ' 个地址：同体且在相邻 ' + m.m + ' 次访存内 ⟹ 冲突 ' + m.conflicts + ' 处' + (m.conflicts ? '（' + m.seq.filter(s => s.conflict >= 0).map(s => '"' + String(s.addr) + '"与第 ' + (s.conflict + 1) + ' 个').join('、') + '）' : ''))
            : ('序列 ' + m.seq.length + ' 个地址：高位交叉一个体是一整段连续地址，不做"同体冲突"判定'),
        });
      }
      out.push({ type: 'info', text: '带宽：低位交叉 ' + m.bwLow.toFixed(3) + ' 位/ns ≈ ' + (m.bwLow * 125).toFixed(1) + ' MB/s（比顺序存储快 ' + m.speedup.toFixed(2) + ' 倍）；顺序 ' + m.bwSeq.toFixed(3) + ' 位/ns' });
      return out;
    },
  });

  /* ============================ 模式① 的子渲染 ============================ */

  /** 芯片引脚图：芯片本体 + 左侧地址引脚 + 右侧数据引脚（SVG，几何全部写死可断言） */
  function pinSvg(m, esc) {
    const pitch = 20;
    const chipX = 210, chipW = 230;
    const aDraw = Math.min(m.addrPins, PIN_DRAW_MAX);
    const dDraw = Math.min(m.dataPins, PIN_DRAW_MAX);
    const rows = Math.max(aDraw, dDraw, 3);
    const top = 44;
    const firstPinY = top + 46;
    const chipH = Math.max(118, rows * pitch + 66);
    const H = top + chipH + 34;
    const W = 680;
    const fmt = 'font:700 11px Consolas,ui-monospace,monospace';
    let s = '<svg class="mp-svg" data-mp-svg="1" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px;display:block;height:auto">';
    /* 芯片本体 */
    s += '<rect class="mp-chip-body" data-mp-chip="1" x="' + chipX + '" y="' + top + '" width="' + chipW + '" height="' + chipH
      + '" rx="14" fill="#eef2ff" stroke="#6366f1" stroke-width="2.4"/>';
    s += '<text data-mp-chip-spec="' + esc(m.spec) + '" x="' + (chipX + chipW / 2) + '" y="' + (top + 24)
      + '" text-anchor="middle" style="font:800 13px ui-sans-serif,system-ui;fill:#3730a3">' + esc(m.spec) + '</text>';
    s += '<text x="' + (chipX + chipW / 2) + '" y="' + (top + 40)
      + '" text-anchor="middle" style="font:700 10px ui-sans-serif,system-ui;fill:#6366f1">' + m.capText + ' 个单元 · 地址线 ' + m.k + ' 位</text>';
    /* 两侧标题 */
    s += '<text data-mp-addrhead="' + m.addrPins + '" x="' + (chipX - 40) + '" y="' + (top + 8)
      + '" text-anchor="end" style="font:800 11px ui-sans-serif,system-ui;fill:#4338ca">地址引脚 ' + m.addrPins + ' 根</text>';
    s += '<text data-mp-datahead="' + m.dataPins + '" x="' + (chipX + chipW + 40) + '" y="' + (top + 8)
      + '" style="font:800 11px ui-sans-serif,system-ui;fill:#be185d">数据引脚 ' + m.dataPins + ' 根</text>';
    /* 地址引脚（左） */
    for (let i = 0; i < aDraw; i++) {
      const y = firstPinY + i * pitch;
      s += '<path class="mp-pin mp-pin-a" data-mp-pin="a' + i + '" d="M ' + (chipX - 34) + ' ' + y + ' L ' + chipX + ' ' + y
        + '" fill="none" stroke="#4338ca" stroke-width="2.4"/>';
      s += '<text class="mp-pin-label" data-mp-pinlabel="a' + i + '" x="' + (chipX - 40) + '" y="' + (y + 4)
        + '" text-anchor="end" style="' + fmt + ';fill:#4338ca">A' + i + '</text>';
    }
    /* 数据引脚（右） */
    for (let i = 0; i < dDraw; i++) {
      const y = firstPinY + i * pitch;
      s += '<path class="mp-pin mp-pin-d" data-mp-pin="d' + i + '" d="M ' + (chipX + chipW) + ' ' + y + ' L ' + (chipX + chipW + 34) + ' ' + y
        + '" fill="none" stroke="#db2777" stroke-width="2.4"/>';
      s += '<text class="mp-pin-label" data-mp-pinlabel="d' + i + '" x="' + (chipX + chipW + 40) + '" y="' + (y + 4)
        + '" style="' + fmt + ';fill:#be185d">D' + i + '</text>';
    }
    /* 未逐根绘出的引脚 */
    let note = [];
    if (m.addrPins > aDraw) note.push('地址引脚另有 ' + (m.addrPins - aDraw) + ' 根未逐根绘出');
    if (m.dataPins > dDraw) note.push('数据引脚另有 ' + (m.dataPins - dDraw) + ' 根未逐根绘出');
    if (note.length) {
      s += '<text x="' + (W / 2) + '" y="' + (H - 10) + '" text-anchor="middle" style="font:700 10px ui-sans-serif,system-ui;fill:#b45309">'
        + esc(note.join('；')) + '</text>';
    }
    s += '</svg>';
    return s;
  }

  /**
   * 行列地址分时复用条：两段宽度严格正比于位数（只有一段时就铺满）。
   * ⚠ 照 §3.8-18 / §6.2.34⑨：单行 flex、无 gap、box-sizing:border-box ⟹ 离线（无 Tailwind）几何也一样。
   */
  function timeBar(m) {
    const seg = (key, bits, name, sub, bg, radius) => {
      if (bits <= 0) return '';
      return '<div data-mp-tseg="' + key + '" data-mp-tbits="' + bits + '"' +
        ' style="flex:' + bits + ' 1 0;box-sizing:border-box;margin:0;border-right:1px solid #fff;background:' + bg +
        ';border-radius:' + radius + ';padding:6px 2px;text-align:center;color:#fff;overflow:hidden">' +
        '<div style="font-weight:800;font-size:11px;line-height:1.3;white-space:nowrap">' + name + '</div>' +
        '<div style="font-size:10px;line-height:1.3;white-space:nowrap;font-family:Consolas,monospace">' + sub + '</div>' +
        '</div>';
    };
    const rowSeg = seg('row', m.rowBits, '行地址 ' + m.rowBits + ' 位', 'RAS 有效', '#6366f1', '6px 0 0 6px');
    const colSeg = seg('col', m.colBits, '列地址 ' + m.colBits + ' 位', 'CAS 有效', '#0ea5e9', '0 6px 6px 0');
    const total = m.rowBits + m.colBits;
    return '<div data-mp-timebar="1" data-mp-totalbits="' + total + '" data-mp-segs="' + (m.rowBits > 0 ? 1 : 0) + (m.colBits > 0 ? 1 : 0) + '"' +
      ' style="display:flex;width:100%;align-items:stretch">' + rowSeg + colSeg + '</div>' +
      '<div class="mt-2 text-xs text-slate-500">行地址与列地址<b>共用同一组 ' + m.addrPins + ' 根引脚</b>：先送行地址（RAS 有效），再送列地址（CAS 有效）；' +
      '所以引脚数取两者中<b>位数较大的那个</b>，而不是相加。</div>';
  }

  /** 行列备选表：逐行给 r / c / 两个位数 / 地址引脚 / 刷新行数 */
  function pairTable(m, esc) {
    const rows = m.pairs.map(p => {
      const isReco = (p.r === m.reco.r && p.c === m.reco.c);
      const isPick = (p.r === m.pick.r && p.c === m.pick.c);
      const isMin = (p.pins === m.minPins);
      const cls = isPick ? ' bg-amber-50' : (isReco ? ' bg-emerald-50' : '');
      return '<tr data-mp-pair="' + p.r + ',' + p.c + '" data-mp-pairpins="' + p.pins + '"' +
        ' data-mp-reco="' + (isReco ? 1 : 0) + '" data-mp-pick="' + (isPick ? 1 : 0) + '"' +
        ' class="border-b border-slate-100' + cls + '">' +
        '<td class="px-2 py-1 font-mono">' + p2(p.r) + ' = ' + p.r + '</td>' +
        '<td class="px-2 py-1 font-mono">' + p2(p.c) + ' = ' + p.c + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + p.rBits + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + p.cBits + '</td>' +
        '<td class="px-2 py-1 text-right font-mono font-bold ' + (isMin ? 'text-emerald-600' : 'text-slate-700') + '">' +
        (m.reuse ? p.pins : m.k) + (isMin && m.reuse ? ' ←最少' : '') + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + p.r + '</td>' +
        '<td class="px-2 py-1 text-xs text-slate-500">' +
        (isPick && isReco ? '推荐 · 当前选择' : (isPick ? '当前选择' : (isReco ? '推荐' : ''))) + '</td>' +
        '</tr>';
    }).join('');
    const head = '<table data-mp-pairtable="1" class="w-full text-sm"><thead><tr class="text-[11px] text-slate-400">' +
      '<th class="px-2 py-1 text-left">行数 r</th><th class="px-2 py-1 text-left">列数 c</th>' +
      '<th class="px-2 py-1 text-right">行地址位数</th><th class="px-2 py-1 text-right">列地址位数</th>' +
      '<th class="px-2 py-1 text-right">地址引脚</th><th class="px-2 py-1 text-right">刷新行数</th>' +
      '<th class="px-2 py-1 text-left">说明</th></tr></thead><tbody>';
    return head + rows + '</tbody></table>' +
      '<div class="mt-2 text-xs text-slate-500">r × c = ' + m.capText + '（共 ' + m.pairs.length + ' 种 2 的幂分法）。' +
      (m.reuse ? '地址引脚 = max(行地址位数, 列地址位数) ⟹ <b>两个位数越接近越省</b>；并列时取行数少的。'
        : '地址不复用 ⟹ 地址引脚恒为地址线位数 ' + m.k + ' 位，与 r、c 无关。') + '</div>';
  }

  /* ============================ 模式② 的子渲染 ============================ */

  /** 体一览：m 个方块排成一行（多的时候换行），命中的体琥珀色 */
  function bodyRow(m, esc) {
    const blocks = m.bodies.map(b => {
      const hit = b.i === m.body;
      const col = BODY_COLORS[b.i % BODY_COLORS.length];
      return '<div data-mp-body="' + b.i + '" data-mp-bodyhit="' + (hit ? 1 : 0) + '"' +
        ' style="flex:1 1 0;min-width:78px;box-sizing:border-box;margin:0;border:2px solid ' + (hit ? '#f59e0b' : col) +
        ';background:' + (hit ? '#fef3c7' : '#f8fafc') + ';border-radius:10px;padding:7px 4px;text-align:center;overflow:hidden">' +
        '<div style="font-weight:800;font-size:12px;color:' + (hit ? '#b45309' : '#1e293b') + '">体 ' + b.i + '</div>' +
        '<div style="font-size:10px;color:#64748b;font-family:Consolas,monospace;line-height:1.35;word-break:break-all">' +
        esc(b.kind === 'low' ? b.text : b.text) + '</div>' +
        '<div style="font-size:10px;color:#94a3b8;line-height:1.3">' + (b.kind === 'low' ? ('首字节 ' + hex(b.start, m.pad)) : '') + '</div>' +
        '</div>';
    }).join('');
    return '<div data-mp-bodyrow="1" data-mp-bodies="' + m.m + '" data-mp-hitbody="' + m.body + '"' +
      ' style="display:flex;flex-wrap:wrap;gap:6px;width:100%">' + blocks + '</div>' +
      '<div class="mt-2 text-xs text-slate-500">' +
      (m.order === 'low'
        ? ('低位交叉：' + m.m + ' 个体轮流接连续的 ' + m.bpu + ' 字节块 ⟹ 一个存储周期里 ' + m.m + ' 个体<b>并行</b>各送一块。')
        : ('高位交叉：每个体占 <b>' + fmtBytes(m.segBytes) + '</b> 一整段连续地址，同一时刻只有一个体能被访问。')) +
      '</div>';
  }

  /** 逐字节落体：每个字节一格，标出体号与轮号 */
  function byteRow(m, esc) {
    const cells = m.cells.map(c => {
      const col = BODY_COLORS[c.body % BODY_COLORS.length];
      return '<div data-mp-cell="' + c.j + '" data-mp-cellbody="' + c.body + '" data-mp-cellround="' + c.round + '"' +
        ' style="width:44px;box-sizing:border-box;margin:0;border:1px solid ' + col + ';background:' + col +
        ';border-radius:6px;padding:3px 1px;text-align:center;color:#fff;overflow:hidden">' +
        '<div style="font-weight:800;font-size:11px;line-height:1.25">体' + c.body + '</div>' +
        '<div style="font-size:9px;line-height:1.25;font-family:Consolas,monospace">' + (m.order === 'low' ? ('第' + (c.round + 1) + '轮') : '—') + '</div>' +
        '</div>';
    }).join('');
    return '<div data-mp-cellrow="1" data-mp-cells="' + m.cells.length + '" data-mp-rounds="' + m.rounds + '"' +
      ' style="display:flex;flex-wrap:wrap;gap:4px;width:100%">' + cells + '</div>' +
      '<div class="mt-2 text-xs text-slate-600">读 <b>' + m.len + '</b> 字节（' + hex(m.addr, m.pad) + ' 起）⟹ ' +
      (m.order === 'low'
        ? ('跨 <b>' + m.rounds + '</b> 轮，每轮把 ' + m.m + ' 个体各取一块（' + m.busBytes + ' 字节）⟹ <b>' + m.rounds + ' 个存储周期</b>。')
        : ('跨 <b>' + m.blocks + '</b> 个块，每次只命中一个体 ⟹ <b>' + m.rounds + ' 个存储周期</b>。')) +
      (m.cellsTruncated ? ' <span class="text-amber-600">（逐字节图只画了前 ' + CELL_DRAW_MAX + ' 个）</span>' : '') + '</div>';
  }

  /** 访存冲突检测表 */
  function seqTable(m, esc) {
    if (!m.seq.length) {
      return '<div data-mp-seqtable="0" class="text-sm text-slate-500">没有填访存地址序列 —— 填上（逗号分隔）就会逐个算体号并标出同体冲突。</div>';
    }
    const rows = m.seq.map(s => {
      const bad = s.conflict >= 0;
      return '<tr data-mp-seq="' + s.i + '" data-mp-seqbody="' + s.body + '" data-mp-seqbad="' + (bad ? 1 : 0) + '"' +
        ' class="border-b border-slate-100' + (bad ? ' bg-rose-50' : '') + '">' +
        '<td class="px-2 py-1 font-mono">' + (s.i + 1) + '</td>' +
        '<td class="px-2 py-1 font-mono">' + hex(s.addr, m.pad) + '</td>' +
        '<td class="px-2 py-1 font-mono">' + s.addr + '</td>' +
        '<td class="px-2 py-1 text-right font-mono font-bold">' + s.body + '</td>' +
        '<td class="px-2 py-1 text-xs ' + (bad ? 'text-rose-600 font-bold' : 'text-slate-500') + '">' +
        (bad ? ('与第 ' + (s.conflict + 1) + ' 个同体，相隔 ' + (s.i - s.conflict) + ' &lt; m = ' + m.m + ' ⟹ 冲突') : '—') + '</td>' +
        '</tr>';
    }).join('');
    const head = '<table data-mp-seqtable="1" class="w-full text-sm"><thead><tr class="text-[11px] text-slate-400">' +
      '<th class="px-2 py-1 text-left">次序</th><th class="px-2 py-1 text-left">地址</th>' +
      '<th class="px-2 py-1 text-left">十进制</th><th class="px-2 py-1 text-right">体号</th>' +
      '<th class="px-2 py-1 text-left">冲突判定</th></tr></thead><tbody>';
    const foot = '</tbody></table>';
    const note = !m.seqChecked
      ? '<div class="mt-2 text-xs text-slate-500">当前是<b>高位交叉</b>：每个体是一整段连续地址，不存在"同体冲突"这种说法（代价是没有并行性）。</div>'
      : (m.conflicts
        ? '<div data-mp-conflicts="' + m.conflicts + '" class="mt-2 text-xs text-rose-600">共 <b>' + m.conflicts + '</b> 处冲突：体号相同、且两次访存<b>相隔不到 m = ' + m.m + '</b> 次 ⟹ 后一次要等前一次用完这个体。</div>'
        : '<div data-mp-conflicts="0" class="mt-2 text-xs text-emerald-600">共 0 处冲突：没有任何一个体号在相邻 ' + m.m + ' 次访存里出现两次。</div>');
    return head + rows + foot + note;
  }

  /** 带宽卡片 */
  function bandwidth(m, esc) {
    const line = (name, val, sub, cls) =>
      '<div style="display:flex;align-items:baseline;gap:8px;padding:3px 0">' +
      '<span style="font-size:12px;color:#475569;min-width:150px">' + name + '</span>' +
      '<span class="font-mono font-bold ' + cls + '" style="font-size:13px">' + val + '</span>' +
      '<span style="font-size:11px;color:#94a3b8">' + sub + '</span></div>';
    return '<div data-mp-bw="1" data-mp-bwlow="' + m.bwLow.toFixed(4) + '" data-mp-bwseq="' + m.bwSeq.toFixed(4) + '" data-mp-speedup="' + m.speedup.toFixed(4) + '">' +
      line('低位交叉（连续读 m 个字）', m.bwLow.toFixed(3) + ' 位/ns', '≈ ' + (m.bwLow * 125).toFixed(1) + ' MB/s', 'text-emerald-600') +
      line('顺序存储（不走交叉）', m.bwSeq.toFixed(3) + ' 位/ns', '≈ ' + (m.bwSeq * 125).toFixed(1) + ' MB/s', 'text-slate-600') +
      '<div class="mt-1.5 text-xs text-slate-600 leading-relaxed">' +
      '低位交叉读满一轮耗时 <b>T + (m−1)·r = ' + m.T + ' + ' + (m.m - 1) + '×' + m.rBus + ' = ' + m.tLow + ' ns</b>' +
      '，这一段取到 <b>' + (m.m * m.busBits) + ' 位</b> ⟹ 带宽 ' + m.bwLow.toFixed(3) + ' 位/ns；' +
      '顺序存储只有 W/T = ' + m.busBits + '/' + m.T + ' = ' + m.bwSeq.toFixed(3) + ' 位/ns ⟹ 交叉后快 <b>' + m.speedup.toFixed(2) + ' 倍</b>。' +
      '<br>理想上限是 W/r = ' + m.busBits + '/' + m.rBus + ' = ' + (m.busBits / m.rBus).toFixed(3) + ' 位/ns（要求 m ≥ T/r = ' + (m.T / m.rBus).toFixed(2) + '，当前 m = ' + m.m + '）。' +
      '</div></div>';
  }
})();
