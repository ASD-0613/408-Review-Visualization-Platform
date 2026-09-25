'use strict';
/* ============================================================================
 * ds-extsort.js —— 【数据结构】外部排序（置换-选择生成初始归并段 / k 路平衡归并 + 败者树 /
 *                                  最佳归并树与虚段）　前缀 `ex`（ex-）
 * ----------------------------------------------------------------------------
 * 真题考情（2009–2026 共 18 年，**6 年 / 6 题：选 4 + 大 2**，逐条回 `考情缓存/` 取证，窗25 核定）：
 *   · 2012-41 大：对有序表两两合并用 merge()、合并顺序用哈夫曼（最佳归并树）思想，最坏比较次数；
 *   · 2016-11 选：外部排序为什么必须用归并（`2016_解析.txt:212-214`）；
 *   · 2019-11 选：外存 120 个初始归并段、12 路归并，求补充的**虚段个数**（答案 **2**，
 *     官方答案表 + 渲染 `考情缓存/扫描页/2019_解析_p01.png` 目视确认「11. B」）；
 *   · 2023-42 大（10 分）：n≫m>0 个记录、工作区保存 m 个记录，**用置换-选择生成初始归并段**，
 *     给定 19 个关键字、m=4 求"可生成几个初始归并段、各是什么"（`扫描页/2023_真题_p06.png` 目视；
 *     官方答案见 `扫描页/2023_解析_p08.png`+`_p09.png` ⟹ **3 段**）。
 *     ⚠ 官方三段明细（① 37,51,63,92,94,99 ② 14,15,23,31,48,56,60,90,100 ③ 8,17,43,100）**自身不自洽**
 *     （题干 19 个关键字含 166，而三段明细把 166 整条漏掉），故本模块**只把"3 段"当锚点**，
 *     不把明细写死进断言；本机 `2023_真题.txt`/`2023_解析.txt` 无文本层，无法二次核对；
 *   · 2024-11 选：败者树中记录"冠军"的结点保存的是**最小关键字所在的归并段号**（`2024_解析.txt:166-171`）；
 *   · 2026-11 选：k 路归并趟数 d 的三命题（增大 k 减小 d ✔ / d 与初始归并段无关 ✘ / 内存限制段长 ✔，答 C）。
 *   **标 hot**：6 年 < 8，但**大题 2 道 ⟹ 满足 §1.5 的"或大题 ≥ 2 道"**（与 ds-prim / ds-kruskal 同口径）。
 *
 * 快照铁律（handover §1.3）：parse → buildSnapshots（纯算法、零 DOM）→ render 只读快照。
 * 三种演示模式的快照 schema（**每种模式都必须全量携带其视觉状态**）：
 *
 *  mode='runs'（置换-选择生成初始归并段）
 *   { kind:'runs', ev:'init'|'fill'|'out'|'freeze'|'load'|'newRun'|'endRun'|'done',
 *     mem:[…M 个槽位的值], frozenSet:[槽位下标], win:槽位下标|null（本帧刚输出的槽位）,
 *     inCursor:输入流已消费到的下标（= 下一待读位置）, outRuns:[[…],…]（已闭合的段，含正在生长的当前段）,
 *     lastOut:本段上一次输出的值（null=本段还没输出）, runsDone, M, seq, log, logType, desc }
 *   · 不变量：`mem.length === M` 恒成立（固定 M 个槽位，冻结只改标记不改位置——见 §3.8-11 同源坑）；
 *     `frozenSet` 里的槽位在比较中视为 +∞；`outRuns[outRuns.length-1]` 即"正在生长的当前段"。
 *
 *  mode='merge'（k 路平衡归并 + 败者树）
 *   { kind:'merge', ev:'init'|'split'|'load'|'win'|'done',
 *     cols:[[…每个归并段剩余元素],…]（cols[i] 已消费到 ptrs[i]）, ptrs:[…],
 *     tree:[…2k-1 个结点]，其中 tree[0]=冠军（归并段号）, tree[p]=loser[p]（p=1..k-1）,
 *     path:[…当前冠军的叶下标], changed:[本帧值变动的结点下标], out:[…已归并输出], k, total, log, logType, desc }
 *   · 不变量：`tree.length === 2k-1`；`tree[p]` 恒为"路径 p 上的败者"、`tree[0]` 恒为冠军；
 *     某段耗尽时其键取 +∞（叶子值用 `+∞` 表示），冠军只在有剩余的段里产生。
 *
 *  mode='calc'（最佳归并树 / 虚段个数计算器，instant 风格但走同一条 stepper 骨架）
 *   { kind:'calc', ev:'init'|'done', m, k, d, dummy, totalLen, io, levels:[…每趟段数],
 *      tree:{levels:[[…结点(权重/段号)]], links:[[父,子…]]} | null, log, logType, desc }
 *   · 不变量：`d === ⌈log_k m⌉`（用"每趟按 k 折减"现算，与公式互相印证）；`dummy === (k-1) - ((m-1) mod (k-1))`；
 *     `io === 2 * totalLen * d`（**只与 n 和 d 有关，与虚段个数无关**——虚段不搬数据）。
 *
 * ⚠ 编译期大坑（handover §0.3「SyntaxError / 裸反引号」已复发 6 次）：本文件 theory 模板字面量里
 *   **不许出现裸反引号**，注释里也不许（反引号一样会吃掉整段字符串）。
 * ========================================================================== */

/* 三种演示模式的元信息（渲染下拉 / 统计卡文案共用） */
const _EX_MODES = {
  runs: { name: '① 生成初始归并段（置换-选择）' },
  merge: { name: '② k 路平衡归并 + 败者树' },
  calc: { name: '③ 最佳归并树 / 虚段个数' },
};

/** 稳定乱序（种子固定，保证"默认输入"每次一致） */
function _exShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 最小堆下筛：a[i] 与孩子比 key，`frozen` 里的槽位在比较中视为 +∞（置换-选择的核心口径） */
function _exSiftDown(a, i, frozen) {
  const n = a.length;
  const key = j => (frozen[j] ? Infinity : a[j]);
  for (;;) {
    let m = i;
    const l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && key(l) < key(m)) m = l;
    if (r < n && key(r) < key(m)) m = r;
    if (m === i) return;
    [a[i], a[m]] = [a[m], a[i]];
    [frozen[i], frozen[m]] = [frozen[m], frozen[i]];
    i = m;
  }
}
/** 建堆（只在"可输出"的元素间） */
function _exHeapify(a, frozen) { for (let i = Math.floor(a.length / 2) - 1; i >= 0; i--) _exSiftDown(a, i, frozen); }

/** 置换-选择：返回 { runs, frames }；frames 每项 = 一步的原始状态（buildSnapshots 再加 log/desc） */
function _exReplacementSelect(seq, M) {
  const runs = [], frames = [];
  const mem = [], frozen = [];
  let lastOut = null;
  let cur = [];
  const startRun = why => {
    if (!cur.length) return;
    runs.push([...cur]);
    frames.push({ ev: 'endRun', why, len: cur.length, frozenN: frozen.filter(Boolean).length });
    cur = []; lastOut = null; frozen.fill(false);
  };

  for (let i = 0; i < seq.length; i++) {
    const x = seq[i];
    if (mem.length < M) {
      mem.push(x); frozen.push(false); _exHeapify(mem, frozen);
      frames.push({ ev: 'fill', inCursor: i + 1, x, win: null });
      continue;
    }
    _exHeapify(mem, frozen);
    if (frozen[0]) {
      /* ★ 本段结束：startRun 会**解冻全部记录**，解冻后原来的堆序不再成立，
       *   必须重新 heapify ⟹ 再把最小者取出来作为下一段的第一个输出。
       *   （窗25 实测：漏掉这次 heapify，"新段首"会取到冻结期留下的旧堆顶，
       *     于是每段的第一个记录都是错的，而段长却仍然正确——只有对账才抓得到。） */
      startRun('堆顶冻结');
      frames.push({ ev: 'newRun', inCursor: i });
      _exHeapify(mem, frozen);
    }
    const top = mem[0]; cur.push(top); lastOut = top;
    frames.push({ ev: 'out', inCursor: i, x: top, win: 0 });
    const nf = x < lastOut;
    mem[0] = x; frozen[0] = nf; _exSiftDown(mem, 0, frozen);
    frames.push({ ev: nf ? 'freeze' : 'load', inCursor: i + 1, x, win: null, frozenNow: nf });
  }
  for (;;) {
    _exHeapify(mem, frozen);
    if (!mem.length) break;
    if (frozen[0]) {
      if (frozen.some(Boolean)) { startRun('输入耗尽后堆顶仍是冻结记录'); frames.push({ ev: 'newRun', inCursor: seq.length }); _exHeapify(mem, frozen); if (!mem.length) break; }
    }
    const top = mem[0]; cur.push(top); lastOut = top;
    mem.shift(); frozen.shift(); _exHeapify(mem, frozen);
    frames.push({ ev: 'out', inCursor: seq.length, x: top, win: null, drain: true });
  }
  if (cur.length) runs.push([...cur]);
  return { runs, frames };
}

/** k 路平衡归并趟数：每趟段数按 k 折减（与 ⌈log_k m⌉ 等价，两者在冒烟里互相印证） */
function _exMergePasses(m, k) {
  if (m <= 1) return 0;
  let d = 0, cnt = m;
  while (cnt > 1) { cnt = Math.ceil(cnt / k); d++; }
  return d;
}
/** 最佳归并树的虚段个数（k 叉哈夫曼补权 0 结点） */
function _exDummy(m, k) {
  const r = (m - 1) % (k - 1);
  return r === 0 ? 0 : (k - 1) - r;
}
/** 败者树路径：叶 p 到根经过的内部结点编号（p=1..k-1） */
function _exPath(p) { const path = []; let j = p; while (j >= 1) { path.push(j); j = Math.floor(j / 2); } path.push(0); return path; }

/**
 * k 路败者树：产出 { tree, path, changed, winner }
 * 编号口径（全模块统一，**1 基**，别混）：
 *   · 归并段编号 1..k   ←→  数据下标 `seg - 1`（即 `cols[seg-1]`）
 *   · 内部结点编号 1..k-1（完全二叉树）⟹ 编号 0 空出来专放**冠军**；
 *   · 于是 `tree` 是长度 **k+1** 的数组：`tree[0]` = 冠军段号，`tree[p]` = 路径 p 上的败者段号。
 * 建树：**分治**（照定义写，不玩下标技巧）——
 *   结点 p 负责叶区间 [lo, hi]（p === lo），左孩子 = 2p 负责 [lo, mid]、右孩子 = 2p+1 负责 [mid+1, hi]；
 *   每个结点 `tree[p] = 左子树冠军`（能进到 p 这一层的两个冠军里，输的那个必来自左子树），
 *   结点返回 { w = 本子树冠军 }，`tree[0] = 根结点的冠军`。
 * ⚠ 三条必须照做（窗25 连错三版，每一版都"看着很对"，前两版还都通过了肉眼抽查）：
 *   ① **树形要按 2 的幂补齐**：k 个叶必有 k−1 个内部结点，但 `2p / 2p+1` 的编号只有在
 *      **叶数 = 2 的幂**时才刚好铺满 1..k−1（k=6 时结点 5 会永远轮空、`tree[5]` 留 0）。
 *      做法：取 `L = 2^⌈log2 k⌉`，**补 L−k 个"虚拟叶"（键恒 +∞，永不夺冠）**再建树，
 *      只取 1..k−1 号结点。补进去的虚拟段不会夺冠 ⟹ 不影响归并结果；
 *   ② **别用"兄弟下标 `j ^ 1` / `j − 1`"推关系**：完全二叉树里结点 p 的兄弟**不是** p±1
 *      （只有 p−1 是 2 的幂时才是），结点编号的奇偶与左右孩子也无固定对应 ⟹ k 非 2 的幂时必错；
 *   ③ **别只比一场就上行**：沿链每层都要比（漏了 `j >>= 1` 就等于只在最底层比了一次）。
 * `keys[seg]`：段 `seg` 当前段首值；段耗尽取 +∞（不再夺冠）。
 */
function _exLoserTree(keys, k, prev) {
  const tree = new Array(k + 1).fill(0);
  let L = 1; while (L < k) L *= 2;                          /* 补齐到 2 的幂（见 ⚠①） */
  const padKeys = i => (i > k ? Infinity : keys[i]);
  function build(p, lo, hi) {
    if (hi <= lo) return { w: lo };
    const mid = (lo + hi) >> 1;
    const lw = build(2 * p, lo, mid).w;
    const rw = build(2 * p + 1, mid + 1, hi).w;
    /* 只有"区间左端仍在真实段内（lo ≤ k）"的结点才是数据里的败者结点：
     * 完全落在补出来的虚拟叶里（lo > k，如 k=9 的结点 7 管 [13,16]）不许写，
     * 否则会把 > k 的"段号"写进树里（窗25 实测）。 */
    if (p <= k - 1 && lo <= k) tree[p] = lw;
    return { w: (padKeys(rw) < padKeys(lw) ? rw : lw) };
  }
  tree[0] = build(1, 1, L).w;
  const path = _exPath(tree[0]);
  const changed = [];
  if (prev && prev.length === tree.length) tree.forEach((v, i) => { if (prev[i] !== v) changed.push(i); });
  return { tree, path, changed, winner: tree[0] };
}

RC408.registerModule({
  id: 'ds-extsort',
  mode: 'stepper',
  title: '外部排序（初始归并段 / k 路归并败者树 / 最佳归并树）',

  theory: `
> **为什么要有它**：待排序的数据**内存一次装不下**，只能分批读入、排好一段写回外存，再把若干段**归并**成整份有序文件——外排的代价几乎全在**外存读写次数**上，所以考点集中在"怎么少跑几趟"。
> **怎么实现**：① 用**置换-选择**在有限内存里生成尽量长的**初始归并段**；② 用 **k 路平衡归并**（配合**败者树**）把这些段合并；③ 段长不等时用**最佳归并树**（哈夫曼思想）决定合并顺序，并**补虚段**凑成严格 k 叉树。
> **记住什么**：**归并趟数 \\\\(d=\\\\lceil \\\\log_k m \\\\rceil\\\\)**（只与**初始归并段数 m** 和**归并路数 k** 有关）+ **虚段个数 \\\\((k-1)-((m-1)\\\\bmod (k-1))\\\\)** + **败者树结点存"败者所在的归并段号"、冠军另设结点** + 总读写次数 \\\\(=2nd\\\\)。

## 一、外部排序为什么必须用归并
- 数据在外存、内存装不下 ⟹ 只能**先分段内部排序**、**再多趟归并**；
- 一次归并的**数据量**受内存缓冲区限制：k 路归并至少要 k 个输入缓冲 + 1 个输出缓冲；
- **代价模型**：每趟归并要把整份数据**读一遍、写一遍** ⟹ 总 I/O \\\\(=2nd\\\\)（n = 记录总数，d = 归并趟数），
  所以优化的唯一方向是**减少 d**：增大 k（受内存限制）、或**增大初始归并段长**（减少 m）。

## 二、生成初始归并段：置换-选择排序
- 内存里放 **M 个记录**的缓冲区，维持一个**最小堆**（只在"可输出"的记录之间比较）；
- 每次输出堆顶（当前最小值）后，从输入流补一个记录 x：
  - **x ≥ 刚输出的值** ⟹ 它还能接在本段后面，**留在堆里**继续参与；
  - **x < 刚输出的值** ⟹ 本段放不下它，**冻结**（本段不再考虑它，留给下一段）；
- 堆顶也被冻结时，**本段结束**：解冻全部记录，开始下一段；
- 输入耗尽后，内存里剩下的记录按堆序成段输出（可能还分几块）；
- **段长**：随机输入平均约 **2M**（本模块默认数据用大样本核过），最坏（逆序输入）退化为 **M**，
  最好（升序输入）整份数据**一个段**。

## 三、k 路平衡归并与败者树
- **归并趟数 \\\\(d=\\\\lceil \\\\log_k m \\\\rceil\\\\)**：m=120、k=12 ⟹ d=2；m=100、k=2 ⟹ d=7；**m=1 ⟹ d=0**（本来就是一份有序文件）；
- **d 与"初始归并段数 m"有关，与"归并路数 k"有关，与数据总量无关**（2026-11 的陷阱就在这）；
- **k 路归并每输出一个记录要比较 k−1 次**，用败者树可以降到 \\\\(\\\\lceil \\\\log_2 k \\\\rceil\\\\) 次；
- **败者树的定义**（2024-11 原题）：它只记**败者**，且记的是**败者所在的归并段号**；
  另需**一个结点保存"冠军"**（即当前最小值所在的归并段号）——所以"记录冠军的结点保存的是**最小关键字所在的归并段号**"；
- 与胜者树的区别：**中间结点记胜者 vs 记败者**；败者树在**同一段持续夺冠**时优势最明显
  （沿原路径上溯即可，不必与其他段重比）。

## 四、最佳归并树与虚段
- 各初始归并段**长度不等**时，合并顺序影响总读写量 ⟹ 把段长当**权值**、按**哈夫曼树**思路构造 **k 叉最佳归并树**（WPL 最小）；
- **k 叉哈夫曼树要求"严格 k 叉"**（每个内部结点恰好 k 个孩子）：若 \\\\((m-1)\\\\bmod (k-1)\\\\ne 0\\\\)，需补
  \\\\((k-1)-((m-1)\\\\bmod (k-1))\\\\) 个**长度为 0 的虚段**（虚段不搬数据，**不影响 I/O 次数与趟数**）；
- 验算：m=120、k=12 ⟹ (120−1) mod 11 = 9 ⟹ 补 **2** 个虚段（**2019-11 答案**）；
- 只有**两路归并**时 k=2，(k−1)=1，余数恒为 0 ⟹ **两路归并不需要虚段**。

## 考点提醒（易错点）
1. **"归并趟数 d 与初始归并段个数无关"是错的**——d 正是由 m 和 k 决定的；"与数据总量无关"才对；
2. **"可用内存大小限制初始归并段的长度"是对的**：缓冲区 M 个记录限制了单段能有多长（置换-选择平均 2M）；
3. **虚段个数别用 \\\\(k-(m\\\\bmod k)\\\\)**（那是"最后一组的空缺"），正确口径是 \\\\((m-1)\\\\bmod (k-1)\\\\) 的补；
4. **败者树记的是"段号"不是"关键字"**，且中间结点记**败者**——2024-11 四个选项就在这四个词上做文章；
5. **"增大 k 一定能减少 d"**：能减少 d，但 k 受**可用内存**限制（要 k 个输入缓冲），不能无限增大。

> **真题考情**：**6/18 年（6 题：选 4 + 大 2）**：选 2016-11（外排概念）、2019-11（120 段 12 路求虚段，答 2）、
> 2024-11（败者树"冠军"结点存什么，答"最小关键字所在的归并段号"）、2026-11（d 的三命题，答"增大 k 可减少 d + 内存限制段长"）；
> 大 2012-41（6 个不等长有序表的合并顺序 + 最坏比较次数，用哈夫曼 / 最佳归并树思想）、2023-42（工作区 m 个记录、
> 用置换-选择生成初始归并段，问"生成几段、各是什么"——官方答 **3 段**）。
`,

  /* ---------------- 输入表单（★ 每项都必须有 default，§3.8-11） ---------------- */
  inputs: [
    {
      key: 'mode', label: '演示模式', type: 'select', default: 'runs', wide: true,
      options: Object.entries(_EX_MODES).map(([v, m]) => ({ v, t: m.name })),
      help: '① 看"有限内存能生成多长的初始归并段"；② 看败者树怎么选出冠军；③ 算虚段个数与总读写次数',
    },
    {
      key: 'memSize', label: '内存缓冲区 M（2~6 个记录）', type: 'range', min: 2, max: 6, step: 1, default: 4,
      help: '置换-选择：M 越大段越长（随机输入平均约 2M 个记录一段）',
    },
    {
      key: 'k', label: '归并路数 k（2~16）', type: 'text', default: '4', wide: false,
      help: '模式②按这个路数建败者树并归并（**2 的幂时树形最规整**，非 2 的幂按完全二叉树口径也能正确建树）；模式③用它算虚段（2019 真题就是 k=12）',
    },
    {
      key: 'seq', label: '待排序记录（逗号分隔；模式①）', type: 'textarea', rows: 2, wide: true,
      default: '44, 55, 12, 42, 94, 18, 6, 67, 89, 23, 71, 30, 8, 51, 63, 37',
      help: '默认 16 个记录 = 把 1~16 洗牌后每位 +5（种子固定），保证含"冻结"情形且每次结果一致',
    },
    {
      key: 'runsArg', label: '初始归并段（模式③：每个段的记录数，逗号分隔）', type: 'text', wide: true,
      default: '10, 35, 40, 50, 60, 200',
      help: '默认取 2012-41 真题的 6 个有序表长度（10/35/40/50/60/200）',
    },
  ],

  quickActions: [
    {
      label: '★ 2019 真题（120 段 · 12 路求虚段）',
      run(rt) { rt.setInput('mode', 'calc'); rt.setInput('k', '12'); rt.setInput('runsArg', Array.from({ length: 120 }, () => 10).join(',')); rt.load(); },
    },
    {
      label: '★ 2023 真题（19 个关键字 · m=4）',
      run(rt) {
        rt.setInput('mode', 'runs'); rt.setInput('memSize', 4);
        rt.setInput('seq', '51, 94, 37, 92, 14, 63, 15, 99, 48, 56, 23, 60, 31, 17, 43, 8, 90, 100, 166');
        rt.load();
      },
    },
    {
      label: '2012 真题（6 个不等长有序表）',
      run(rt) { rt.setInput('mode', 'calc'); rt.setInput('k', '2'); rt.setInput('runsArg', '10, 35, 40, 50, 60, 200'); rt.load(); },
    },
    {
      label: '2024 真题（败者树 4 路）',
      run(rt) { rt.setInput('mode', 'merge'); rt.setInput('k', '4'); rt.setInput('seq', '15, 20, 22, 26, 31, 8, 12, 19, 28, 33, 41, 5, 9, 14, 24, 36, 3, 7, 11, 16'); rt.load(); },
    },
    {
      label: '逆序输入（段长退化成 M）',
      run(rt) { rt.setInput('mode', 'runs'); rt.setInput('memSize', 4); rt.setInput('seq', '44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 1'); rt.load(); },
    },
    {
      label: '升序输入（整份数据一个段）',
      run(rt) { rt.setInput('mode', 'runs'); rt.setInput('memSize', 4); rt.setInput('seq', '1, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44'); rt.load(); },
    },
    {
      label: '🎲 随机记录（12 个）',
      run(rt) { rt.setInput('mode', 'runs'); rt.setInput('seq', _exShuffle(Array.from({ length: 90 }, (_, i) => i + 1), Math.floor(Math.random() * 1e9)).slice(0, 12).join(',')); rt.load(); },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const mode = _EX_MODES[vals.mode] ? vals.mode : 'runs';
    const M = parseInt(vals.memSize, 10);
    if (!Number.isInteger(M) || M < 2 || M > 6) throw { message: '内存缓冲区 M 请取 2 ~ 6 的整数' };
    const k = parseInt(vals.k, 10);
    if (!Number.isInteger(k) || k < 2 || k > 16) throw { message: '归并路数 k 请取 2 ~ 16 的整数（k 只影响计算与树形，与记录条数无关）' };

    if (mode === 'calc') {
      const lens = String(vals.runsArg || '').split(/[^0-9]+/).filter(Boolean).map(Number);
      if (lens.length < 1) throw { message: '请至少给 1 个初始归并段的长度（逗号分隔）' };
      if (lens.length > 200) throw { message: '段数最多 200（公式与趟数不受影响，只是表格太长）' };
      if (lens.some(v => !(v > 0))) throw { message: '每段的记录数须为正整数' };
      return { mode, M, k, lens, totalLen: lens.reduce((a, b) => a + b, 0) };
    }

    const seq = String(vals.seq || '').split(/[^0-9]+/).filter(Boolean).map(Number);
    if (seq.length < 4) throw { message: '待排序记录至少 4 个（用逗号或空格分隔）' };
    if (seq.length > 20) throw { message: '记录最多 20 个（逐帧演示用，再多请用模式③算参数）' };
    if (seq.some(v => v < 1 || v > 999)) throw { message: '记录取值请控制在 1 ~ 999' };

    if (mode === 'runs') return { mode, M, k, seq };

    /* mode === 'merge'：按 M 把记录切成若干初始归并段（各段内部视为已排好序） */
    const m = Math.ceil(seq.length / M);
    if (m < 2) throw { message: `按 M=${M} 只能得到 1 个初始归并段，无需归并；请增大记录数或减小内存缓冲区 M` };
    const size = Math.ceil(seq.length / m);
    const runs = [];
    for (let i = 0; i < seq.length; i += size) runs.push([...seq.slice(i, i + size)].sort((a, b) => a - b));
    if (runs.length < 2) throw { message: '切分后不足 2 个初始归并段，无需归并' };
    /* ★ 实际路数不能超过段数：k 路归并只有 m<k 个段时，多出来的"路"是空段（键 +∞），
     *   若把它放进败者树，空段会赢下比赛 ⟹ 冠军恒为 +∞ ⟹ 一个记录都归并不出来（窗25 冒烟抓到的真 bug）。
     *   这里夹紧到实际段数，并把夹紧事实写进模型供日志 / 渲染显示。 */
    const kEff = Math.min(k, runs.length);
    return { mode, M, k: kEff, kAsked: k, seq, runs };
  },

  /* ---------------- ② 纯算法：产出快照 ---------------- */
  buildSnapshots(model) {
    const snaps = [];

    /* ============ 模式③ 计算器（无逐帧过程，输出 2 帧） ============ */
    if (model.mode === 'calc') {
      const { lens, k } = model;
      const m = lens.length;
      const d = _exMergePasses(m, k);
      const dummy = _exDummy(m, k);
      const totalLen = model.totalLen;
      const io = 2 * totalLen * d;
      /* 每趟的段数轨迹（用于"为什么是 d 趟"的展示） */
      const levels = [m];
      let cnt = m;
      while (cnt > 1) { cnt = Math.ceil(cnt / k); levels.push(cnt); }
      /* 最佳归并树：把段长 + dummy 个 0 当权值做 k 叉哈夫曼 */
      const nodes = lens.map((L, i) => ({ id: i, len: L, label: `R${i + 1}`, leaves: [i] }));
      let next = lens.length;
      for (let i = 0; i < dummy; i++) { nodes.push({ id: next++, len: 0, label: '虚段', leaves: [], dummy: true }); }
      const tree = { levels: [], links: [] };
      let pool = [...nodes];
      while (pool.length > 1) {
        pool.sort((a, b) => a.len - b.len || a.id - b.id);
        const take = pool.slice(0, Math.min(k, pool.length));
        const rest = pool.slice(k);
        const parent = { id: next++, len: take.reduce((a, b) => a + b.len, 0), label: `合并${take.reduce((a, b) => a + b.len, 0)}`, leaves: take.flatMap(t => t.leaves), kids: take.map(t => t.id) };
        tree.links.push({ parent: parent.id, kids: take.map(t => t.id), len: parent.len });
        pool = [...rest, parent];
        if (tree.levels.length < 40) tree.levels.push(take.map(t => ({ id: t.id, len: t.len, label: t.label, dummy: !!t.dummy })));
      }
      if (pool.length === 1) tree.levels.push([{ id: pool[0].id, len: pool[0].len, label: pool[0].label, dummy: false }]);

      snaps.push({
        kind: 'calc', ev: 'init', m, k, d, dummy, totalLen, io, levels, tree,
        log: `已读入 ${m} 个初始归并段（总记录数 ${totalLen}），归并路数 k=${k}。准备计算趟数、虚段与总读写次数。`,
        logType: 'info', desc: `m=${m}，k=${k} ⟹ 点击「单步执行」看结论`,
      });
      const dTxt = d === 0 ? '原本就只有 1 段（已有序），无需归并' : `${m} 个段每趟按 k=${k} 折减：${levels.join(' → ')}，共 d=${d} 趟`;
      snaps.push({
        kind: 'calc', ev: 'done', m, k, d, dummy, totalLen, io, levels, tree,
        log: `${dTxt}；虚段 = (k−1) − ((m−1) mod (k−1)) = ${k - 1} − (${(m - 1) % (k - 1)}) = **${dummy}** 个；总读写次数 = 2nd = 2×${totalLen}×${d} = ${io}。`,
        logType: 'success', desc: `结论：需要补 ${dummy} 个虚段；共 ${d} 趟归并，总读写 ${io} 个记录`,
      });
      return snaps;
    }

    /* ============ 模式① 置换-选择生成初始归并段 ============ */
    if (model.mode === 'runs') {
      const { seq, M } = model;
      const { runs, frames } = _exReplacementSelect(seq, M);
      const outRuns = [];
      const snapBase = () => ({
        kind: 'runs', M, seq, inCursor: 0,
        mem: [], frozenSet: [], win: null, lastOut: null,
        outRuns: outRuns.map(r => [...r]),
      });
      const push = (ev, o) => {
        const st = snapBase();
        snaps.push({ ...st, ...o, ev, log: '', logType: 'info', desc: '' });
      };
      push('init', {
        log: `就绪：输入流共 ${seq.length} 个记录，内存缓冲区 M=${M} 个记录。内存里维持最小堆，从堆顶取出并写回"外存归并段"。`,
        desc: '点击「单步执行」：先读满内存，再逐个输出堆顶',
      });

      /* ★ 回放：把 frames 的原始状态展开成"渲染要的全量状态"
       * ⚠ 纪律：**先应用状态变更、再 push 快照**。第一版在 `freeze`/`load` 帧里先 push 后 siftDown，
       *   于是渲染读到的是"上一步的堆"（渲染的堆顶与该帧刚输出的值对不上，且下一段的段首取错），
       *   而 memo 对账恰好只在"冻结+解冻"这种多段场景才暴露。改法见下：把 push 挪到变更之后。 */
      const mem = [], frozen = [];
      let cur = [], lastOut = null;                             /* 已输出记录数由 Σ段长 + cur.length 现算 */
      /* 段号只能这样现算：Σ(outRuns 各段长) + cur.length（**不能用 outRuns.length + cur.length**，
       * 那会在本段长到 1 之后每帧把段号多加一次，窗25 实测显示成 R2/R3/R4…） */
      const curSeg = () => outRuns.reduce((a, r) => a + r.length, 0) + cur.length + 1;
      const pushFrame = (ev, f) => {
        let log = '', logType = 'info', desc = '';
        if (ev === 'fill') { log = `读入 ${f.x} 放入内存（第 ${mem.length}/${M} 个），重建最小堆`; desc = `读入 ${f.x}`; }
        else if (ev === 'out') { log = `输出堆顶 ${f.x} 到当前归并段 R${curSeg()}（本段共 ${cur.length} 个记录）`; desc = `输出 ${f.x} → 段 R${curSeg()}`; }
        else if (ev === 'freeze') { log = `补入 ${f.x}：**比刚输出的 ${lastOut} 小**，本段放不下 ⟹ **冻结**，留给下一段`; logType = 'warn'; desc = `冻结 ${f.x}（< ${lastOut}）`; }
        else if (ev === 'load') { log = `补入 ${f.x}：≥ 刚输出的 ${lastOut}，可以接在本段后面 ⟹ 留在堆里参与比较`; desc = `读入 ${f.x}（可延续本段）`; }
        else if (ev === 'endRun') { log = `内存里 ${f.frozenN} 个记录被冻结，堆顶也是冻结的 ⟹ **本段结束**（刚写完 R${outRuns.length}，共 ${outRuns.length ? outRuns[outRuns.length - 1].length : 0} 个记录），**解冻全部记录**、重建最小堆`; logType = 'warn'; desc = `R${outRuns.length} 结束，解冻全部记录`; }
        else if (ev === 'newRun') { log = `开始第 ${curSeg()} 段：内存里 ${mem.length} 个记录全部重新参与比较，先输出最小的那个`; logType = 'warn'; desc = `开始第 ${curSeg()} 段`; }
        snaps.push({
          kind: 'runs', M, seq,
          inCursor: Math.min(f.inCursor !== undefined ? f.inCursor : 0, seq.length),
          mem: [...mem], frozenSet: frozen.map((v, i) => (v ? i : -1)).filter(i => i >= 0),
          win: ev === 'out' ? 0 : null, lastOut,
          outRuns: outRuns.map(r => [...r]), curLen: cur.length,
          ev, log, logType, desc: `${desc}｜已完成 ${outRuns.length} 段`,
        });
      };

      frames.forEach(f => {
        if (f.ev === 'fill') { mem.push(f.x); frozen.push(false); _exHeapify(mem, frozen); return pushFrame('fill', f); }
        if (f.ev === 'out' && f.drain) {
          mem.shift(); frozen.shift(); _exHeapify(mem, frozen);
          cur.push(f.x); lastOut = f.x;
          return pushFrame('out', f);
        }
        if (f.ev === 'out') { cur.push(f.x); lastOut = f.x; return pushFrame('out', f); }
        if (f.ev === 'freeze' || f.ev === 'load') {
          mem[0] = f.x; frozen[0] = f.frozenNow; _exSiftDown(mem, 0, frozen);
          return pushFrame(f.ev, f);
        }
        /* endRun：提交本段 + 解冻；newRun：空镜头（**绝不在这里再提交一次**，否则同一段会被提交两遍、
         * 而 cur 已空 ⟹ 段号会错，窗25 实测） */
        if (f.ev === 'endRun') {
          if (cur.length) outRuns.push([...cur]);
          cur = []; lastOut = null; frozen.fill(false); _exHeapify(mem, frozen);
          return pushFrame('endRun', f);
        }
        if (f.ev === 'newRun') { frozen.fill(false); _exHeapify(mem, frozen); return pushFrame('newRun', f); }
      });
      const lens = runs.map(r => r.length);
      const avg = (seq.length / runs.length).toFixed(2);
      snaps.push({
        kind: 'runs', M, seq, inCursor: seq.length, mem: [], frozenSet: [], win: null, lastOut: null,
        outRuns: runs.map(r => [...r]), curLen: 0,
        ev: 'done',
        log: `输入耗尽，内存里剩余记录也已按堆序成段输出完毕。共生成 ${runs.length} 个初始归并段，段长 [${lens.join(', ')}]，平均段长 ${avg}（M=${M}）。`,
        logType: 'success',
        desc: `完成！共 ${runs.length} 个初始归并段，平均段长 ${avg} 个记录`,
      });
      return snaps;
    }

    /* ============ 模式② k 路平衡归并 + 败者树 ============ */
    const { runs, k } = model;
    const cols = runs.map(r => [...r]);
    const ptrs = runs.map(() => 0);
    const total = cols.reduce((a, c) => a + c.length, 0);
    const out = [];
    let prevTree = null;

    /** 段号 seg（1..k）的当前键；段不存在或已耗尽 ⟹ +∞ */
    const keyOf = seg => {
      const i = seg - 1;
      if (i < 0 || i >= cols.length) return Infinity;
      return ptrs[i] < cols[i].length ? cols[i][ptrs[i]] : Infinity;
    };
    const allKeys = () => Array.from({ length: k + 1 }, (_, seg) => (seg === 0 ? Infinity : keyOf(seg)));

    const stateSnap = () => ({
      kind: 'merge', k, total, runsLen: runs.map(r => r.length),
      cols: cols.map(c => [...c]), ptrs: [...ptrs], out: [...out],
      tree: prevTree ? [...prevTree] : [], path: [], changed: [],
    });
    snaps.push({
      ...stateSnap(),
      ev: 'split',
      log: `把 ${total} 个记录按缓冲区 M=${model.M} 切成 ${runs.length} 个初始归并段（各段内部已升序）：${runs.map((r, i) => `R${i + 1}=[${r.join(' ')}]`).join('，')}。下面用 ${k} 路败者树把它们归并成一份有序文件。`
        + (model.kAsked && model.kAsked > k ? `（原定 k=${model.kAsked} 路，但只有 ${runs.length} 个段 ⟹ **实际按 ${k} 路**：多出来的"路"是空段，键取 +∞，放进败者树会让冠军永远是 +∞）` : ''),
      logType: 'info', desc: `已切出 ${runs.length} 个初始归并段，实际按 k=${k} 路归并`,
    });

    let guard = 0;
    while (out.length < total && guard++ < 4000) {
      const { tree, path, changed } = _exLoserTree(allKeys(), k, prevTree);
      prevTree = tree;
      const w = tree[0];
      if (!(w >= 1) || keyOf(w) === Infinity) break;          /* 所有段都耗尽 */
      const seg = cols[w - 1];
      const v = seg[ptrs[w - 1]];
      out.push(v); ptrs[w - 1]++;
      const doneNow = ptrs[w - 1] >= seg.length;
      snaps.push({
        ...stateSnap(), tree: [...tree], path, changed,
        ev: 'win',
        log: `败者树冠军 = **R${w}**（当前最小值 ${v}）⟹ 输出 ${v}；R${w} 的指针后移${doneNow ? `，**R${w} 已耗尽**（此后它的键取 +∞）` : `到 ${seg[ptrs[w - 1]]}`}`,
        logType: doneNow ? 'warn' : 'info',
        desc: `输出 ${v}（来自 R${w}）｜已输出 ${out.length}/${total}`,
      });
    }
    snaps.push({
      ...stateSnap(), tree: prevTree ? [...prevTree] : [], ev: 'done',
      log: `归并完毕：${runs.length} 个初始归并段按 k=${k} 路合并为一份含 ${total} 个记录的有序文件：${out.join(' ')}。`,
      logType: 'success', desc: `完成！归并结果共 ${total} 个有序记录`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;

    /* ============ 模式③：计算器 ============ */
    if (s.kind === 'calc') {
      if (s.ev !== 'done') {
        stage.innerHTML = `
          <div class="space-y-4">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              ${RC408.ui.statCard('初始归并段数 m', s.m, '由文件与内存共同决定', 'text-indigo-600') +
              RC408.ui.statCard('归并路数 k', s.k, '同时归并 k 个段', 'text-sky-600') +
              RC408.ui.statCard('归并趟数 d', '…', '每趟按 k 折减', 'text-amber-600') +
              RC408.ui.statCard('需补虚段', '…', '凑成严格 k 叉树', 'text-rose-600')}
            </div>
            <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 text-sm text-slate-500">
              已读入 ${s.m} 个初始归并段的长度：<span class="font-mono">${s.tree.levels[0] ? s.tree.levels[0].map(t => t.len).slice(0, 20).join(', ') : ''}${s.m > 20 ? ' …' : ''}</span>
              <br/>点击「单步执行」计算趟数、虚段个数与总读写次数。
            </div>
          </div>`;
        return;
      }
      const dummyCells = s.tree.levels[0] ? s.tree.levels[0].filter(t => t.dummy).length : 0;
      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${RC408.ui.statCard('初始归并段数 m', s.m, `总记录数 ${s.totalLen}`, 'text-indigo-600') +
            RC408.ui.statCard('归并趟数 d', s.d, `d = ⌈log_${s.k} ${s.m}⌉`, 'text-amber-600') +
            RC408.ui.statCard('需补虚段', s.dummy, `(k−1) − ((m−1) mod (k−1)) = ${s.k - 1} − ${(s.m - 1) % (s.k - 1)}`, 'text-rose-600') +
            RC408.ui.statCard('总读写次数', s.io, `2nd = 2×${s.totalLen}×${s.d}`, 'text-emerald-600')}
          </div>

          ${RC408.ui.sectionTitle('趟数怎么来的（每趟段数按 k 折减，直到只剩 1 段）')}
          <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
            ${s.levels.map((c, i) => `${i ? '<span class="text-slate-400">→</span>' : ''}${RC408.ui.chip(`${i === 0 ? '初始' : '第' + i + '趟后'} ${c} 段`, i === s.levels.length - 1 ? 'chip-mst' : 'chip-cur')}`).join('')}
            <span class="text-xs text-slate-500 ml-2">共 ${s.d} 趟归并（${s.d === 0 ? 'm=1，无需归并' : `每趟读写整份数据一遍 ⟹ 2×${s.totalLen}×${s.d} = ${s.io}`}）</span>
          </div>

          ${RC408.ui.sectionTitle(`最佳归并树（把段长当权值、按 ${s.k} 叉哈夫曼构造；虚段 = 白框）`)}
          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2 overflow-x-auto">
            ${s.tree.levels.map((lv, i) => `
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-bold text-slate-400 w-16 shrink-0">${i === 0 ? '叶（段）' : '第' + i + '次合并'}</span>
                ${lv.slice(0, 24).map(t => `<span class="ex-tnode chip ${t.dummy ? 'chip-future' : ''}" style="min-width:52px;justify-content:center">${t.dummy ? '虚段(0)' : `${t.label}<b class="ml-1">${t.len}</b>`}</span>`).join('')}
                ${lv.length > 24 ? `<span class="text-xs text-slate-400">… 共 ${lv.length} 个</span>` : ''}
              </div>`).join('')}
            <p class="text-xs text-slate-500 pt-1 border-t border-slate-100">
              共补 <b>${dummyCells}</b> 个虚段（长度 0，<b>不搬数据</b> ⟹ 不增加 I/O 次数）；两路归并（k=2）时 (k−1)=1，余数恒为 0 ⟹ <b>永不需要虚段</b>。
            </p>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1">
            <div><b>结论</b>：m=${s.m}、k=${s.k} ⟹ 补 <b class="text-rose-600">${s.dummy}</b> 个虚段，归并 <b class="text-amber-600">${s.d}</b> 趟，总读写 <b class="text-emerald-600">${s.io}</b> 个记录。</div>
            <div class="text-slate-500">总读写次数只由 <b>记录总数 n</b> 与 <b>趟数 d</b> 决定（2nd），与虚段个数、与各段具体长度分布无关。</div>
          </div>
        </div>`;
      return;
    }

    /* ============ 模式①：置换-选择生成初始归并段 ============ */
    if (s.kind === 'runs') {
      const frozenSet = new Set(s.frozenSet || []);
      const curRun = (s.outRuns && s.outRuns.length) ? s.outRuns[s.outRuns.length - 1] : [];
      const doneRuns = (s.outRuns || []).slice(0, Math.max(0, (s.outRuns || []).length - (curRun.length ? 1 : 0)));

      /* 内存槽位：固定 M 格，冻结的显示 ❄（★ 位置不移动——冻结只改标记） */
      const memCells = (s.mem || []).map((v, i) => {
        const fz = frozenSet.has(i);
        const isWin = s.win === i;
        const cls = fz ? 'chip-fault' : (isWin ? 'chip-cur' : 'chip-hit');
        return `<div class="ex-slot chip ${cls}" data-slot="${i}" style="min-width:46px;justify-content:center">
          <span class="ex-slot-val">${fz ? '❄' : ''}${v}</span>
          <span class="text-[9px] opacity-70 ml-1">s${i}</span>
        </div>`;
      }).join('');
      const emptySlots = Array.from({ length: Math.max(0, s.M - (s.mem || []).length) }, (_, i) =>
        `<div class="ex-slot chip chip-future" style="min-width:46px;justify-content:center"><span class="opacity-60">空</span><span class="text-[9px] opacity-60 ml-1">s${(s.mem || []).length + i}</span></div>`).join('');

      /* 输入流：已消费的灰、当前待读的橙圈、后面的白 */
      const inChips = (s.seq || []).map((v, i) => {
        const cls = i < s.inCursor ? 'chip-rej' : (i === s.inCursor ? 'chip-cur' : 'chip-future');
        return RC408.ui.chip(String(v), cls);
      }).join('');

      const runRows = (s.outRuns || []).map((r, i) => {
        const isCur = i === (s.outRuns || []).length - 1 && curRun.length > 0 && i === (s.outRuns.length - 1);
        return `<div class="flex items-center gap-2">
          <span class="text-[11px] font-bold ${isCur ? 'text-amber-600' : 'text-slate-400'} w-10 shrink-0">R${i + 1}</span>
          <div class="flex flex-wrap gap-1">${r.map(v => RC408.ui.chip(String(v), isCur ? 'chip-cur' : 'chip-mst')).join('')}</div>
          <span class="text-[11px] text-slate-400">${r.length} 个${isCur ? '（生长中）' : ''}</span>
        </div>`;
      }).join('');

      const lens = (s.outRuns || []).map(r => r.length);
      const avg = lens.length ? ((s.seq || []).length / lens.length).toFixed(2) : '0';
      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${RC408.ui.statCard('内存缓冲区 M', s.M, '固定 M 个槽位（❄ = 冻结）', 'text-indigo-600') +
            RC408.ui.statCard('已生成归并段', (s.outRuns || []).length, s.ev === 'done' ? `平均段长 ${avg}` : '正在生长最后一段', 'text-emerald-600') +
            RC408.ui.statCard('本段已输出', curRun.length, s.lastOut === null ? '本段还没输出' : `上次输出 ${s.lastOut}`, 'text-amber-600') +
            RC408.ui.statCard('输入流进度', `${s.inCursor}/${(s.seq || []).length}`, s.ev === 'done' ? '输入已耗尽' : '读入中', 'text-sky-600')}
          </div>

          ${RC408.ui.sectionTitle('输入流（灰 = 已读入内存；橙框 = 下一个待读）')}
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <span class="ex-in">${inChips}</span>
          </div>

          ${RC408.ui.sectionTitle('内存缓冲区（最小堆；❄ 冻结 = 本段放不下、留给下一段；槽位不移动）')}
          <div class="ex-slots rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3">
            ${memCells}${emptySlots}
          </div>

          ${RC408.ui.sectionTitle('外存：初始归并段（每段内部升序）')}
          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <div class="ex-runs">${runRows || '<div class="text-xs text-slate-400">还没有输出任何归并段</div>'}</div>
            <div class="text-xs text-slate-500 pt-1 border-t border-slate-100">
              段长 [${lens.join(', ') || '—'}]${s.ev === 'done' ? `　平均 ${avg} 个记录/段（M=${s.M}；随机输入平均≈2M，逆序最坏退化为 M）` : ''}
            </div>
          </div>

          <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
            ${RC408.ui.legend('#6366f1', '橙框 = 当前输出/待读的槽位')}
            ${RC408.ui.legend('#f87171', '❄ 冻结槽位（本段不再考虑）')}
            ${RC408.ui.legend('#10b981', '已并入归并段的记录')}
          </div>
        </div>`;
      return;
    }

    /* ============ 模式②：k 路归并 + 败者树 ============ */
    const k = s.k;
    /* 布局口径（与 §3.8-18「相对位置」同源）：**必须用"每个结点的叶区间"来定位**，
     * 不能用"2 的幂"那套公式——`_exLoserTree` 是按 [lo,hi] 分治建树的，k 非 2 的幂时
     * 结点的实际覆盖区间不等于 2^(depth-lv)（k=5 实测：nodeX 算出 766 而 viewBox 只有 476）。
     * 做法：先按同一套分治求出 {p: [lo,hi]}，结点 x = 区间中点对应的叶位、y = 深度对应层。 */
    const leafGap = 96, nodeGap = 78;
    const nodeRange = {};                                  /* p → [lo,hi]，lo===p */
    (function layout(p, lo, hi) {
      if (hi <= lo) { if (p <= k - 1) nodeRange[p] = [lo, hi]; return; }
      nodeRange[p] = [lo, hi];
      const mid = (lo + hi) >> 1;
      layout(2 * p, lo, mid);
      layout(2 * p + 1, mid + 1, hi);
    })(1, 1, k);
    const depthOf = p => {
      let d = 0, x = p; while (x > 1) { x >>= 1; d++; }
      return d;
    };
    const maxDepth = k >= 2 ? depthOf(k - 1) : 0;
    const leafX = seg => (seg - 1) * leafGap + 46;
    const nodeX = p => {
      const [lo, hi] = nodeRange[p] || [1, 1];
      return (leafX(lo) + leafX(hi)) / 2;
    };
    const nodeY = p => (p === 0 ? 30 : 30 + (maxDepth - depthOf(p) + 1) * nodeGap);
    const leafY = 30 + (maxDepth + 2) * nodeGap;
    const W = Math.max(leafX(k) + 46, 420);
    const H = leafY + 46;

    const changed = new Set(s.changed || []);
    const tree = s.tree || [];

    /* 树边 */
    let edges = '';
    for (let i = 0; i <= k - 1; i++) {
      const cx = nodeX(i), cy = nodeY(i);
      for (const child of [2 * i + 1, 2 * i + 2]) {
        let tx, ty;
        if (child <= k - 1) { tx = nodeX(child); ty = nodeY(child); }
        else {
          const seg = child - (k - 1);                 // 叶编号 1..k
          if (seg < 1 || seg > k) continue;
          tx = leafX(seg); ty = leafY;
        }
        const hot = changed.has(i) || changed.has(child);
        edges += `<line x1="${cx}" y1="${cy}" x2="${tx}" y2="${ty}" stroke="${hot ? '#f59e0b' : '#cbd5e1'}" stroke-width="${hot ? 3.5 : 2}"/>`;
      }
    }
    /* 内部结点：0 = 冠军（绿），1..k-1 = 败者（蓝） */
    let circles = '';
    for (let i = 0; i <= k - 1; i++) {
      const cx = nodeX(i), cy = nodeY(i);
      const seg = tree[i];
      const hot = changed.has(i);
      const isChamp = i === 0;
      const fill = isChamp ? '#10b981' : (hot ? '#f59e0b' : '#6366f1');
      const label = (seg === undefined || seg === 0) ? '—' : `R${seg}`;
      circles += `<g class="ex-tnode-g" data-node="${i}">
        <circle cx="${cx}" cy="${cy}" r="19" class="knode-circle" fill="${fill}"/>
        <text x="${cx}" y="${cy}" dy="0.35em" class="knode-text" style="font-size:11px">${label}</text>
        <text x="${cx}" y="${cy + 31}" text-anchor="middle" style="font:800 10px Consolas" fill="${isChamp ? '#059669' : '#64748b'}">${isChamp ? '冠军(胜者)' : '败者 p' + i}</text>
      </g>`;
    }
    /* 叶 = 各归并段当前段首值（段号 seg = 数据下标 seg-1） */
    (s.cols || []).forEach((c, idx) => {
      const seg = idx + 1;
      if (seg > k) return;
      const cx = leafX(seg), cy = leafY;
      const p = (s.ptrs || [])[idx] || 0;
      const v = p < c.length ? c[p] : null;
      const onPath = (s.path || []).includes(seg);
      circles += `<g class="ex-leaf-g" data-leaf="${seg}">
        <rect x="${cx - 34}" y="${cy - 15}" width="68" height="30" rx="9" fill="${v === null ? '#f1f5f9' : (onPath ? '#fffbeb' : '#eef2ff')}" stroke="${onPath ? '#f59e0b' : '#c7d2fe'}" stroke-width="${onPath ? 2.5 : 1.5}"/>
        <text x="${cx}" y="${cy}" dy="0.35em" text-anchor="middle" style="font:800 12px Consolas" fill="${v === null ? '#94a3b8' : '#3730a3'}">${v === null ? '+∞' : v}</text>
        <text x="${cx}" y="${cy + 30}" text-anchor="middle" style="font:800 10px Consolas" fill="#64748b">R${seg}${v === null ? '(耗尽)' : ''}</text>
      </g>`;
    });

    const colRows = (s.cols || []).map((c, i) => {
      const p = (s.ptrs || [])[i] || 0;
      return `<div>
        <span class="text-[11px] font-bold text-slate-500 w-8 shrink-0">R${i + 1}</span>
        <span class="ex-in">${c.map((v, j) => RC408.ui.chip(String(v), j < p ? 'chip-rej' : (j === p ? 'chip-cur' : 'chip-future'))).join('')}</span>
      </div>`;
    }).join('');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${RC408.ui.statCard('归并路数 k', k, `${(s.cols || []).length} 个初始归并段`, 'text-indigo-600') +
          RC408.ui.statCard('已输出', `${(s.out || []).length}/${s.total}`, '归并结果逐个产生', 'text-emerald-600') +
          RC408.ui.statCard('当前最小', (s.out || []).length ? s.out[s.out.length - 1] : '…', '刚输出的记录', 'text-amber-600') +
          RC408.ui.statCard('每输出 1 个的比较次数', `≤ ${Math.ceil(Math.log2(k))}`, `k−1=${k - 1} 次 → 败者树降为 ⌈log₂k⌉`, 'text-sky-600')}
        </div>

        ${RC408.ui.sectionTitle('各归并段剩余记录（橙框 = 当前段首；灰 = 已输出）')}
        <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2 ex-cols">${colRows}</div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            ${RC408.ui.sectionTitle('败者树（结点 = 归并段号；记"败者"，另设冠军结点）')}
            <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
              <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px" data-ex-tree="1">${edges}${circles}</svg>
            </div>
          </div>
          <div>
            ${RC408.ui.sectionTitle('归并输出（已产生的一份有序文件前缀）')}
            <div class="rounded-xl border border-slate-200 bg-white p-3 min-h-[92px]">
              <div class="ex-out">${(s.out || []).map(v => RC408.ui.chip(String(v), 'chip-mst')).join('') || '<span class="text-xs text-slate-400">还没有输出</span>'}</div>
            </div>
            <div class="text-xs text-slate-500 mt-2 leading-relaxed">
              输出值由 <b>冠军结点</b>给出；每输出一个记录，只沿 <b>该段的叶→根路径</b> 重比一次
              （高亮结点 = 本帧发生变动的结点）。段耗尽后其键取 <b>+∞</b>，不再夺冠。
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#10b981', '冠军结点（当前最小值所在的归并段号）')}
          ${RC408.ui.legend('#6366f1', '败者结点（记录败者所在的归并段号）')}
          ${RC408.ui.legend('#f59e0b', '本帧变动的结点 / 当前冠军所在路径')}
        </div>
      </div>`;
  },
});
