'use strict';
/* ============================================================================
 * ds-sort.js —— 【数据结构】排序算法全家桶（插入/希尔/冒泡/选择/快排/堆排/归并）
 * ----------------------------------------------------------------------------
 * 真题考情：2009–2026 共 18 年真题**每年必考 1~3 题**（exam-history 核实 18/18），固定套路：
 *   ① "给第 k 趟排序结果反推算法"（09/10/12/14/15/18/23/24/25…）；
 *   ② 算法性质辨析（比较次数/移动次数/稳定性/是否每趟确定一个最终位置）。
 * 本模块的"每趟结果表"即针对 ① 训练。
 *
 * 快照设计：每个"比较 / 移动(交换) / 归位"动作一帧，趟结束追加 pass 帧：
 *   { type:'compare'|'move'|'pass'|'init'|'done',
 *     arr       当前数组状态副本
 *     hi        本帧高亮的下标（比较对等）
 *     touched   本帧被写动的下标
 *     hole     快排"挖坑法"空位下标（pivotVal = 已取出的枢轴值）
 *     gap      希尔排序当前增量（分组标签渲染依据）
 *     sorted    已确定最终位置的下标（绿色）
 *     pivot     快排当前枢轴下标
 *     range     快排/归并当前工作区间 [lo,hi]
 *     stats     {compares, moves}
 *     passes    每趟结束时的数组快照（渲染"每趟结果表"） }
 * ----------------------------------------------------------------------------
 * ★ 窗51 小改（用户 2026-10-09 指出）：**"排序算法"下拉里的复杂度已去掉** ——
 *   原来写成「快速排序（平均 O(nlog₂n) · 不稳定）」，而**没写清那到底是时间复杂度还是空间复杂度**
 *   （`_SORT_META[x].cmp` 里既有平均/最坏混用、也有"约 O(n^1.3)"这种口径）。
 *   ⟹ 下拉只留**算法名 + 稳定性**；**两种复杂度（时间 / 空间）统一放到理论区那张表**
 *   （见 theory 里的「七种排序的时间复杂度 / 空间复杂度」表，平均 / 最好 / 最坏 + 空间分列）。
 *   `_SORT_META[x].cmp` 仍保留（统计卡与日志要用），但**不再进下拉文案**。
 * ========================================================================== */

/* 各算法的复杂度与稳定性（渲染统计卡用） */
const _SORT_META = {
  insertion: { name: '直接插入排序', cmp: 'O(n²)', stable: '稳定', best: '基本有序时 O(n)——真题高频辨析' },
  shell: { name: '希尔排序', cmp: '约 O(n^1.3)，依赖增量序列', stable: '不稳定', best: '组内排序是直接插入（2015 真题）；基本有序时效率高' },
  bubble: { name: '冒泡排序', cmp: 'O(n²)', stable: '稳定', best: '可提前终止（本趟无交换即有序）' },
  selection: { name: '简单选择排序', cmp: 'O(n²)', stable: '不稳定', best: '移动次数最少（最多 n−1 次）——2025 真题' },
  quick: { name: '快速排序', cmp: '平均 O(nlog₂n)', stable: '不稳定', best: '每趟确定一个元素的最终位置' },
  heap: { name: '堆排序', cmp: 'O(nlog₂n)', stable: '不稳定', best: '大根堆顺序存储，堆顶即最大值' },
  merge: { name: '二路归并排序', cmp: 'O(nlog₂n)', stable: '稳定', best: '第 k 趟后归并段长为 2ᵏ' },
};

RC408.registerModule({
  id: 'ds-sort',
  mode: 'stepper',
  title: '排序算法全家桶（逐动作 + 每趟结果）',

  theory: `
> **为什么要有它**：排序是全卷最高频考点（18/18 年）——考试不考"写排序代码"，而是考**能否由中间趟结果反推算法**、以及各算法的性质辨析。
> **怎么实现**：七种算法各有"一趟之后能保证什么"（见下表）；反推的钥匙就是这一列，外加"比较 / 移动次数"与"稳定性"两组性质。
> **记住什么**：**一趟特征表** +  **稳定性口诀"希选快堆"** + **与初始序列无关的量**（简单选择的移动次数；简单选择、归并、折半插入的比较次数）。

## 七种排序的"一趟"特征（反推算法的钥匙）

| 算法 | 一趟之后能保证什么 | 稳定性 |
| --- | --- | --- |
| 直接插入 | 前 i+1 个元素**局部有序**（位置未必最终） | 稳定 |
| 希尔（缩小增量） | 第 k 趟后**各增量组内**有序，整体"基本有序"，**无元素在最终位置**（最后一趟 d=1 除外） | 不稳定 |
| 冒泡 | 每趟冒出一个**最大值到最终位置**（尾部有序区 +1） | 稳定 |
| 简单选择 | 每趟选出最小值放到**最终位置**（头部有序区 +1） | 不稳定 |
| 快速排序 | 每趟**枢轴归位**（左侧 ≤ 枢轴 ≤ 右侧） | 不稳定 |
| 堆排序 | 每趟取出堆顶放到末尾（尾部有序区 +1） | 不稳定 |
| 二路归并 | 第 k 趟后所有**长度 \\(2^k\\) 的段内有序** | 稳定 |

## 时间复杂度 / 空间复杂度（**两种复杂度分开看**）

| 算法 | 时间复杂度（平均） | 最好 | 最坏 | **空间复杂度** | 稳定性 |
| --- | --- | --- | --- | --- | --- |
| 直接插入 | O(n²) | O(n)（原本有序，只比 1 次） | O(n²) | **O(1)** | 稳定 |
| 希尔 | 约 O(n^1.3)（依赖增量序列） | — | O(n²) | **O(1)** | 不稳定 |
| 冒泡 | O(n²) | O(n)（本趟无交换即提前结束） | O(n²) | **O(1)** | 稳定 |
| 简单选择 | O(n²) | O(n²) | O(n²) | **O(1)** | 不稳定 |
| 快速排序 | O(nlog₂n) | O(nlog₂n) | O(n²)（基本有序 / 逆序 + 取端点当枢轴） | **O(log₂n)**（递归栈，最坏 O(n)） | 不稳定 |
| 堆排序 | O(nlog₂n) | O(nlog₂n) | O(nlog₂n) | **O(1)** | 不稳定 |
| 二路归并 | O(nlog₂n) | O(nlog₂n) | O(nlog₂n) | **O(n)**（归并要等长辅助数组） | 稳定 |

- **只有归并需要 O(n) 额外空间**（要一块与原数组等长的辅助数组）；堆排、希尔、插入、冒泡、选择都是 \\(O(1)\\)；
- **快排的空间是递归栈**：平均深度 \\(O(\\log_2 n)\\)、最坏（每次只分出一个元素）退化到 \\(O(n)\\) —— 题目问"空间复杂度"时**别顺手写 O(1)**；
- **时间复杂度的三列要分清**：只有"快速排序"和"直接插入 / 冒泡"三者的平均与最坏不同（快排最坏 \\(O(n^2)\\)、插入与冒泡最好 \\(O(n)\\)），其余四种三列相同。

## 希尔排序（缩小增量）

- 取增量 \\(d_1=\\lfloor n/2 \\rfloor\\)，把下标模 \\(d_1\\) 同余的元素分成一组，各组内做**直接插入排序**；再取 \\(d_2=\\lfloor d_1/2 \\rfloor\\) 重复，直到 \\(d=1\\)；
- **最后一趟 \\(d=1\\)** 就是普通直接插入——前面各趟只是把序列调成"基本有序"，让最后一趟少移动；
- 只适用于**顺序存储**（要按下标 i±d 随机访问）、**不稳定**；组内排序方式是**直接插入**；
- 复杂度依赖增量序列，教材口径约 \\(O(n^{1.3})\\)，最坏 \\(O(n^2)\\)、空间 \\(O(1)\\)。

## 高频辨析结论

- **移动次数与初始序列无关**：简单选择、基数排序；**比较次数与初始序列无关**：简单选择、归并、折半插入；
- 基本有序选**直接插入**；n 大且随机选**快速排序**；要求 \\(O(1)\\) 空间选**堆排序**；
- **不稳定的四种**：希尔、简单选择、快速、堆排——口诀"**希选快堆**"；
- 快速排序适合顺序存储；堆排序用大根堆 + 顺序存储。

## 快排一趟划分：能保证什么、不能保证什么（2024-8 · 2023-11）

- 一趟划分只做两件事：**枢轴落到最终位置**；其余元素按"不大于枢轴 / 不小于枢轴"分到左右两块；
- **块间有序、块内无序**（2024-8 的原话）：左块任意元素都不大于枢轴、右块都不小于枢轴，但左块自己、右块自己都还是乱的——"第一趟后两块内部已各自有序"是错的；
- **由划分后的序列反推枢轴（2023-11）**：在序列里找满足"左边全不大于它、右边全不小于它"的元素，它就是枢轴，所在位置就是它的最终位置；
- 2023-11 的 68、11、70、23、80、77、48、81、93、88 里只有 **81** 满足（左边的 68~48 全小于 81、右边的 93 与 88 全大于 81），答案 **81**；68 被右边的 11 排除、70 与 80 被右边更小的数排除；
- 判据：**先试首、末两个候选**（最容易一眼排除），再试中间的；只看"左右两侧的大小关系"，与相邻元素无关。

## 第二趟结果怎么反推：枢轴个数 = 1 + 第一趟分出的块数（2014-11 · 2019-10）

- 先把"一趟"定死：**对所有尚未到位的元素各处理一遍**。第一趟只有一整块，所以只产生 1 个枢轴；此后每一块都要在下一趟里各自划分一次；
- 于是 **第二趟结束时的枢轴个数 = 1 + 第一趟分出的块数**：第一趟枢轴落在**端点**时只剩一块，第二趟后共 **2 个**枢轴；落在**中间**时分成两块，第二趟后共 **3 个**枢轴；
- 2019-10 的选项 5、2、12、28、16、32、72、60：能当枢轴的只有 **12** 与 **32**，两个都在中间——若第一趟就取其中之一，必然分出两块，第二趟必须再多一个枢轴，矛盾 ⟹ 它不可能是第二趟结果（答案就是这个选项）；其余三个选项都有一个端点上的枢轴（72 或 2），所以可能；
- 2014-11 用同一招：第二趟结束至少要有 **2 个**元素到位；只有 1 个满足"左小右大"的那个选项，连第一趟都不算走完；
- 判据：**数枢轴、看位置**——只有 2 个枢轴时，其中一个必须落在首或尾。

## 折半插入排序与链式存储（2012-11 · 2017-11）

- **折半插入 = 直接插入 + 用折半查找定位插入点**：两者趟数都是 n − 1、移动次数都只取决于初始序列（完全相同）、辅助空间都是 O(1)；
- 唯一的差别在**比较次数**：折半插入与初始序列**无关**，固定约 O(n log₂ n)；直接插入与初始序列有关（最好 O(n)、最坏 O(n²)）；
- **链式存储（2017-11）**：插入、选择、冒泡都不依赖随机访问，换链表后复杂度仍是 O(n²)；**希尔与堆排要靠下标跳着访问**（希尔按 i ± d、堆排按 2i 与 2i + 1），链表给不出，复杂度会变大 ⟹ 问"换成链式后哪些会变慢"答**希尔与堆排**；
- 判据：**问"哪种排序非顺序存储不可"，答案就是"要用下标算位置"的那几种**（希尔、堆排、折半插入、快排、归并的辅助数组）。

## 挑算法的四个因素与两两对比（2019-7 · 2020-11 · 2022-11 · 2025-10）

- **挑算法要看四样**（2019-7，答案"四样都要"）：数据的规模、数据的存储方式、算法的稳定性、数据的初始状态——题干说"除时空效率外"，这四样都算；
- **直接插入 vs 简单选择（2020-11，答案"仅比较次数"）**：基本有序时直接插入每趟只比 1 次（合计 O(n)），简单选择每趟都要扫完剩余部分（恒 O(n²)）⟹ 只有"比较次数更少"成立；两者辅助空间都是 O(1)、移动次数都不多，"空间更少 / 移动更少"都错；
- **直接插入 vs 快速排序（2022-11）**：大部分元素已有序、元素个数少 ⟹ 直接插入（最好 O(n)、空间 O(1)、稳定）；基本无序、个数多 ⟹ 快排（平均 O(n log₂ n)，但空间 O(log₂ n)、不稳定）；
- **最坏情况下移动最少（2025-10）**：简单选择只做 n − 1 次交换（O(n)），而冒泡、插入、快排最坏都是 O(n²) ⟹ 移动最少选**简单选择**；
- 判据：**"移动"与"比较"分开数**——简单选择是"比较多、移动少"的典型，别把两者混成一句。

## "比较次数最少"要真数，不能凭看起来有序（2026-9）

- 直接插入排序的比较次数 = 每趟"往前比到第一个不大于它的元素"的比较次数之和（含最后那一次失败的比较）；
- 2026-9 的四个选项逐个算得 **9 / 8 / 16 / 16** 次（逆序对 4 / 3 / 12 / 12），最少的是第二个选项（8 次）；
- 规律：**逆序对越少、比较次数越少**，但"逆序对少"不等于"看起来整齐"——第一个选项 30、27、56、41、80、95、69 看着前段还挺顺，实际有 4 个逆序对；
- 判据：**逐趟数出来**（每趟至少 1 次比较，每发生一次移位再加 1 次）；一路比到表头的那一趟少比一次。

## 二路归并的一趟与比较次数（2022-10 · 2024-10）

- **归并的定义**（2022-10）：把**两个或两个以上**的有序表合并成一个新的有序表；二路归并就是每次合并两个；
- 一趟二路归并 = 把相邻的、各长 2^(k−1) 的有序段两两合并，得到长度加倍的新段；
- **两个有序表合并的最坏比较次数 = m + n − 1**（一直比到其中一个表尾，另一个表剩下的元素直接搬走、不再比较）；
- 2024-10 就是数这条：3、5 与 7、9 合并只需 2 次比较（3 与 7 比、5 与 7 比）就把前一段搬完，后一段整段接上；
- 判据：**"合并 n 个元素要比较几次"问的是最坏情况**，先想 m + n − 1，再想"挑最短的两个先并"（最佳归并树）。

## 考点提醒（易错点）

1. **反推题先看"有没有元素落到最终位置"**：有 → 冒泡 / 选择 / 快排 / 堆排；整体只是"基本有序、谁都没到位" → 希尔；前段局部有序 → 直接插入；
2. 归并的"第 k 趟"要说清**段长 \\(2^k\\)**（趟数 \\(=\\lceil \\log_2 n \\rceil\\)）；k 路归并的趟数 \\(=\\lceil \\log_k m \\rceil\\)（增大 k 可减少趟数，但受可用内存限制）；
3. **快速排序每趟只保证枢轴到位**，其余元素只是被分到两侧；递归深度最坏 \\(O(n)\\)；
4. 2021-42 大题给了一段排序算法代码，问比较次数与稳定性——该算法**不在考纲排序列表内**，属读代码题，会读即可。

> **真题考情**：**18/18 年（30 题·全选择）**：2009-10 2010-10·11 2011-10 2012-10·11 2013-11 2014-10·11 2015-9·11
> 2016-11 2017-10·11 2018-10 2019-7·10 2020-11 2021-10 2022-10·11 2023-10·11 2024-8·10 2025-10·11 2026-9·10·11
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'algo', label: '排序算法', type: 'select', default: 'quick', wide: true,
      /* ⚠ 窗51：下拉**只留算法名 + 稳定性**，复杂度一律不进选项（用户：原写法"没说清是时间还是空间复杂度"）
         —— 两种复杂度见理论区那张表（theory 的「时间复杂度 / 空间复杂度」表）。 */
      options: Object.entries(_SORT_META).map(([v, m]) => ({ v, t: `${m.name}（${m.stable}）` })),
    },
    { key: 'seq', label: '待排序序列（8~12 个，1~99）', default: '49,38,65,97,76,13,27,49', wide: true, help: '默认序列为王道教材经典例题：注意有两个 49，可检验稳定性' },
  ],

  quickActions: [
    { label: '🎲 随机序列', run(rt) { rt.setInput('seq', Array.from({ length: RC408.util.rnd(8, 10) }, () => RC408.util.rnd(10, 99)).join(',')); rt.load(); } },
    { label: '基本有序(选插入最优)', run(rt) { rt.setInput('seq', '13,27,49,38,65,76,88,97'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const arr = vals.seq.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (arr.length < 4) throw { message: '至少输入 4 个元素' };
    if (arr.length > 12) throw { message: '最多 12 个元素（便于展示每一步）' };
    if (arr.some(v => v < 1 || v > 99)) throw { message: '元素取值请控制在 1 ~ 99' };
    const algo = _SORT_META[vals.algo] ? vals.algo : 'quick';
    return { arr, algo };
  },

  /* ---------------- ② 纯算法：六种排序产出快照 ---------------- */
  buildSnapshots(model) {
    const { algo } = model;
    const n0 = model.arr.length;
    const a = [...model.arr];
    const st = { compares: 0, moves: 0 };
    const passes = [];
    const sorted = [];
    const snaps = [];
    let passNo = 0;

    const snap = (type, extra = {}) => snaps.push({
      type, arr: [...a],
      hi: [], touched: [], sorted: [...sorted], range: null,
      hole: null, pivotVal: null,          // 快排"挖坑法"：空位下标 + 已取出的枢轴值
      gap: null,                           // 希尔排序当前增量（null = 非希尔帧）
      stats: { ...st }, passes: passes.map(p => ({ label: p.label, arr: [...p.arr] })),
      passName: passes.length ? passes[passes.length - 1].label : '尚未完成任何一趟',
      log: '', desc: '', ...extra,
    });
    const passEnd = (label, log) => {
      passNo++;
      passes.push({ label, arr: [...a] });
      snap('pass', { log, desc: `${label}：${a.join(', ')}`, passLabel: label });
    };

    snap('init', { log: `就绪：${_SORT_META[algo].name} 排序 [${a.join(', ')}]，共 ${n0} 个元素。`, logType: 'info', desc: '点击「单步执行」；每帧 = 一次比较或一次移动' });

    const swap = (i, j, log) => { const t = a[i]; a[i] = a[j]; a[j] = t; st.moves++; snap('move', { touched: [i, j], log, desc: log }); };

    if (algo === 'insertion') {
      for (let i = 1; i < n0; i++) {
        const key = a[i];
        snap('compare', { hi: [i], log: `取出待插入关键字 a[${i}] = ${key}，向前寻找插入位置`, desc: `第 ${i} 趟：插入 ${key}` });
        let j = i - 1;
        while (j >= 0) {
          st.compares++;
          snap('compare', { hi: [j], log: `比较 a[${j}] = ${a[j]} 与待插入值 ${key}：${a[j] > key ? '大于 → 继续后移' : '不大于 → 找到位置'}`, desc: `比较 ${a[j]} 与 ${key}` });
          if (a[j] <= key) break;
          a[j + 1] = a[j]; st.moves++;
          snap('move', { touched: [j + 1], log: `a[${j}] = ${a[j]} 后移一位`, desc: `${a[j]} 后移` });
          j--;
        }
        a[j + 1] = key; st.moves++;
        snap('move', { touched: [j + 1], log: `${key} 插入到位置 ${j + 1}`, desc: `${key} 插入位置 ${j + 1}` });
        passEnd(`第 ${i} 趟（插入 ${key}）`, `第 ${i} 趟完成：前 ${i + 1} 个元素局部有序`);
      }
    }

    if (algo === 'shell') {
      /* 增量序列（王道教材口径）：d1=⌊n/2⌋，之后逐趟减半，最后一趟 d=1。
         每趟 = 当前增量下全部分组各做一次组内直接插入；组内元素下标 g, g+d, g+2d, … */
      const gaps = [];
      for (let d = Math.floor(n0 / 2); d > 0; d = Math.floor(d / 2)) gaps.push(d);
      gaps.forEach((d, gi) => {
        snap('compare', { gap: d, log: `第 ${gi + 1} 趟开始：增量 d=${d}，分成 ${d} 组（图中同色同组），各组内进行直接插入排序${d === 1 ? '。d=1 即普通直接插入，保证最终有序' : ''}`, desc: `第 ${gi + 1} 趟：增量 d=${d}，分 ${d} 组` });
        for (let g = 0; g < d; g++) {
          for (let i = g + d; i < n0; i += d) {
            const key = a[i];
            snap('compare', { gap: d, hi: [i], log: `组 ${g + 1}：取出 a[${i}] = ${key}，在组内（下标差 ${d} 的元素间）向前寻找插入位置`, desc: `d=${d}：组 ${g + 1} 插入 ${key}` });
            let j = i - d;
            while (j >= 0) {
              st.compares++;
              snap('compare', { gap: d, hi: [j], log: `比较同组前驱 a[${j}] = ${a[j]} 与待插入值 ${key}：${a[j] > key ? '大于 → 组内后移 d 位' : '不大于 → 找到插入位置'}`, desc: `比较 ${a[j]} 与 ${key}（同组）` });
              if (a[j] <= key) break;
              a[j + d] = a[j]; st.moves++;
              snap('move', { gap: d, touched: [j + d], log: `a[${j}] = ${a[j]} 组内后移 ${d} 位到 a[${j + d}]`, desc: `${a[j]} 后移 ${d} 位` });
              j -= d;
            }
            if (j + d !== i) {
              a[j + d] = key; st.moves++;
              snap('move', { gap: d, touched: [j + d], log: `${key} 插入到 a[${j + d}]（组 ${g + 1} 内的位置）`, desc: `${key} 插入 a[${j + d}]` });
            }
          }
        }
        passEnd(`第 ${gi + 1} 趟（增量 d=${d}）`, `增量 ${d} 的一趟完成：各组内局部有序，整体更接近有序${d === 1 ? '，且 d=1 后整体有序' : ''}`);
      });
    }

    if (algo === 'bubble') {
      for (let i = 0; i < n0 - 1; i++) {
        let swapped = false;
        for (let j = 0; j < n0 - 1 - i; j++) {
          st.compares++;
          snap('compare', { hi: [j, j + 1], log: `比较相邻元素 a[${j}]=${a[j]} 与 a[${j + 1}]=${a[j + 1]}：${a[j] > a[j + 1] ? '逆序 → 交换' : '正序 → 不动'}`, desc: `比较 ${a[j]} 与 ${a[j + 1]}` });
          if (a[j] > a[j + 1]) { swap(j, j + 1, `交换 ${a[j + 1]} 与 ${a[j]}`); swapped = true; }
        }
        for (let k = n0 - 1 - i; k < n0; k++) if (!sorted.includes(k)) sorted.push(k);
        passEnd(`第 ${i + 1} 趟`, `第 ${i + 1} 趟完成：最大值 ${a[n0 - 1 - i]} 冒泡到最终位置（末尾 ${i + 1} 个已就位）`);
        if (!swapped) {
          for (let k = 0; k < n0; k++) if (!sorted.includes(k)) sorted.push(k);
          snap('pass', { log: `本趟未发生任何交换 → 序列已整体有序，提前终止（冒泡的优势）`, desc: '提前终止' });
          break;
        }
      }
    }

    if (algo === 'selection') {
      for (let i = 0; i < n0 - 1; i++) {
        let min = i;
        snap('compare', { hi: [i], log: `第 ${i + 1} 趟：从 a[${i}..${n0 - 1}] 中选最小值，暂定 a[${i}]=${a[i]}`, desc: `第 ${i + 1} 趟选择最小值` });
        for (let j = i + 1; j < n0; j++) {
          st.compares++;
          snap('compare', { hi: [min, j], log: `比较 a[${j}]=${a[j]} 与当前最小 a[${min}]=${a[min]}：${a[j] < a[min] ? '更小 → 更新 min' : '不更小'}`, desc: `比较 ${a[j]} 与 ${a[min]}` });
          if (a[j] < a[min]) min = j;
        }
        if (min !== i) swap(i, min, `最小值 ${a[min]} 与 a[${i}] 交换（一次交换确定一个最终位置）`);
        else snap('move', { hi: [i], log: `a[${i}] 本就是最小值，无需交换`, desc: '无需交换' });
        for (let k = 0; k <= i; k++) if (!sorted.includes(k)) sorted.push(k);
        passEnd(`第 ${i + 1} 趟`, `第 ${i + 1} 趟完成：${a[i]} 归位（头部 ${i + 1} 个已就位）`);
      }
    }

    if (algo === 'quick') {
      let passCount = 0;
      /* 挖坑法：枢轴取出后原位置成为"空位"，每填入一个元素，空位就移到被取走元素的位置。
         快照用 hole（空位下标）+ pivotVal（暂存的枢轴值）记录，渲染时空位画虚线框，
         避免出现"两个相同元素"的迷惑画面 */
      const qs = (lo, hi) => {
        if (lo >= hi) return;
        const pivot = a[lo];
        let i = lo, j = hi;
        snap('compare', { hole: lo, pivotVal: pivot, range: [lo, hi], hi: [lo], log: `挖坑：取出 a[${lo}] = ${pivot} 作为枢轴暂存 → 位置 ${lo} 成为空位（虚线框），low 从左找大、high 从右找小`, desc: `划分 [${lo}, ${hi}]，枢轴 = ${pivot}（已取出，挖坑）` });
        while (i < j) {
          while (i < j) {
            st.compares++;
            snap('compare', { hole: i, pivotVal: pivot, range: [lo, hi], hi: [j], log: `high 指针：比较 a[${j}]=${a[j]} 与枢轴 ${pivot}：${a[j] >= pivot ? '≥ 枢轴 → j 左移' : '< 枢轴 → 填入左侧空位'}`, desc: `high 扫描：${a[j]} vs ${pivot}` });
            if (a[j] < pivot) break;
            j--;
          }
          if (i < j) { a[i] = a[j]; st.moves++; snap('move', { hole: j, pivotVal: pivot, range: [lo, hi], touched: [i], log: `a[${j}] = ${a[j]} 填入左侧空位 a[${i}] → 空位移到位置 ${j}`, desc: `${a[j]} 填坑，空位换到 ${j}` }); }
          while (i < j) {
            st.compares++;
            snap('compare', { hole: j, pivotVal: pivot, range: [lo, hi], hi: [i], log: `low 指针：比较 a[${i}]=${a[i]} 与枢轴 ${pivot}：${a[i] <= pivot ? '≤ 枢轴 → i 右移' : '> 枢轴 → 填入右侧空位'}`, desc: `low 扫描：${a[i]} vs ${pivot}` });
            if (a[i] > pivot) break;
            i++;
          }
          if (i < j) { a[j] = a[i]; st.moves++; snap('move', { hole: i, pivotVal: pivot, range: [lo, hi], touched: [j], log: `a[${i}] = ${a[i]} 填入右侧空位 a[${j}] → 空位移到位置 ${i}`, desc: `${a[i]} 填坑，空位换到 ${i}` }); }
        }
        a[i] = pivot; st.moves++;
        if (!sorted.includes(i)) sorted.push(i);
        snap('move', { hole: null, pivotVal: null, touched: [i], log: `枢轴 ${pivot} 填入最后一个空位 a[${i}]，归位：左侧均 ≤ ${pivot}，右侧均 ≥ ${pivot}`, desc: `枢轴 ${pivot} 归位` });
        passEnd(`第 ${++passCount} 趟（枢轴 ${pivot} 归位）`, `一趟划分完成：枢轴 ${pivot} 位于最终位置`);
        qs(lo, i - 1);
        qs(i + 1, hi);
      };
      qs(0, n0 - 1);
    }

    if (algo === 'heap') {
      const sift = (root, len) => {
        while (true) {
          let child = 2 * root + 1;
          if (child >= len) break;
          if (child + 1 < len) {
            st.compares++;
            snap('compare', { hi: [child, child + 1], log: `比较左右孩子 a[${child}]=${a[child]} 与 a[${child + 1}]=${a[child + 1]}，取较大者`, desc: '左右孩子比较' });
            if (a[child + 1] > a[child]) child++;
          }
          st.compares++;
          snap('compare', { hi: [root, child], log: `比较父结点 a[${root}]=${a[root]} 与较大孩子 a[${child}]=${a[child]}：${a[child] > a[root] ? '孩子更大 → 交换下沉' : '堆性质满足 → 结束筛选'}`, desc: `父子比较：${a[root]} vs ${a[child]}` });
          if (a[root] >= a[child]) break;
          swap(root, child, `交换 a[${root}] 与 a[${child}]，继续向下筛选`);
          root = child;
        }
      };
      for (let i = Math.floor(n0 / 2) - 1; i >= 0; i--) sift(i, n0);
      snap('pass', { log: `初始大根堆建立完成（自最后一个非叶结点向前逐一筛选）：堆顶 a[0]=${a[0]} 为最大值`, desc: '建堆完成', range: null });
      passEnd(`建堆完成`, `初始堆：${a.join(', ')}`);
      for (let end = n0 - 1; end > 0; end--) {
        swap(0, end, `堆顶 ${a[end]} 与末尾 a[${end}] 交换 → ${a[end]} 归位`);
        if (!sorted.includes(end)) sorted.push(end);
        sift(0, end);
        passEnd(`第 ${n0 - end} 趟（取堆顶）`, `第 ${n0 - end} 趟完成：当前最大值归位，剩余 ${end} 个元素重新成堆`);
      }
      if (!sorted.includes(0)) sorted.push(0);
    }

    if (algo === 'merge') {
      let width = 1, passCount = 0;
      while (width < n0) {
        for (let lo = 0; lo < n0; lo += 2 * width) {
          const mid = Math.min(lo + width, n0), hi = Math.min(lo + 2 * width, n0);
          if (mid >= hi) continue;
          const aux = [];
          let p = lo, q = mid;
          while (p < mid && q < hi) {
            st.compares++;
            snap('compare', { hi: [p, q], range: [lo, hi - 1], log: `归并 [${lo},${mid - 1}] 与 [${mid},${hi - 1}]：比较两段队首 a[${p}]=${a[p]} 与 a[${q}]=${a[q]}，取小者进入辅助数组`, desc: `归并比较 ${a[p]} 与 ${a[q]}` });
            aux.push(a[p] <= a[q] ? a[p++] : a[q++]);
          }
          while (p < mid) aux.push(a[p++]);
          while (q < hi) aux.push(a[q++]);
          for (let k = 0; k < hi - lo; k++) a[lo + k] = aux[k];
          st.moves += hi - lo;
          snap('move', { touched: Array.from({ length: hi - lo }, (_, k) => lo + k), range: [lo, hi - 1], log: `归并结果 [${aux.join(', ')}] 写回 a[${lo}..${hi - 1}]`, desc: `写回区间 [${lo}, ${hi - 1}]` });
        }
        width *= 2;
        passEnd(`第 ${++passCount} 趟归并（段长 ${width}）`, `第 ${passCount} 趟归并完成：所有长度 ${width} 的段内部有序`);
      }
    }

    for (let k = 0; k < n0; k++) if (!sorted.includes(k)) sorted.push(k);
    snap('done', { log: `排序完成：[${a.join(', ')}]。共比较 ${st.compares} 次、移动 ${st.moves} 次。`, logType: 'success', desc: `完成！比较 ${st.compares} 次，移动 ${st.moves} 次` });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const n = s.arr.length;
    const meta = _SORT_META[model.algo];
    const maxV = Math.max(...s.arr, 10);
    const W = n * 48 + 30, H = s.gap ? 266 : 250;
    const barW = 34, gap = 14;

    /* 柱状图 + 数值（快排挖坑法：空位画虚线框） */
    const bars = s.arr.map((v, i) => {
      const x = 20 + i * (barW + gap);
      const isHole = s.hole === i;
      if (isHole) {
        return `
        <rect x="${x}" y="177" width="${barW}" height="28" rx="5" fill="#eef2ff" stroke="#6366f1" stroke-dasharray="4 3"/>
        <text x="${x + barW / 2}" y="196" text-anchor="middle" style="font:800 11px Consolas,monospace" fill="#4338ca">空位</text>
        <text x="${x + barW / 2}" y="222" text-anchor="middle" style="font:600 10px sans-serif" fill="#6366f1">${i}</text>`;
      }
      const h = 18 + Math.round((v / maxV) * 160);
      const isHi = s.hi.includes(i);
      const isTouch = s.touched.includes(i);
      const isSorted = s.sorted.includes(i);
      const inRange = s.range && i >= s.range[0] && i <= s.range[1];
      let color = '#94a3b8';
      if (isSorted) color = '#10b981';
      else if (isTouch) color = '#f43f5e';
      else if (isHi) color = '#f59e0b';
      else if (inRange) color = '#64748b';
      return `
        <rect x="${x}" y="${205 - h}" width="${barW}" height="${h}" rx="5" fill="${color}" opacity="${inRange || isHi || isTouch || isSorted ? 1 : 0.75}"/>
        <text x="${x + barW / 2}" y="${205 - h - 6}" text-anchor="middle" style="font:800 12px Consolas,monospace" fill="${isHi || isTouch ? '#334155' : '#64748b'}">${v}</text>
        <text x="${x + barW / 2}" y="222" text-anchor="middle" style="font:600 10px sans-serif" fill="#94a3b8">${i}</text>`;
    }).join('');

    const rangeNote = s.range ? `<text x="${20 + s.range[0] * (barW + gap)}" y="242" style="font:700 11px sans-serif" fill="#6366f1">↳ 当前工作区间 [${s.range[0]}, ${s.range[1]}]</text>` : '';

    /* 希尔排序：当前增量下的分组标签（同色同组，组内做直接插入） */
    const GROUP_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];
    const groupTags = s.gap ? s.arr.map((v, i) => {
      const x = 20 + i * (barW + gap);
      const gid = i % s.gap;
      const c = GROUP_COLORS[gid % GROUP_COLORS.length];
      return `<rect x="${x}" y="230" width="${barW}" height="15" rx="4" fill="${c}" opacity="0.14"/>
        <text x="${x + barW / 2}" y="241" text-anchor="middle" style="font:700 9px sans-serif" fill="${c}">组${gid + 1}</text>`;
    }).join('') : '';

    /* 每趟结果表（真题反推训练） */
    const passRows = s.passes.map((p, i) => `
      <tr class="${i === s.passes.length - 1 && s.type === 'pass' ? 'row-cur' : ''}">
        <td class="font-bold whitespace-nowrap">${p.label}</td>
        <td class="font-mono">${p.arr.join(', ')}</td>
      </tr>`).join('');
    const passTable = s.passes.length ? `
      <div>
        ${RC408.ui.sectionTitle('每趟结果表（真题套路：给中间结果反推算法——对照上方"一趟特征"表）')}
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="tbl w-full"><thead><tr><th>趟次</th><th>序列状态</th></tr></thead><tbody>${passRows}</tbody></table>
        </div>
      </div>` : '';

    const stats =
      RC408.ui.statCard('算法', meta.name, `${meta.cmp} · ${meta.stable}`, 'text-indigo-600') +
      RC408.ui.statCard('比较次数', s.stats.compares, '与初始序列是否有关？', 'text-amber-600') +
      RC408.ui.statCard('移动/交换次数', s.stats.moves, '简单选择的移动与初始序列无关', 'text-rose-600') +
      RC408.ui.statCard('最新一趟', s.passName || '—', `${s.passes.length} 趟已完成`, 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${Math.max(W, 520)}px">
            ${bars}${rangeNote}${groupTags}
          </svg>
        </div>

        ${s.pivotVal !== null && s.pivotVal !== undefined ? `
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          🎯 <b>挖坑法进行中：</b>枢轴 <b>${s.pivotVal}</b> 已取出暂存（不属于任何位置），图中虚线框是当前<b>空位</b>；
          每填入一个元素，空位就移到被取走元素的位置——所以过程中数组会出现"少一个枢轴"的中间态，划分结束时枢轴填入最后的空位。
        </div>` : ''}

        ${passTable}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '正在比较')}
          ${RC408.ui.legend('#f43f5e', '本帧被移动/交换')}
          ${RC408.ui.legend('#6366f1', '空位（枢轴已取出暂存）')}
          ${s.gap ? RC408.ui.legend('#10b981', '组标签：当前增量 d 的分组（同色同组，组内直接插入）<br>——每完成一趟，增量减半重新分组') : RC408.ui.legend('#10b981', '已确定最终位置')}
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>${meta.best}。用"每趟结果表"练习反推：冒泡/选择/堆排每趟确定一个最终位置（绿色），
          快排每趟枢轴归位，归并第 k 趟段长 2ᵏ，插入只有前缀局部有序，
          ${s.gap ? '希尔中途<b>没有任何元素位于最终位置</b>（整体只是基本有序）——这正是它区别于其他算法的反推特征。' : '希尔中途则无元素保证最终位置。'}
        </div>
      </div>`;
  },
});
