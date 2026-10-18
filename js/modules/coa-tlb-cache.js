'use strict';
/* ============================================================================
 * coa-tlb-cache —— Cache · TLB · 页表命中关系（一次访存沿四级逐级判定）
 * ----------------------------------------------------------------------------
 * ① 数据模型（单位与口径）
 *   · 虚拟地址 / 物理地址按**字节**编址；页大小 pageSize 与 Cache 行大小 lineSize 都取 2 的幂。
 *   · 虚拟地址 = 虚页号 VPN ‖ 页内偏移；物理地址 = 页框号 PPN ‖ 页内偏移（偏移位数两者相同）。
 *   · 主存块号 = PPN × (页大小 ÷ 行大小) + 块内号；块内偏移位数 = log2(行大小)。
 *   · TLB 与 Cache 都是**组相联**：组号取地址低位、标记取余下高位；TLB 查**虚页号**、Cache 查**主存块号**。
 *     组数 = 表项数 ÷ 路数；选组用「组号 = (量 ÷ 组内粒度) mod 组数」。
 *   · 访存次数计数口径（可切换，见输入项 `tlbAccess`）：
 *       查 TLB（在 CPU 内）不计；TLB 缺失 ⟹ 查主存页表 +1；Cache 缺失 ⟹ 取主存块 +1；两者都不缺 ⟹ 取数据本身 +1。
 *       缺页时**只算"查页表"这一次**：数据在磁盘上、基线那次取数据不发生（调页是访磁盘，不计入访存次数）。
 *     `mem` 只累加**真实发生的访存** ⟹ 每条地址的 `memThis = 本条结束时的 mem − 本条开始时的 mem`，
 *     于是"各条之和 = 末帧总账"恒成立（窗56 踩过三次：另写公式 / 先加后减 / 事后修正，都会破这条恒等式）。
 *   · initTLB / initCache 只规定**初始内容**，不规定结果：所有命中 / 缺失都由本文件逐条算出来。
 *   · 预置内容装不下（初始 TLB 项 > 容量、初始 Cache 块 > 容量）就**装到满为止**，不报错（日志里点明）。
 *
 * ② 逐帧结构（stepper）
 *   每个虚拟地址 = 4 帧：tlb（查 TLB）→ pt（查页表）→ ca（查 Cache）→ sum（本条小结）；
 *   外加首帧 init 与末帧 done ⟹ **总帧数 = 1 + 4n + 1**。跳过的阶段也会 push 一帧（标 skipped），
 *   这样"第 i 条地址的第 k 个阶段"恒为 `1 + 4i + k`，冒烟与 harness 的下标可现算、不必猜。
 *
 * ③ 不变量（冒烟逐帧断言的对象）
 *   · I1 阶段序：任一访问的 4 帧顺序恒为 tlb → pt → ca → sum；TLB 命中 ⟹ pt 帧必为 skipped。
 *   · I2 依赖链（2010-17 的四条判据，这四条就是模块的语义等价物）：
 *        TLB 命中 ⟹ 页必命中；Cache 命中 ⟹ 页必命中；缺页 ⟹ TLB 必缺失；缺页 ⟹ Cache 必缺失。
 *   · I3 计数：`mem` 只增不减，且第 i 条 sum 帧的 mem − 第 i 条 tlb 帧之前的 mem = 1 + 查页表 + 缺页 + 缺块。
 *   · I4 快照全量：每条记录的所有字段都在快照里，render 只读快照，绝不读 buildSnapshots 外层变量。
 *   · I5 末帧可行性表的"可发生 / 不可能"由 I2 现算，不是写死的答案。
 * ========================================================================== */
RC408.registerModule({
  id: 'coa-tlb-cache',
  mode: 'stepper',
  title: 'Cache · TLB · 页表命中关系（一次访存沿四级逐级判定）',

  theory: `
> **为什么要有它**：一次访存要穿过 TLB、页表、Cache 三层"复印件"，四者（含主存）命中与否互相牵制。考题不问你算得快不快，只问**哪些组合在物理上讲不通**——2010-17 就是四选一里挑出"不可能发生"的那一种。
> **怎么实现**：CPU 发虚拟地址 → 先查 **TLB**（在 CPU 内，存"虚页号 → 页框号"）→ 缺失才查**主存里的页表**并把表项回填 TLB → 用页框号拼出物理地址 → 最后查 **Cache**（存的是主存块的副本）→ 缺失才取主存块。
> **记住什么**：**Cache 命中 ⟹ 该页必在主存 ⟹ 页表项有效**（2010-17 的 A、B 两个选项就靠这一条判）；**缺页 ⟹ TLB 里一定没有该页表项、也谈不上访 Cache**（解析原话）；**TLB 未命中不等于缺页**（可能只是表项被换出去了）。

## 四层各存什么：一句话分清

| 层次 | 存在哪 | 存的是什么 | 谁来填 |
| --- | --- | --- | --- |
| TLB（快表） | CPU 内，速度最快、容量最小 | **页表项的副本**：虚页号标记 + 页框号 + 有效位 | 硬件在 TLB 缺失时自动查页表回填 |
| 页表 | 主存，由操作系统维护 | 每一虚页的**页框号 + 有效位**（页在主存才有效） | 操作系统在缺页时调入并改写 |
| Cache | CPU 与主存之间 | **主存块的副本**（按物理地址索引） | 硬件在 Cache 缺失时从主存取块 |
| 主存 | 内存条 | 数据本身 | —— |

## 一次访存的固定顺序

1. **查 TLB**：从虚页号里取标记与组号，只有"标记相等且有效位为 1"才算命中；命中直接拿到页框号；
2. **查页表**（仅当 TLB 缺失）：用虚页号索引页表，有效位为 1 才拿到页框号，并**回填 TLB**；有效位为 0 就是**缺页**，要从磁盘调页；
3. **拼物理地址**：页框号 ‖ 页内偏移（偏移位数两者相同，直接搬过来）；
4. **查 Cache**（仅当页在主存）：用主存块号取组号与标记，命中就取走数据；缺失才访问主存取回整块。

## 四条依赖关系（2010-17 的全部判据）

- **TLB 命中 ⟹ 页必命中**：TLB 存的就是页表项的副本，能命中说明该页表项有效、页已经在主存；
- **Cache 命中 ⟹ 页必命中**：Cache 装的是主存块的副本，块在主存就说明它所属的页在主存（解析原话："其所在页面必然已调入主存"）；
- **缺页 ⟹ TLB 必缺失**：页都不在主存，TLB 里当然没有它的表项；
- **缺页 ⟹ 谈不上 Cache 是否命中**：解析明确提示这一点，所以"Page 未命中 + Cache 命中"这一类组合一律不可能。

反过来**不成立**的三条最容易失分：TLB 未命中**不等于**缺页（可能只是表项被换出，页仍在主存）；页命中时 TLB 未必命中；Cache 未命中与 TLB、页表命中与否**没有任何关系**。

## 2010-17 的四个选项逐个判

| 选项 | 组合 | 判定 | 依据 |
| --- | --- | --- | --- |
| A | TLB 未命中，Cache 未命中，Page 未命中 | 可发生 | 缺页现场：TLB 必缺失、Cache 必缺失，三者恰好都缺 |
| B | TLB 未命中，Cache 命中，Page 命中 | 可发生 | 页在主存且块已进 Cache，只是 TLB 表项被换出去了 |
| C | TLB 命中，Cache 未命中，Page 命中 | 可发生 | 最平常的一次访存：地址转换命中，数据块没在 Cache 里 |
| D | TLB 命中，Cache 命中，Page 未命中 | **不可能** | TLB 命中 ⟹ 页表项有效 ⟹ 页必在主存，与"Page 未命中"矛盾 |

因此答案是 **D**。判 D 最快的一条路是反过来念：**只要页不在主存，TLB 里就不可能有它的表项，也就不会有 TLB 命中**。

## 访存次数怎么数

默认口径（TLB 在 CPU 内，查它不算访存）：**访存次数 = 1 + 查页表 + 缺页 + 缺块**。那个恒定的 1 是"用物理地址去查 Cache / 取主存"这一次；TLB 缺失额外查一次主存页表，缺页额外访一次磁盘，Cache 缺失额外取一次主存块。所以：TLB 命中且 Cache 命中 = 1 次；TLB 缺失但页命中、Cache 命中 = 2 次；两者都缺 = 3 次；缺页 = 4 次（还要调页）。

## 考点提醒（易错点）

1. **TLB 未命中 ≠ 缺页**：前者只是"页表项没在 TLB 里"，查一次页表就能补上；后者是"页不在主存"，要访问磁盘。本模块把两件事分成两帧，就是为了把它们分开看。
2. **Cache 的标记来自物理地址**，不是虚拟地址；TLB 的标记来自虚页号。两者用同一套组相联算法，但输入的量不同。
3. **Cache 缺失不由 MMU 检测**：MMU 只管 TLB 缺失、缺页、越权；Cache 缺失发生在拿到物理地址之后。
4. **页表项有效位为 0 时，页框号字段是无效的**，不要拿它去拼物理地址。
5. 组相联的两步容易漏第一步：**先算组数 = 表项数 ÷ 路数**，再"标记位数 = 总位数 − 组号位数"；只算标记忘了组号是常见错法。
6. **组相联 TLB 切的是"虚页号"，不是完整虚拟地址**：先扣掉页内偏移，剩下的虚页号再切成 **Tag（高位）+ 组号（低 log₂组数 位）**；2024-17 的 32 项 4 路 ⟹ 8 组 ⟹ 组号 3 位，页 1KB ⟹ 偏移 10 位，Tag = 32 − 10 − 3 = 19 位。拿完整虚拟地址去切、或忘了先扣偏移，都会差出好几位。

> **真题考情**：**1/18 年（选 1）**：2010-17（同时具有 TLB 与 Cache 时，一次访存中不可能发生的命中组合，答 D）。
`,

  inputs: [
    { key: 'seq', label: '虚拟地址序列（十六进制，逗号或空格分隔，2 ~ 6 个）', type: 'text', wide: true,
      default: '0x00000000, 0x00000040, 0x00010000',
      help: '上限 0xFFFFFFFF；演示顺序就是访存顺序。⚠ 虚页号要在下面"页表初始有效位"的位数以内' },
    { key: 'pageSize', label: '页大小', type: 'select', default: '4096',
      options: [
        { v: '256', t: '256 B' }, { v: '512', t: '512 B' }, { v: '1024', t: '1 KB' },
        { v: '2048', t: '2 KB' }, { v: '4096', t: '4 KB' }, { v: '8192', t: '8 KB' },
      ],
      help: '页内偏移位数 = log₂(页大小)，虚实两个地址的偏移位数相同' },
    { key: 'lineSize', label: 'Cache 行大小', type: 'select', default: '64',
      options: [
        { v: '16', t: '16 B' }, { v: '32', t: '32 B' }, { v: '64', t: '64 B' }, { v: '128', t: '128 B' },
      ],
      help: '一行 = 一个主存块；块内偏移位数 = log₂(行大小)' },
    { key: 'tlbsets', label: 'TLB 组数', type: 'select', default: '4',
      options: [
        { v: '1', t: '1 组（全相联）' }, { v: '2', t: '2 组' }, { v: '4', t: '4 组' }, { v: '8', t: '8 组' },
      ] },
    { key: 'tlbways', label: 'TLB 每组路数', type: 'select', default: '2',
      options: [
        { v: '1', t: '1 路（直接映射）' }, { v: '2', t: '2 路' }, { v: '4', t: '4 路' },
      ],
      help: 'TLB 容量 = 组数 × 路数；选组用「组号 = 虚页号 mod 组数」，标记 = 虚页号高位' },
    { key: 'cachesets', label: 'Cache 组数', type: 'select', default: '16',
      options: [
        { v: '4', t: '4 组' }, { v: '8', t: '8 组' }, { v: '16', t: '16 组' }, { v: '32', t: '32 组' },
      ] },
    { key: 'cacheways', label: 'Cache 每组路数', type: 'select', default: '1',
      options: [
        { v: '1', t: '1 路（直接映射，最直观）' }, { v: '2', t: '2 路' }, { v: '4', t: '4 路' },
      ],
      help: 'Cache 容量 = 组数 × 路数 × 行大小；组内满了按先进先出替换' },
    { key: 'initTLB', label: '初始驻留在 TLB 里的虚页号', type: 'text',
      default: '0',
      help: '逗号分隔；留空 = TLB 初始为空（考场上最坏的冷启动）' },
    { key: 'initPTE', label: '页表初始有效位（按虚页号 0,1,2,… 顺序）', type: 'text', wide: true,
      default: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
      help: '1 = 页在主存（页表项有效），0 = 缺页；位数为 N 时只能演示虚页号 < N 的地址' },
    { key: 'initCache', label: '初始驻留在 Cache 里的主存块号', type: 'text',
      default: '0',
      help: '逗号分隔；留空 = Cache 初始为空' },
    { key: 'tlbAccess', label: '查 TLB 是否计入访存次数', type: 'select', default: 'off',
      options: [
        { v: 'off', t: '不计（TLB 在 CPU 内，主流教材口径）' },
        { v: 'on', t: '计入（每次访存先 +1）' },
      ],
      help: '换成"计入"可以直观看到它会把每条地址的访存次数整体抬高 1' },
  ],

  quickActions: [
    { label: '🎯 2010-17 真题（TLB 命中 + Cache 命中 + Page 未命中 ⟹ 不可能）', run(rt) {
      rt.setInput('seq', '0x00000000, 0x00000040, 0x00000080');
      rt.setInput('pageSize', '4096'); rt.setInput('lineSize', '64');
      rt.setInput('tlbsets', '4'); rt.setInput('tlbways', '2');
      rt.setInput('cachesets', '16'); rt.setInput('cacheways', '1');
      rt.setInput('initTLB', '0'); rt.setInput('initPTE', '1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1'); rt.setInput('initCache', '0');
      rt.setInput('tlbAccess', 'off'); rt.load();
    } },
    { label: '冷启动：TLB 与 Cache 都是空的（看清每次缺失）', run(rt) {
      rt.setInput('seq', '0x00000000, 0x00000040, 0x00000000, 0x00010000');
      rt.setInput('initTLB', ''); rt.setInput('initPTE', '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1'); rt.setInput('initCache', '');
      rt.setInput('pageSize', '4096'); rt.setInput('lineSize', '64');
      rt.setInput('tlbsets', '4'); rt.setInput('tlbways', '2');
      rt.setInput('cachesets', '16'); rt.setInput('cacheways', '1');
      rt.setInput('tlbAccess', 'off'); rt.load();
    } },
    { label: 'TLB 未命中但页命中（不是缺页！查一次页表就补上）', run(rt) {
      rt.setInput('seq', '0x00000000, 0x00000004, 0x00000080');
      rt.setInput('initTLB', ''); rt.setInput('initPTE', '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1'); rt.setInput('initCache', '0');
      rt.setInput('pageSize', '4096'); rt.setInput('lineSize', '64');
      rt.setInput('tlbsets', '4'); rt.setInput('tlbways', '2');
      rt.setInput('cachesets', '16'); rt.setInput('cacheways', '1');
      rt.setInput('tlbAccess', 'off'); rt.load();
    } },
    { label: '缺页：页不在主存 ⟹ TLB 必缺失、Cache 必然谈不上', run(rt) {
      rt.setInput('seq', '0x00000000, 0x00001000, 0x00000000');   // 0x1000 = 虚页号 1，而 ptes[1] 的有效位是 0
      rt.setInput('initTLB', '0'); rt.setInput('initPTE', '1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1'); rt.setInput('initCache', '0');
      rt.setInput('pageSize', '4096'); rt.setInput('lineSize', '64');
      rt.setInput('tlbsets', '4'); rt.setInput('tlbways', '2');
      rt.setInput('cachesets', '16'); rt.setInput('cacheways', '1');
      rt.setInput('tlbAccess', 'off'); rt.load();
    } },
    { label: '两路组相联（同组两个块都能留住，不再互相替换）', run(rt) {
      rt.setInput('seq', '0x00000000, 0x00000100, 0x00000000, 0x00000100');
      rt.setInput('pageSize', '4096'); rt.setInput('lineSize', '64');
      rt.setInput('tlbsets', '4'); rt.setInput('tlbways', '2');
      rt.setInput('cachesets', '16'); rt.setInput('cacheways', '2');
      rt.setInput('initTLB', '0'); rt.setInput('initPTE', '1,1'); rt.setInput('initCache', '0');
      rt.setInput('tlbAccess', 'off'); rt.load();
    } },
  ],
  parse(vals) {
    const seq = _tlHexList(vals.seq);
    if (!seq.length) throw { message: '请填写虚拟地址序列，如 0x00000000, 0x00000004' };
    if (seq.length < 2) throw { message: '至少要 2 个虚拟地址（现在 ' + seq.length + ' 个）' };
    if (seq.length > 6) throw { message: '最多演示 6 个虚拟地址（现在 ' + seq.length + ' 个）' };

    const pageSize = Number(vals.pageSize);
    const lineSize = Number(vals.lineSize);
    _tlPow2(pageSize, '页大小'); _tlPow2(lineSize, 'Cache 行大小');
    if (lineSize > pageSize) throw { message: 'Cache 行大小（' + lineSize + ' B）不能大于页大小（' + pageSize + ' B）' };

    const tlbSets = Number(vals.tlbsets), tlbWays = Number(vals.tlbways);
    const cacheSets = Number(vals.cachesets), cacheWays = Number(vals.cacheways);
    _tlPow2(tlbSets, 'TLB 组数'); _tlPow2(cacheSets, 'Cache 组数');
    if (!(tlbWays >= 1 && tlbWays <= 4) || !(cacheWays >= 1 && cacheWays <= 4)) throw { message: '每组路数只能取 1 ~ 4' };

    const bits = _tlBits({ pageSize: pageSize, lineSize: lineSize, tlbSets: tlbSets, cacheSets: cacheSets });

    const tlbEntries = _tlTlbInit(vals.initTLB, tlbSets, tlbWays);
    const ptes = _tlPteInit(vals.initPTE, bits.vpnBits);
    const cacheBlocks = _tlCacheInit(vals.initCache, cacheSets, cacheWays);

    return {
      seq: seq, pageSize: pageSize, lineSize: lineSize,
      tlbSets: tlbSets, tlbWays: tlbWays, cacheSets: cacheSets, cacheWays: cacheWays,
      tlbEntryList: tlbEntries.list, tlbFull: tlbEntries.full,
      ptes: ptes, cacheBlockList: cacheBlocks.list, cacheFull: cacheBlocks.full,
      tlbAccess: vals.tlbAccess === 'on',
      bits: bits,
    };
  },

  buildSnapshots(model) {
    const m = model;
    const snaps = [];
    const push = (step, o) => snaps.push(Object.assign({
      step: step, log: '', logType: 'info', desc: '', cum: 0, mem: 0,
      tlbHitN: 0, tlbMissN: 0, pageMissN: 0, blockMissN: 0, tlbAccessN: 0,
    }, o));

    /* ---- 运行态（只在本函数内使用；每帧把它拷进快照）---- */
    /* ⚠ 运行态必须**照抄**初始表项的 v（空位 v=0）：这里写成 `v: 1` 会把所有空位当成有效项，
       ⟹ 冷启动的 Cache/TLB 会在第一帧就"什么都命中"、填充逻辑也永不触发（窗56 实测：预设逐条次数整排错）。 */
    const tlb = m.tlbEntryList.map(e => ({ tag: e.tag, ppn: e.ppn, v: e.v }));
    const ptes = m.ptes.map(p => ({ v: p.v, ppn: p.ppn }));
    const cache = m.cacheBlockList.map(b => ({ tag: b.tag, blk: b.blk, v: b.v }));
    /* 计数：★ 起点必须在**本条任何自增之前**取（窗56 实测：起点取在"查 TLB 那次自增之后"，
       会让每条的 memThis 恒少 1，而"各条之和 = 末帧总账"这条判据当场变红）。
       `bump()` 是唯一自增入口，带 `__TLDBG` 取证开关：`node -e "global.__TLDBG=1; …"` 能看到每一次自增。 */
    let mem = 0, tlbHitN = 0, tlbMissN = 0, pageMissN = 0, blockMissN = 0, tlbAccessN = 0;
    let memFrom = 0, gI = -1;
    const bump = (why) => {
      mem++;
      if (typeof window !== 'undefined' && window.__TLDBG) console.log('DBGBUMP ' + why + ' i=' + gI + ' → mem=' + mem);
    };

    const B = m.bits;
    const snapState = () => ({
      tlb: tlb.map(e => ({ tag: e.tag, ppn: e.ppn, v: e.v })),
      ptes: ptes.map(p => ({ v: p.v, ppn: p.ppn })),
      cache: cache.map(b => ({ tag: b.tag, blk: b.blk, v: b.v })),
      mem: mem, tlbHitN: tlbHitN, tlbMissN: tlbMissN, pageMissN: pageMissN,
      blockMissN: blockMissN, tlbAccessN: tlbAccessN,
    });

    const initLog = '初始状态：TLB 已驻留 ' + m.tlbEntryList.length + '/' + (m.tlbSets * m.tlbWays)
      + ' 项，页表给到虚页号 0 ~ ' + (ptes.length - 1) + '，Cache 已驻留 ' + m.cacheBlockList.length + '/'
      + (m.cacheSets * m.cacheWays) + ' 块' + (m.tlbAccess ? '；本设置把查 TLB 也计入访存次数' : '；查 TLB 不计入访存次数');
    push('init', Object.assign(snapState(), {
      step: 'init', visit: -1, i: -1, desc: '准备阶段：' + initLog,
      log: initLog, logType: 'info',
    }));
    if (m.tlbFull) push('init', Object.assign(snapState(), {
      step: 'init', visit: -1, i: -1, desc: '提示：初始 TLB 列表比容量长，已只装前 ' + (m.tlbSets * m.tlbWays) + ' 项。',
      log: '提示：初始 TLB 列表比容量长，已只装前 ' + (m.tlbSets * m.tlbWays) + ' 项', logType: 'warn',
    }));
    if (m.cacheFull) push('init', Object.assign(snapState(), {
      step: 'init', visit: -1, i: -1, desc: '提示：初始 Cache 块列表超过容量，已只装前 ' + (m.cacheSets * m.cacheWays) + ' 块。',
      log: '提示：初始 Cache 块列表超过容量，已只装前 ' + (m.cacheSets * m.cacheWays) + ' 块', logType: 'warn',
    }));

    const records = [];
    m.seq.forEach((va, i) => {
      gI = i;
      memFrom = mem;                             // ★ 本条起点：必须在下面任何自增之前（含"查 TLB"那一次）
      const vpn = B.vpnBits === 0 ? 0 : Math.floor(va / m.pageSize);
      const pageOff = va % m.pageSize;
      const tlbSet = B.tlbSetBits === 0 ? 0 : vpn % m.tlbSets;
      const tlbTag = B.tlbTagBits === 0 ? 0 : Math.floor(vpn / m.tlbSets);

      /* ---------- 第 1 帧：查 TLB ---------- */
      let tlbHitIdx = -1;
      for (let w = 0; w < tlb.length; w++) {
        const e = tlb[tlbSet * m.tlbWays + w];
        if (e && e.v === 1 && e.tag === tlbTag) { tlbHitIdx = w; break; }
      }
      if (m.tlbAccess) { bump('查TLB'); tlbAccessN++; }
      const tlbHit = tlbHitIdx >= 0;
      if (tlbHit) tlbHitN++; else tlbMissN++;

      const r = {
        i: i, va: va, vpn: vpn, pageOff: pageOff, tlbSet: tlbSet, tlbTag: tlbTag,
        tlbWay: tlbHitIdx, tlbHit: tlbHit, ptHit: null, ppn: null, pageMiss: null,
        pa: null, blk: null, blkOff: null, cacheSet: null, cacheTag: null, cacheWay: null,
        cacheHit: null, tlbFill: false, tlbFillWay: null, tlbReplacedTag: null,
        cacheFill: false, cacheFillWay: null, cacheReplacedBlk: null,
        memThis: 0, tlbAccessThis: 0, memFrom: memFrom,
      };
      r.tlbAccessThis = m.tlbAccess ? 1 : 0;
      const tlbDesc = tlbHit
        ? '第 ' + (i + 1) + ' 条：虚页号 ' + vpn + '（0x' + vpn.toString(16).toUpperCase() + '）落在 TLB 第 ' + tlbSet + ' 组，第 ' + (tlbHitIdx + 1) + ' 路的标记与它相等 ⟹ TLB 命中，直接取出页框号 ' + tlb[tlbSet * m.tlbWays + tlbHitIdx].ppn + '，不需要查页表。'
        : '第 ' + (i + 1) + ' 条：虚页号 ' + vpn + ' 取标记 ' + tlbTag + ' 去查 TLB 第 ' + tlbSet + ' 组，' + m.tlbWays + ' 路里没有一路的标记与它相等 ⟹ TLB 缺失，必须去主存查页表。';
      push('tlb', Object.assign(snapState(), r, {
        step: 'tlb', visit: i, desc: tlbDesc, log: tlbDesc, logType: tlbHit ? 'info' : 'warn',
        cum: mem,
      }));

      /* ---------- 第 2 帧：查页表（TLB 命中则跳过）---------- */
      let ppn = null, pageMiss = null, ptHit = null;
      if (tlbHit) {
        ppn = tlb[tlbSet * m.tlbWays + tlbHitIdx].ppn;
        r.ppn = ppn; pageMiss = false;                 // TLB 命中 ⟹ 页表项有效 ⟹ 页必在主存（2010-17 的核心依赖）
        const d2 = 'TLB 已命中，页表这一级不需要访问（这一帧是跳过的）—— 注意"TLB 命中"与"页在主存"是两件事，命中本身就说明页表项有效。';
        push('pt', Object.assign(snapState(), r, {
          step: 'pt', visit: i, skipped: true, pageMiss: false, desc: d2, log: d2, logType: 'info', cum: mem, ptHit: null, ppn: ppn,
        }));
        r.pageMiss = false;
      } else {
        bump('查页表',2);
        const pte = ptes[vpn];
        if (!pte) throw { message: '页表里没有虚页号 ' + vpn + ' 的表项：本模块的页表按输入给到虚页号 ' + (ptes.length - 1) + '，请把页表初始有效位多写几位，或把地址改小' };
        if (pte.v === 0) {
          pageMiss = true; pageMissN++;
          const d2 = '第 ' + (i + 1) + ' 条：查主存页表，虚页号 ' + vpn + ' 的有效位是 0 ⟹ **缺页**（页不在主存），页框号字段此刻无效；操作系统要从磁盘把它调进来，这一条不可能命中 Cache。';
          push('pt', Object.assign(snapState(), r, {
            step: 'pt', visit: i, pageMiss: true, skipped: false, desc: d2, log: d2, logType: 'error', cum: mem, ptHit: false, ppn: null,
          }));
          r.pageMiss = true;
        } else {
          pageMiss = false; ptHit = true; ppn = pte.ppn; r.ppn = ppn;
          const d2 = '第 ' + (i + 1) + ' 条：查主存页表，虚页号 ' + vpn + ' 的有效位是 1 ⟹ 页在主存，取出页框号 ' + ppn + '，并把它回填进 TLB 第 ' + tlbSet + ' 组。';
          push('pt', Object.assign(snapState(), r, {
            step: 'pt', visit: i, pageMiss: false, skipped: false, desc: d2, log: d2, logType: 'warn', cum: mem, ptHit: true, ppn: ppn,
          }));
        }
      }

      /* ---------- 第 3 帧：查 Cache ---------- */
      /* ⚠ 本段**不许**再声明 `r` / `hitW` / `frame` 这些已在上一级作用域用过的名字：
         `let`/`const` 是**块级 + 暂时性死区**，同名声明会把整段的读取都变成 TDZ 错误或读到未初始化值
         （窗56 实测两次：`const r` 让 sum 帧字段全 null；`let cacheHit …` 让 Cache 判定恒为"命中"）。 */
      if (pageMiss === true) {
        const d3 = '第 ' + (i + 1) + ' 条：页都不在主存，物理地址根本拼不出来 ⟹ Cache 这一级谈不上命中与否（"缺页时不存在 TLB 命中、页缺失的组合"，也没有 Cache 可查）。';
        push('ca', Object.assign(snapState(), r, {
          step: 'ca', visit: i, skipped: true, pageMiss: true, desc: d3, log: d3, logType: 'error', cum: mem, cacheHit: null, ptHit: ptHit, ppn: null,
        }));
        r.pageMiss = true;
      } else {
        const hit = _tlCacheLookup(cache, r.ppn, pageOff, m, B);   // 独立函数：判定 + 填物理地址，返回值全部写回 r
        r.pa = hit.pa; r.blk = hit.blk; r.blkOff = hit.blkOff;
        r.cacheSet = hit.cacheSet; r.cacheTag = hit.cacheTag; r.cacheWay = hit.way; r.cacheHit = hit.hit;
        r.pageMiss = false;
        if (!r.cacheHit) { bump('取块',3); blockMissN++; }     // 取主存块
        const phys = '物理地址 = 页框号 ' + r.ppn + ' ‖ 页内偏移 ' + pageOff + ' = 0x' + r.pa.toString(16).toUpperCase() + '，主存块号 ' + r.blk;
        const d3 = r.cacheHit
          ? '第 ' + (i + 1) + ' 条：' + phys + '，块号对 ' + m.cacheSets + ' 取模落在 Cache 第 ' + r.cacheSet + ' 组，第 ' + (hit.way + 1) + ' 路的标记相等 ⟹ Cache 命中，取走块内偏移 ' + r.blkOff + ' 处的数据，不再访存。'
          : '第 ' + (i + 1) + ' 条：' + phys + '，块号对 ' + m.cacheSets + ' 取模落在 Cache 第 ' + r.cacheSet + ' 组，' + m.cacheWays + ' 路里没有一路标记相等 ⟹ Cache 缺失，要从主存取回整块（块内偏移 ' + r.blkOff + ' 处的数据），访存次数 +1。';
        push('ca', Object.assign(snapState(), r, {
          step: 'ca', visit: i, skipped: false, pageMiss: false, ptHit: ptHit,
          desc: d3, log: d3, logType: r.cacheHit ? 'info' : 'warn', cum: mem,
        }));
      }

      /* ---------- 第 4 帧：本条小结（这一帧才更新 TLB / Cache 的内容）---------- */
      if (!tlbHit && pageMiss === false) {
        /* 回填：同组里找空路；满了就替换第 1 路（先进先出，行为确定） */
        const base = tlbSet * m.tlbWays;
        let slot = -1;
        for (let w = 0; w < m.tlbWays; w++) if (!tlb[base + w] || tlb[base + w].v === 0) { slot = w; break; }
        let replaced = null;
        if (slot < 0) { slot = 0; replaced = tlb[base + slot].tag; }
        tlb[base + slot] = { tag: tlbTag, ppn: r.ppn, v: 1 };
        r.tlbFill = true; r.tlbFillWay = slot; r.tlbReplacedTag = replaced;
      }
      if (r.cacheHit === false) {
        const base = r.cacheSet * m.cacheWays;
        let slot = -1;
        for (let w = 0; w < m.cacheWays; w++) if (!cache[base + w] || cache[base + w].v === 0) { slot = w; break; }
        let replacedBlk = null;
        if (slot < 0) { slot = 0; replacedBlk = cache[base + slot].blk; }
        cache[base + slot] = { tag: r.cacheTag, blk: r.blk, v: 1 };
        r.cacheFill = true; r.cacheFillWay = slot; r.cacheReplacedBlk = replacedBlk;
      }
      /* ---------- 计数模型（本模块唯一权威口径，别再另写公式）----------
         `mem` 只累加"真实发生的访存"，共四个来源：
           ① 查 TLB：仅当输入把 `tlbAccess` 设为计入（默认不计）        ← 第 1 帧里已加
           ② 查主存页表：仅当 TLB 缺失                                  ← 第 2 帧里已加
           ③ 拿物理地址访一次 Cache / 主存取数据：仅当没有缺页            ← 下面这一行
           ④ 取主存块：仅当 Cache 缺失                                  ← 第 3 帧里已加
         缺页那一条只有 ②（数据在磁盘上，③④ 都不发生；调页是访磁盘，不计入访存次数）。
         `memThis` = 本条起点与本条终点之差 ⟹「各条之和 = 末帧总账」按构造恒成立。
         （窗56 为这一条恒等式踩了三次：另写公式、先加后减、事后修正 —— 都让两边对不上。） */
      r.pageMiss = (pageMiss === true);
      if (!r.pageMiss) bump('基线取数据',4);
      r.memThis = mem - r.memFrom;
      const parts = ['第 ' + (i + 1) + ' 条小结：TLB ' + (tlbHit ? '命中' : '缺失')];
      parts.push(pageMiss === true ? '页缺失（缺页）' : '页命中');
      parts.push(r.cacheHit === null ? 'Cache 无从谈起' : (r.cacheHit ? 'Cache 命中' : 'Cache 缺失'));
      parts.push('本次访存 ' + r.memThis + ' 次（' + (r.tlbAccessThis ? '含查 TLB 1 次；' : '') + '基线取数据 '
        + (pageMiss === true ? 0 : 1) + ' 次 + 查页表 ' + (tlbHit ? 0 : 1) + ' 次 + 缺页调页 '
        + (pageMiss === true ? 1 : 0) + ' 次 + 缺块取块 ' + (r.cacheHit === false ? 1 : 0) + ' 次）');
      if (r.tlbFill) parts.push('TLB 第 ' + tlbSet + ' 组第 ' + (r.tlbFillWay + 1) + ' 路写入虚页号 ' + vpn
        + (r.tlbReplacedTag === null || r.tlbReplacedTag === undefined ? '（该组原有空路，无需替换）' : '（替换掉标记 ' + r.tlbReplacedTag + '）'));
      if (r.cacheFill) parts.push('Cache 第 ' + r.cacheSet + ' 组第 ' + (r.cacheFillWay + 1) + ' 路装入主存块 ' + r.blk
        + (r.cacheReplacedBlk === null || r.cacheReplacedBlk === undefined ? '（该组原有空路，无需替换）' : '（替换掉块 ' + r.cacheReplacedBlk + '）'));
      const d4 = parts.join('；') + '。';
      const cur = snapState();
      push('sum', Object.assign(cur, r, {
        step: 'sum', visit: i, skipped: false, desc: d4, log: d4,
        logType: (pageMiss === true ? 'error' : (r.cacheHit ? 'info' : 'warn')), cum: mem,
        memThis: r.memThis, records: records.length + 1,
      }));

      records.push({
        i: i, va: va, vpn: vpn, pageOff: pageOff, tlbSet: tlbSet, tlbTag: tlbTag,
        tlbHit: tlbHit, pageMiss: pageMiss, ppn: r.ppn, pa: r.pa, blk: r.blk,
        cacheHit: r.cacheHit, memThis: r.memThis, memCum: mem,
      });
    });

    /* ---------- 末帧：总账 + 命中组合可行性表（由依赖关系现算，不写死）---------- */
    const combos = _tlComboTable();
    const nHit = records.filter(x => x.cacheHit === true).length;
    const top = '全部 ' + records.length + ' 条地址访存完毕：累计访存 ' + mem + ' 次；TLB 命中 '
      + tlbHitN + '/' + records.length + '，页缺失（缺页）' + pageMissN + ' 次，Cache 缺失 ' + blockMissN + ' 次（命中 '
      + nHit + '/' + records.length + '）。末帧的"命中组合可行性表"用同一套依赖关系把 8 种组合判了一遍。';
    push('done', Object.assign(snapState(), {
      step: 'done', visit: m.seq.length, i: -1, skipped: false,
      desc: top, log: top, logType: 'info', cum: mem,
      records: records.map(x => Object.assign({}, x)),
      combos: combos,
      memTotal: mem, tlbHitTotal: tlbHitN, tlbMissTotal: tlbMissN,
      pageMissTotal: pageMissN, blockMissTotal: blockMissN, cacheHitTotal: nHit,
      n: records.length,
    }));
    return snaps;
  },

  render(ctx) {
    const s = ctx.snap, stage = ctx.stage;
    const m = ctx.model;
    const U = RC408.util;
    const B = m.bits;
    /* ★ 一律只读快照字段：render 绝不碰 buildSnapshots 外层的作用域变量（那是活动变量，晚绑定会让每帧都显示末态）。 */
    const cur = s.visit;
    const st = s.step;

    const box = (title, body, opt) => {
      const o = opt || {};
      const border = o.active ? '2px solid #f59e0b' : '1px solid ' + (o.dim ? '#eef2f7' : '#e2e8f0');
      const bg = o.active ? '#fffbeb' : (o.dim ? '#fcfdff' : '#fff');
      const op = o.dim ? 'opacity:.55;' : '';
      return '<div class="tl-stage-card" data-st="' + U.esc(title) + '" style="' + op
        + 'min-width:0;border:' + border + ';border-radius:12px;background:' + bg + ';padding:8px 10px">'
        + '<div style="font:700 11px system-ui;color:' + (o.active ? '#b45309' : '#64748b') + ';margin-bottom:5px">' + title + '</div>'
        + body + '</div>';
    };
    const line = (t, cls) => '<div style="font:12px/1.5 Consolas,monospace;color:' + (cls || '#334155') + '">' + t + '</div>';
    const flag = (b) => b === null || b === undefined
      ? '<span style="color:#94a3b8">—</span>'
      : (b ? '<span style="color:#047857;font-weight:700">命中</span>' : '<span style="color:#b91c1c;font-weight:700">缺失</span>');
    /* 面板内的小格子：一律走 CSS Grid + `minmax(0,1fr)`，**不用 table** ——
       表格有自己的自动最小宽度、窄容器下会把整个面板撑宽（窗56 实测：1440 宽下四个面板并排时
       Cache 组数一多就横向溢出，右侧"地址与计数"整块被切掉）。 */
    const gridN = (n, min) => 'display:grid;grid-template-columns:repeat(auto-fit,minmax(' + min + 'px,1fr));gap:3px';
    const cellBox = (cls, attrs, bg, fg, txt, sub) =>
      '<div class="' + cls + '" ' + attrs + ' style="border:1px solid #e2e8f0;border-radius:6px;background:' + bg + ';'
      + 'padding:2px 4px;text-align:center;font:700 11px Consolas,monospace;color:' + fg + ';overflow-wrap:anywhere">'
      + txt + (sub ? '<div style="font:9px system-ui;color:#94a3b8;font-weight:400">' + sub + '</div>' : '') + '</div>';

    /* ---- 统计卡 ---- */
    const rate = s.n ? Math.round((s.cacheHitTotal === undefined ? 0 : s.cacheHitTotal) / s.n * 100) : 0;
    const stats = [
      RC408.ui.statCard('当前访存序号', s.n === undefined ? (cur + 1) + ' / ' + m.seq.length : String(s.n),
        '虚拟地址 0x' + (cur >= 0 && m.seq[cur] !== undefined ? m.seq[cur].toString(16).toUpperCase() : '—'), 'tl-stat-i'),
      RC408.ui.statCard('累计访存次数', String(s.mem), m.tlbAccess ? '口径：查 TLB 也计入' : '口径：查 TLB 不计入', 'tl-stat-mem'),
      RC408.ui.statCard('TLB 命中 / 缺失', s.tlbHitN + ' / ' + s.tlbMissN, 'TLB ' + m.tlbSets + ' 组 × ' + m.tlbWays + ' 路', 'tl-stat-tlb'),
      RC408.ui.statCard('缺页 / 缺块', s.pageMissN + ' / ' + s.blockMissN,
        s.step === 'done' ? 'Cache 命中率 ' + rate + '%' : '缺页 = 页不在主存', 'tl-stat-miss'),
    ].join('');

    /* ---- 四级流程面板 ---- */
    const activeOf = (name) => (st === name && !s.skipped);
    const tlbBody = (function () {
      let h = line('组数 ' + m.tlbSets + ' ｜ 每组 ' + m.tlbWays + ' 路 ｜ 容量 ' + (m.tlbSets * m.tlbWays) + ' 项', '#64748b');
      const cells = [];
      for (let g = 0; g < m.tlbSets; g++) {
        for (let w = 0; w < m.tlbWays; w++) {
          const e = s.tlb[g * m.tlbWays + w];
          const isCur = (st === 'tlb' && s.visit === cur && s.tlbSet === g);
          const has = e && e.v === 1;
          const bg = isCur ? '#fde68a' : (has ? '#eef2ff' : '#f8fafc');
          const fg = has ? '#3730a3' : '#cbd5e1';
          cells.push(cellBox('tl-tlb-cell', 'data-g="' + g + '" data-w="' + w + '"', bg, fg,
            has ? (e.tag + '→' + e.ppn) : '空', '第' + g + '组'));
        }
      }
      return '<div class="tl-tlb-grid" style="' + gridN(m.tlbSets * m.tlbWays, 62) + '">' + cells.join('') + '</div>'
        + '<div style="font:10px system-ui;color:#94a3b8;margin-top:4px">每格 = 标记→页框号（TLB 存的是页表项的副本）</div>';
    })();

    const ptBody = (function () {
      const cells = s.ptes.map((p, g) => {
        const isCur = (st === 'pt' && s.visit === cur && s.vpn === g);
        const bg = isCur ? '#fde68a' : (p.v ? '#ecfdf5' : '#fef2f2');
        const fg = p.v ? '#065f46' : '#b91c1c';
        return cellBox('tl-pte-cell', 'data-g="' + g + '"', bg, fg, p.v ? ('→ ' + p.ppn) : '无效', '虚页 ' + g);
      }).join('');
      return '<div class="tl-pte-grid" style="' + gridN(s.ptes.length, 52) + '">' + cells + '</div>'
        + '<div style="font:10px system-ui;color:#94a3b8;margin-top:4px">每格 = 一个虚页号的页表项：→ 页框号 / 无效（缺页）</div>';
    })();

    const caBody = (function () {
      let h = line('组数 ' + m.cacheSets + ' ｜ 每组 ' + m.cacheWays + ' 路 ｜ 行 ' + m.lineSize + ' B ｜ 容量 '
        + (m.cacheSets * m.cacheWays * m.lineSize / 1024) + ' KB', '#64748b');
      const cells = [];
      for (let g = 0; g < m.cacheSets; g++) {
        for (let w = 0; w < m.cacheWays; w++) {
          const e = s.cache[g * m.cacheWays + w];
          const isCur = (st === 'ca' && s.cacheSet === g);
          const has = e && e.v === 1;
          const bg = isCur ? '#fde68a' : (has ? '#eff6ff' : '#f8fafc');
          const fg = has ? '#1d4ed8' : '#cbd5e1';
          cells.push(cellBox('tl-ca-cell', 'data-g="' + g + '" data-w="' + w + '"', bg, fg,
            has ? ('块 ' + e.blk) : '空', '第' + g + '组'));
        }
      }
      return '<div class="tl-ca-grid" style="' + gridN(m.cacheSets * m.cacheWays, 64) + '">' + cells.join('') + '</div>'
        + '<div style="font:10px system-ui;color:#94a3b8;margin-top:4px">每格 = 该路缓存住的主存块号（Cache 查的是物理地址）</div>';
    })();

    const memBody = '<div style="font:12px/1.6 Consolas,monospace;color:#334155">'
      + fmtLine('虚拟地址', cur >= 0 && m.seq[cur] !== undefined ? '0x' + m.seq[cur].toString(16).toUpperCase() : '—')
      + fmtLine('页内偏移 / 块内偏移', (s.pageOff === undefined ? '—' : s.pageOff + ' B') + ' ｜ ' + (s.blkOff === undefined || s.blkOff === null ? '—' : s.blkOff + ' B'))
      + fmtLine('虚页号 → 页框号', (s.vpn === undefined ? '—' : s.vpn) + ' → ' + (s.ppn === undefined || s.ppn === null ? '—' : s.ppn))
      + fmtLine('物理地址（十六进制）', s.pa === undefined || s.pa === null ? '—' : '0x' + s.pa.toString(16).toUpperCase())
      + fmtLine('主存块号', s.blk === undefined || s.blk === null ? '—' : String(s.blk))
      + fmtLine('本条访存次数', s.memThis === undefined ? '—' : String(s.memThis))
      + '</div>';

    const flow = '<div class="tl-flow" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:8px">'
      + box('① TLB（CPU 内）', tlbBody, { active: activeOf('tlb'), dim: st === 'pt' || st === 'ca' || st === 'sum' })
      + box('② 页表（在主存）', ptBody, { active: activeOf('pt'), dim: st === 'ca' || st === 'sum' })
      + box('③ Cache（物理地址）', caBody, { active: activeOf('ca'), dim: st === 'sum' })
      + box('④ 地址与计数', memBody, { active: activeOf('sum') || st === 'done' })
      + '</div>';

    /* ---- 当前阶段判定 ---- */
    const stageNow = '<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:9px 12px">'
      + RC408.ui.sectionTitle('当前阶段判定')
      + '<div style="font:13px/1.7 system-ui;color:#0f172a">' + U.esc(s.desc || '') + '</div>'
      + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font:12px Consolas,monospace;color:#475569">'
      + '<span>TLB ' + flag(s.tlbHit === undefined ? null : s.tlbHit) + '</span>'
      + '<span>页 ' + (s.pageMiss === true ? '<span style="color:#b91c1c;font-weight:700">缺失</span>' : (s.pageMiss === false ? '<span style="color:#047857;font-weight:700">命中</span>' : '<span style="color:#94a3b8">—</span>')) + '</span>'
      + '<span>Cache ' + flag(s.cacheHit === undefined ? null : s.cacheHit) + '</span>'
      + '<span>累计访存 ' + s.mem + ' 次</span>'
      + '</div></div>';

    /* ---- 明细表 ---- */
    const rows = (st === 'done' ? s.records : (s.records && s.step === 'sum' ? null : null));
    let detail = '';
    if (st === 'done') {
      detail = '<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:9px 12px">'
        + RC408.ui.sectionTitle('每条地址的逐级结果')
        + '<table class="tl-detail" style="border-collapse:collapse;width:100%;font:12px Consolas,monospace">'
        + '<thead><tr>'
        + ['#', '虚拟地址', '虚页号', 'TLB', '页表', 'Cache', '本条访存', '累计访存'].map(t =>
          '<th style="padding:3px 5px;border:1px solid #e2e8f0;background:#f8fafc;font:700 11px system-ui;color:#475569">' + t + '</th>').join('')
        + '</tr></thead><tbody>'
        + s.records.map(r => '<tr class="tl-drow">'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + (r.i + 1) + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0">0x' + r.va.toString(16).toUpperCase() + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + r.vpn + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + (r.tlbHit ? '命中' : '缺失') + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + (r.pageMiss ? '缺页' : '命中') + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + (r.cacheHit === null ? '—' : (r.cacheHit ? '命中' : '缺失')) + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + r.memThis + '</td>'
          + '<td style="padding:3px 5px;border:1px solid #e2e8f0;text-align:center">' + r.memCum + '</td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    /* ---- 末帧：命中组合可行性表（现算）---- */
    let combo = '';
    if (st === 'done' && s.combos) {
      combo = '<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:9px 12px">'
        + RC408.ui.sectionTitle('命中组合可行性表（8 种组合，用依赖关系现算）')
        + '<table class="tl-combo" style="border-collapse:collapse;width:100%;font:12px Consolas,monospace"><thead><tr>'
        + ['TLB', '页表（Page）', 'Cache', '能否发生', '为什么'].map(t =>
          '<th style="padding:3px 6px;border:1px solid #e2e8f0;background:#f8fafc;font:700 11px system-ui;color:#475569">' + t + '</th>').join('')
        + '</tr></thead><tbody>'
        + s.combos.map(c => '<tr class="tl-crow" data-ok="' + (c.ok ? '1' : '0') + '">'
          + '<td style="padding:3px 6px;border:1px solid #e2e8f0;text-align:center">' + (c.tlb ? '命中' : '未命中') + '</td>'
          + '<td style="padding:3px 6px;border:1px solid #e2e8f0;text-align:center">' + (c.page ? '命中' : '未命中') + '</td>'
          + '<td style="padding:3px 6px;border:1px solid #e2e8f0;text-align:center">' + (c.cache ? '命中' : '未命中') + '</td>'
          + '<td style="padding:3px 6px;border:1px solid #e2e8f0;text-align:center;font-weight:700;color:' + (c.ok ? '#047857' : '#b91c1c') + '">'
          + (c.ok ? '可发生' : '不可能') + '</td>'
          + '<td style="padding:3px 6px;border:1px solid #e2e8f0;color:#475569">' + U.esc(c.why) + '</td>'
          + '</tr>').join('')
        + '</tbody></table>'
        + '<div style="font:12px/1.7 system-ui;color:#0f172a;margin-top:7px">2010-17 问的正是"不可能发生"的那一种：'
        + '<b>TLB 命中 + Cache 命中 + Page 未命中</b>（选项 D）。反过来念最快——<b>页不在主存，TLB 里就不可能有它的表项</b>。</div>'
        + '</div>';
    }

    const bitsLine = '<div style="font:11px/1.6 Consolas,monospace;color:#64748b;padding:2px 2px 0">'
      + '地址划分：虚拟地址 ' + B.vaBits + ' 位 = 虚页号 ' + B.vpnBits + ' 位 + 页内偏移 ' + B.offBits + ' 位'
      + '（页 ' + m.pageSize + ' B）｜TLB：组号 ' + B.tlbSetBits + ' 位 + 标记 ' + B.tlbTagBits + ' 位'
      + '｜Cache：块内偏移 ' + B.blkOffBits + ' 位 + 组号 ' + B.cacheSetBits + ' 位 + 标记 ' + B.cacheTagBits + ' 位'
      + '（行 ' + m.lineSize + ' B，主存块号 = 页框号 × ' + (m.pageSize / m.lineSize) + ' + 块内号）'
      + '</div>';

    stage.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' + stats + '</div>'
      + bitsLine + flow + stageNow + detail + combo + '</div>';
  },
});

/* ------------------------------ 纯函数工具 ------------------------------ */

/** Cache 判定（独立函数，避免在访问循环里再声明同名局部量 —— 那是 TDZ 屏蔽，窗56 实测两次）
 *  入参：cache 表项数组、页框号、页内偏移、model、位数表；返回物理地址 / 块号 / 组号 / 标记 / 命中路。 */
function _tlCacheLookup(cache, ppn, pageOff, m, B) {
  const pa = ppn * m.pageSize + pageOff;
  const blk = ppn * (m.pageSize / m.lineSize) + Math.floor(pageOff / m.lineSize);
  const cacheSet = B.cacheSetBits === 0 ? 0 : blk % m.cacheSets;
  const cacheTag = B.cacheTagBits === 0 ? 0 : Math.floor(blk / m.cacheSets);
  let way = -1;
  for (let w = 0; w < m.cacheWays; w++) {
    const e = cache[cacheSet * m.cacheWays + w];
    if (e && e.v === 1 && e.tag === cacheTag) { way = w; break; }
  }
  return { pa: pa, blk: blk, blkOff: pageOff % m.lineSize, cacheSet: cacheSet, cacheTag: cacheTag, way: way, hit: way >= 0 };
}

/** 2 的幂校验（页大小 / 行大小 / 组数都必须是） */
function _tlPow2(v, name) {
  if (!Number.isInteger(v) || v < 1 || (v & (v - 1)) !== 0) throw { message: name + '必须是 2 的幂（现在 ' + v + '）' };
}
/** 解析十六进制地址列表（允许 0x 前缀、逗号 / 空格分隔） */
function _tlHexList(src) {
  const out = [];
  String(src || '').split(/[\s,，、]+/).forEach(t => {
    const s = t.trim();
    if (!s) return;
    if (!/^(0x)?[0-9a-fA-F]{1,8}$/.test(s)) throw { message: '「' + s + '」不是合法的十六进制虚拟地址（上限 0xFFFFFFFF，可带 0x 前缀）' };
    out.push(parseInt(s.replace(/^0x/i, ''), 16));
  });
  return out;
}
/** 解析整数列表（逗号 / 空格 / 顿号分隔），空串 → 空数组 */
function _tlIntList(src, name) {
  const out = [];
  String(src === undefined || src === null ? '' : src).split(/[\s,，、]+/).forEach(t => {
    const s = t.trim();
    if (!s) return;
    if (!/^\d+$/.test(s)) throw { message: name + '里「' + s + '」不是非负整数' };
    out.push(Number(s));
  });
  return out;
}
/** 地址与组相联字段的位数（全部由页大小 / 行大小 / 组数现算） */
function _tlBits(o) {
  const lg = (v) => Math.round(Math.log2(v));
  const offBits = lg(o.pageSize);
  const vaBits = 32, paBits = 32;
  const vpnBits = vaBits - offBits;
  const ppnBits = paBits - offBits;
  return {
    offBits: offBits, vaBits: vaBits, paBits: paBits, vpnBits: vpnBits, ppnBits: ppnBits,
    tlbSetBits: lg(o.tlbSets), tlbTagBits: vpnBits - lg(o.tlbSets),
    blkOffBits: lg(o.lineSize), cacheSetBits: lg(o.cacheSets),
    cacheTagBits: ppnBits + offBits - lg(o.lineSize) - lg(o.cacheSets),
  };
}
/** 初始 TLB：按「虚页号 mod 组数」归组、组内顺序填路；装不下就截断并置 full */
function _tlTlbInit(src, sets, ways) {
  const pages = _tlIntList(src, '初始 TLB 虚页号');
  const cap = sets * ways;
  const slots = new Array(cap).fill(null);
  const used = new Array(sets).fill(0);
  let full = false;
  pages.forEach(vpn => {
    const g = vpn % sets;
    if (used[g] >= ways) { full = true; return; }
    const tag = Math.floor(vpn / sets);
    slots[g * ways + used[g]] = { tag: tag, ppn: vpn };
    used[g]++;
  });
  /* ⚠ 每个空位必须是**独立对象**：写成 `slots.map(s => s || {…})` 会让所有空位共用同一个占位对象，
     之后往任意一格写数据会把"所有空位"一起变成有效（窗56 实测：冷启动预设里第 2 次访问被误判成 Cache 命中）。 */
  return { list: slots.map(s => (s ? { tag: s.tag, ppn: s.ppn, v: 1 } : { tag: 0, ppn: 0, v: 0 })), full: full };
}
/** 初始页表：输入的是「按虚页号 0,1,2,… 的有效位」；有效项的页框号取虚页号本身（恒等映射，便于手算） */
function _tlPteInit(src, vpnBits) {
  const bits = _tlIntList(src, '页表初始有效位');
  if (!bits.length) throw { message: '页表初始有效位不能全空：至少写一位，如 1,1,1,1' };
  bits.forEach(b => { if (b !== 0 && b !== 1) throw { message: '页表有效位只能写 0 或 1（遇到 ' + b + '）' }; });
  const maxVpn = Math.pow(2, Math.min(vpnBits, 20));
  if (bits.length > maxVpn) throw { message: '页表项数超过虚地址空间（最多 ' + maxVpn + ' 项，现在 ' + bits.length + ' 项）' };
  return bits.map((b, i) => ({ v: b, ppn: i }));
}
/** 初始 Cache：块号按「mod 组数」归组、组内顺序填路；装不下就截断并置 full */
function _tlCacheInit(src, sets, ways) {
  const blks = _tlIntList(src, '初始 Cache 主存块号');
  const cap = sets * ways;
  const slots = new Array(cap).fill(null);
  const used = new Array(sets).fill(0);
  let full = false;
  blks.forEach(blk => {
    const g = blk % sets;
    if (used[g] >= ways) { full = true; return; }
    const tag = Math.floor(blk / sets);
    slots[g * ways + used[g]] = { tag: tag, blk: blk };
    used[g]++;
  });
  /* ⚠ 同 `_tlTlbInit`：空位必须各自独立（共用占位对象会让"填一格 = 全部有效"）。 */
  return { list: slots.map(s => (s ? { tag: s.tag, blk: s.blk, v: 1 } : { tag: 0, blk: 0, v: 0 })), full: full };
}
/** 命中组合可行性表：由 I2 的四条依赖关系现算（不写死答案） */
function _tlComboTable() {
  const out = [];
  for (let k = 0; k < 8; k++) {
    const tlb = !!(k & 4), page = !!(k & 2), cache = !!(k & 1);
    let why = '', ok = true;
    if (tlb && !page) { ok = false; why = 'TLB 命中说明页表项有效 ⟹ 页必在主存，与"页未命中"矛盾'; }
    else if (cache && !page) { ok = false; why = 'Cache 装的是主存块的副本 ⟹ 页必在主存，与"页未命中"矛盾'; }
    else if (!page && !tlb && !cache) { why = '缺页现场：页不在主存 ⟹ TLB 必缺失、也谈不上访 Cache'; }
    else if (tlb && page && cache) { why = '最理想的一次访存：地址转换命中、数据块也在 Cache 里'; }
    else if (tlb && page && !cache) { why = '地址转换命中，只是数据块还没进 Cache'; }
    else if (!tlb && page && cache) { why = '页在主存且块已在 Cache，只是 TLB 表项被换出去了'; }
    else { why = '页表命中但地址转换与数据块都缺：缺页调入后第一次访问就是这一种'; }
    out.push({ tlb: tlb, page: page, cache: cache, ok: ok, why: why });
  }
  return out;
}
/** 渲染用：一行「字段 值」——标签不设固定最小宽（固定宽会把窄容器顶出横向滚动） */
function fmtLine(k, v) {
  return '<div class="tl-line" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;align-items:baseline">'
    + '<span style="color:#64748b;white-space:nowrap">' + k + '</span>'
    + '<span style="font-weight:700;color:#0f172a;overflow-wrap:anywhere">' + v + '</span></div>';
}
