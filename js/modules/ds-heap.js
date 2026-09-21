'use strict';
/* ============================================================================
 * ds-heap.js —— 【数据结构】堆与优先队列（完全二叉树 ⇄ 顺序存储 · 建堆 / 插入 / 删除堆顶）
 * ----------------------------------------------------------------------------
 * 前缀：_hp（所有顶层函数/常量都带前缀，避免经典 script 全局污染，见 handover §3.1-3）
 *
 * 快照设计（§1.3 铁律：每帧全量携带，回退/跳帧才不出错）：
 *   step: init | scan | cmp | swap | stop | place | take | pop | done
 *   arr   当前堆的**下标 1 基**数组副本（arr[i] = {v,id} 或 null；arr[0] 恒为 null）
 *   n     当前堆的**大小**（元素个数）；数组**容量**固定为 Nmax —— 两者不是一回事（考点）
 *   pos   本帧每个元素 id → 完全二叉树坐标 {x,y}（坐标只由"数组下标"决定，与算法进度无关）
 *   from  上一帧坐标副本（渲染用它做位移动画；缺 id = 本帧新插入的元素，从下方淡入）
 *   heapFull  本帧是否为"一次操作已完成"的稳定状态 —— 只有这些帧才保证整棵树是合法堆
 *             （§3.8-2：建堆中途的下标区间还不是堆，不能拿堆性质去套过渡帧）
 *
 * 为什么每帧都要重算 pos 而不是"固定槽位"（对比 §3.1-5 的 BST/AVL）：
 *   堆的**槽位就是数组下标**，完全二叉树的形态只由 Nmax 决定，所以槽位天然固定；
 *   动的是"槽位里装的元素"。于是**边完全静态**（父 ⌊i/2⌋ → 子 i 的连线永不改变），
 *   只有结点（元素）在槽位间平移 —— 不需要 BST/AVL 那套"边用相似变换跟随"的复杂做法。
 *
 * 与 ds-sort 的分工（handover §6.3-9 ⚠ 明确要求）：
 *   本模块讲**堆的结构与调整**（自底向上建堆筛选 / 插入上浮 / 删除堆顶下沉 / 判堆 / 优先队列）；
 *   ds-sort 讲**堆排序的过程**（反复取堆顶、尾部有序区扩大、每趟结果表）。两者不重复讲。
 * ⚠ 登记口径（窗14 从 theory 移到这里，避免占用考生视线）：按"选择题尽量只归一个知识点"，
 *   2018-11（建堆的序列变化过程）与 2024-9（两次删除后的新堆）从「排序算法全家桶」移入本模块；
 *   只问排序性质、堆排序仅作选项的题（2012-10、2016-11、2017-11、2023-10）仍归排序模块。
 *   考情：18 年中 8 年（选 7 题：2009-9、2011-11、2015-10、2018-11、2020-9、2021-11、2024-9；
 *   大 2022-42），且 **18 年真题从未直接考"优先队列"这个词**。
 *
 * 口径：堆是**完全二叉树**，用顺序存储（下标 1 基：双亲 ⌊i/2⌋、左孩子 2i、右孩子 2i+1）；
 *   大根堆要求 a[i] ≥ a[2i] 且 a[i] ≥ a[2i+1]，小根堆反之；**允许重复关键字**（与 BST 不同）。
 * ========================================================================== */

/* ------------------------------ 布局常量（_hp 前缀） ------------------------------ */
const _hpTop   = 64;    // 根结点中心 y（上方要放得下"待取出"角标）
const _hpLevel = 88;    // 层间距
const _hpGapT  = 86;    // 树底 → 数组行顶部的空隙（放交换弧线与文字）
const _hpCellH = 34;    // 数组格子高
const _hpPad   = 40;    // 左右留边
const _hpDur   = '0.55s';
const _hpEase  = 'cubic-bezier(.4,0,.2,1)';

/* ------------------------------ 纯工具（_hp 前缀） ------------------------------ */

/** 完全二叉树层号（根 = 0），下标 1 基 */
function _hpLv(i) { return Math.floor(Math.log2(Math.max(1, i))); }

/** 结点半径：越深越小，避免同层相碰 */
function _hpR(d) { return d === 0 ? 21 : (d === 1 ? 18 : 15); }

/** 堆的树高（结点数 n 的完全二叉树高）= ⌊log₂n⌋ + 1 */
function _hpHeight(n) { return n <= 0 ? 0 : _hpLv(n) + 1; }

/** 几何：给定**容量** Nmax（一次演示中出现过的最大元素数），算出全部槽位坐标与画布尺寸 */
function _hpGeo(Nmax) {
  const N = Math.max(1, Nmax | 0);
  const depth = _hpLv(N);
  const W = Math.max(560,
    2 * _hpPad + Math.pow(2, depth) * (2 * _hpR(depth) + 26),
    N * 46 + 48);
  const x = [0], y = [0], r = [0];
  for (let i = 1; i <= N; i++) {
    const d = _hpLv(i), cnt = Math.pow(2, d), k = i - cnt;
    x[i] = _hpPad + (W - 2 * _hpPad) * (2 * k + 1) / (2 * cnt);
    y[i] = _hpTop + d * _hpLevel;
    r[i] = _hpR(d);
  }
  const cellW = Math.min(54, Math.max(28, (W - 48) / N));
  const treeBottom = _hpTop + depth * _hpLevel + _hpR(depth);
  const cellTop = treeBottom + _hpGapT;
  return {
    N: N, depth: depth, W: W, H: cellTop + _hpCellH + 16 + 22,
    x: x, y: y, r: r,
    cellW: cellW, arrW: cellW * N, startX: (W - cellW * N) / 2,
    treeBottom: treeBottom, cellTop: cellTop,
    arcY: treeBottom + _hpGapT - 26, arcLabelY: treeBottom + 20,
  };
}

/** 大根堆: a 比 b 更"优"（更该在上层） ⟺ a > b；小根堆反之 */
function _hpBetter(kind, a, b) { return kind === 'min' ? a < b : a > b; }

/** 堆序：双亲 p 与孩子 c 是否合法（相等合法 —— 堆允许重复关键字） */
function _hpOK(kind, p, c) { return kind === 'min' ? p <= c : p >= c; }

/** 整棵树是否为合法堆（独立判据，冒烟脚本会拿它做不变量断言） */
function _hpIsHeap(arr, n, kind) {
  if (n <= 1) return true;
  for (let i = 1; 2 * i <= n; i++) {
    if (!_hpOK(kind, arr[i].v, arr[2 * i].v)) return false;
    if (2 * i + 1 <= n && !_hpOK(kind, arr[i].v, arr[2 * i + 1].v)) return false;
  }
  return true;
}

/** 极值文案：大根堆取"最大"、小根堆取"最小" */
function _hpExt(kind) { return kind === 'min' ? '最小' : '最大'; }
function _hpName(kind) { return kind === 'min' ? '小根堆' : '大根堆'; }
function _hpSign(kind) { return kind === 'min' ? '≤' : '≥'; }

/** 位移动画关键帧：from → pos；mid 侧向偏移 side×16px，让"交换"的两个元素错开、不叠在一起 */
function _hpMove(id, f, p, side) {
  const dx = f.x - p.x, dy = f.y - p.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  let mid = 'translate(' + (dx / 2).toFixed(2) + 'px,' + (dy / 2).toFixed(2) + 'px)';
  if (side && len > 1) mid = 'translate(' + (dx / 2 + side * 16 * (-dy / len)).toFixed(2) + 'px,'
    + (dy / 2 + side * 16 * (dx / len)).toFixed(2) + 'px)';
  return '@keyframes _hpN' + id + '{from{transform:translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px)}'
    + '50%{transform:' + mid + '}to{transform:translate(0px,0px)}}';
}

/* ============================================================================
 * 模块定义
 * ========================================================================== */
RC408.registerModule({
  id: 'ds-heap',
  mode: 'stepper',
  title: '堆与优先队列（完全二叉树 ⇄ 顺序存储）',

  theory: `
> **为什么要有它**：要反复"取最大 / 最小"时，有序数组插入慢、无序数组取极值慢——**堆**让插入与删除极值都是 \\(O(\\log_2 n)\\)，这正是优先队列与堆排序的基础。
> **怎么实现**：堆是**完全二叉树**，用顺序存储（下标 1 基：双亲 \\(\\lfloor i/2 \\rfloor\\)、左孩子 2i、右孩子 2i+1）；建堆从最后一个非叶结点 \\(\\lfloor n/2 \\rfloor\\) 倒着"向下筛选"，插入放末尾再"向上调整"，删除堆顶用末尾元素顶上再下沉。
> **记住什么**：堆只约束"双亲 vs 孩子"（不保证左右有序）+ 建堆 \\(O(n)\\) + **插入 / 删除各只走一条路径**。

## 定义
- **大根堆**：\\(a_i\\ge a_{2i}\\) 且 \\(a_i\\ge a_{2i+1}\\)；**小根堆**反之；
- 只需检查 \\(i=1\\sim \\lfloor n/2 \\rfloor\\) 这些**非叶结点**（叶结点没有孩子，天然满足）；
- 堆**不保证**左孩子 ≥ 右孩子，也**不保证**同一层有序——最常见的陷阱；堆**允许重复关键字**（与 BST 不同）。

## 顺序存储（只有完全二叉树能这么存）
| 关系 | 公式 |
| --- | --- |
| 双亲 | \\(\\lfloor i/2 \\rfloor\\)（i>1） |
| 左孩子 / 右孩子 | \\(2i\\) / \\(2i+1\\)（不超 n 才存在） |
| 是否为叶 | \\(2i>n\\) |
| 最后一个非叶结点 | \\(\\lfloor n/2 \\rfloor\\) |

- n 个结点的堆高 = \\(\\lfloor \\log_2 n \\rfloor+1\\)；
- **堆的"大小 n"与"数组容量"是两回事**：删除堆顶只减小 n，数组空间不动；
- 若题目用 **0 基下标**：孩子为 \\(2i+1,2i+2\\)、双亲为 \\(\\lfloor (i-1)/2 \\rfloor\\)（先看清下标起点）。

## 三个基本操作
1. **建堆（Floyd 自底向上筛选）**：从 \\(\\lfloor n/2 \\rfloor\\) **倒着**到根逐个向下筛选——做到 i 时它的左右子树已经是堆；时间 **\\(O(n)\\)**（不是 \\(O(n\\log_2 n)\\)）；
2. **插入**：新元素放到 \\(a_{n+1}\\)，与双亲比较、更优就交换并继续往上，最多走一条根到叶的路径：\\(O(\\log_2 n)\\)；
3. **删除堆顶**：取走堆顶本身 \\(O(1)\\)；把**末尾元素**搬到堆顶、n 减 1，再把堆顶**向下筛选**：\\(O(\\log_2 n)\\)。

**建堆方式对比**：把 n 个元素逐个插入空堆是 \\(O(n\\log_2 n)\\)；Floyd 自底向上建堆是 \\(O(n)\\)，后者更快。

## 优先队列与应用
插入 \\(O(\\log_2 n)\\)、取极值 \\(O(1)\\)、删除极值 \\(O(\\log_2 n)\\)（用有序数组则插入 \\(O(n)\\)、用无序数组则取极值 \\(O(n)\\)）；应用于堆排序、Top-K、任务调度、Dijkstra / Prim 的取最小、哈夫曼树的取两个最小。

## 考点提醒（易错点）
1. 判"某序列是否为堆"：从 \\(i=1\\) 查到 \\(\\lfloor n/2 \\rfloor\\)，**两个孩子都要比**，别漏右孩子、别多查叶结点；
2. 问"建堆后的结果"：必须**从 \\(\\lfloor n/2 \\rfloor\\) 倒着做**，自根向下做是错的；
3. 问"插入 / 删除后的变化"：只看**一条**向上或向下的路径，路径外的结点不动；
4. 与**堆排序**分工：本模块讲堆的结构与调整，堆排序（每趟堆顶与末尾交换、尾部有序区扩大）见排序模块。

> **真题考情**：**8/18 年（选 7 题 + 大 1 道）**：选 2009-9、2011-11、2015-10、2018-11、2020-9、
> 2021-11、2024-9；大 2022-42（找最小的 10 个数）。18 年真题从未直接考"优先队列"这个词。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'keys', label: '初始序列（将建成堆）', type: 'textarea', rows: 2, wide: true,
      default: '49,38,65,97,76,13,27,49',
      help: '整数（0~999），逗号 / 空格分隔，最多 12 个；允许重复（堆不要求关键字互不相同）。默认是教材演示自底向上建堆的经典序列',
    },
    {
      key: 'kind', label: '堆的类型', type: 'select', default: 'max',
      options: [
        { v: 'max', t: '大根堆（堆顶最大，取最大值）' },
        { v: 'min', t: '小根堆（堆顶最小，取最小值）' },
      ],
    },
    {
      key: 'ins', label: '建堆后依次插入（可留空）', type: 'text', default: '',
      help: '例如 85 或 85,99；每个新元素放到数组末尾再向上调整',
    },
    {
      key: 'rem', label: '删除堆顶（取极值）次数', type: 'select', default: '0',
      options: [
        { v: '0', t: '不删除' }, { v: '1', t: '删 1 次' }, { v: '2', t: '删 2 次' }, { v: '3', t: '删 3 次' },
        { v: '4', t: '删 4 次' }, { v: '5', t: '删 5 次' }, { v: '6', t: '删 6 次' },
        { v: 'all', t: '全部删完（= 反复取极值，看堆排序的输出）' },
      ],
      help: '删除次数超过堆的大小时，删到空为止（不会报错）',
    },
  ],

  /* ---------------- 预设（冒烟脚本会用假 rt 逐个跑通并校验标签承诺的动作，§3.5-15） ---------------- */
  quickActions: [
    {
      label: '🎲 随机序列', run(rt) {
        const pool = [];
        for (let i = 1; i <= 99; i++) pool.push(i);
        pool.sort(function () { return Math.random() - 0.5; });
        rt.setInput('keys', pool.slice(0, RC408.util.rnd(7, 10)).join(','));
        rt.setInput('kind', 'max'); rt.setInput('ins', ''); rt.setInput('rem', '0');
        rt.load();
      },
    },
    { label: '📚 自底向上建堆（教材经典序列）', run(rt) { rt.setInput('keys', '49,38,65,97,76,13,27,49'); rt.setInput('kind', 'max'); rt.setInput('ins', ''); rt.setInput('rem', '0'); rt.load(); } },
    { label: '⬆ 插入新元素（末尾 + 向上调整）', run(rt) { rt.setInput('keys', '49,38,65,97,76,13,27'); rt.setInput('kind', 'max'); rt.setInput('ins', '85'); rt.setInput('rem', '0'); rt.load(); } },
    { label: '⬇ 删除堆顶（末尾顶上 + 向下调整）', run(rt) { rt.setInput('keys', '97,76,65,49,49,13,27,38'); rt.setInput('kind', 'max'); rt.setInput('ins', ''); rt.setInput('rem', '1'); rt.load(); } },
    { label: '⏬ 反复取堆顶（堆排序的输出视角）', run(rt) { rt.setInput('keys', '49,38,65,97,76,13,27,49'); rt.setInput('kind', 'max'); rt.setInput('ins', ''); rt.setInput('rem', 'all'); rt.load(); } },
    { label: '🔻 小根堆对照（同一序列）', run(rt) { rt.setInput('keys', '49,38,65,97,76,13,27,49'); rt.setInput('kind', 'min'); rt.setInput('ins', ''); rt.setInput('rem', '0'); rt.load(); } },
    { label: '🚫 已是有序序列（建堆后立刻是合法大根堆）', run(rt) { rt.setInput('keys', '97,76,65,49,49,38,27,13'); rt.setInput('kind', 'max'); rt.setInput('ins', ''); rt.setInput('rem', '0'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const kind = vals.kind === 'min' ? 'min' : 'max';

    const rdSeq = function (raw, what) {
      const t = String(raw === undefined || raw === null ? '' : raw).trim();
      if (!t) return [];
      const toks = t.split(/[,，、;；\s]+/).filter(Boolean);
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const s = toks[i];
        if (!/^\d+$/.test(s)) {
          throw { message: '「' + s + '」不是非负整数；' + what + '只支持 0~999 的整数（不要小数、字母、负号）' };
        }
        const v = parseInt(s, 10);
        if (v > 999) throw { message: what + '里的 ' + v + ' 超出演示范围（只支持 0~999）' };
        out.push(v);
      }
      return out;
    };

    const keys = rdSeq(vals.keys, '初始序列');
    if (!keys.length) throw { message: '请输入初始序列，例如 49,38,65,97,76,13,27,49（逗号 / 空格分隔）' };
    if (keys.length > 12) throw { message: '初始序列最多 12 个关键字（当前 ' + keys.length + ' 个）' };
    const ins = rdSeq(vals.ins, '插入序列');
    if (keys.length + ins.length > 15) {
      throw { message: '初始序列 + 插入序列共 ' + (keys.length + ins.length) + ' 个关键字，超过演示上限 15 个（数组会画不下）' };
    }

    const rs = String(vals.rem === undefined || vals.rem === null ? '0' : vals.rem).trim();
    if (rs !== 'all' && !/^\d+$/.test(rs)) {
      throw { message: '删除次数只支持 0~15 的整数，或者 all（全部删完）' };
    }
    const rem = rs === 'all' ? 'all' : parseInt(rs, 10);
    if (rem !== 'all' && rem > 15) throw { message: '删除次数最大 15（当前 ' + rem + '）；想删完请选 all' };

    return {
      keys: keys, ins: ins, rem: rem, kind: kind,
      Nmax: keys.length + ins.length,
    };
  },

  /* ---------------- ② 纯算法：逐动作产出快照（零 DOM） ---------------- */
  buildSnapshots(model) {
    const kind = model.kind;
    const K = _hpName(kind);
    const geo = _hpGeo(model.Nmax);
    const ext = _hpExt(kind);
    const sign = _hpSign(kind);

    const arr = [null];        // 下标 1 基；arr[i] = { v, id } 或 null
    let n = 0;                 // 堆的大小
    let nextId = 0;
    let cmpTotal = 0, swapTotal = 0, siftRounds = 0;
    const taken = [];          // 依次取出的堆顶
    const snaps = [];

    const copyArr = function () {
      const out = [null];
      for (let i = 1; i <= n; i++) out[i] = arr[i] ? { v: arr[i].v, id: arr[i].id } : null;
      return out;
    };
    const posNow = function () {
      const p = {};
      for (let i = 1; i <= n; i++) if (arr[i]) p[arr[i].id] = { x: geo.x[i], y: geo.y[i] };
      return p;
    };
    /** 一帧：from 缺省 = 本帧坐标（没有位移，不动画） */
    const mk = function (step, o) {
      const p = posNow();
      snaps.push({
        step: step, kind: kind, n: n, Nmax: model.Nmax, geo: geo,
        arr: copyArr(), pos: p, from: o.from || p,
        cur: o.cur === undefined ? null : o.cur,
        pivot: o.pivot === undefined ? null : o.pivot,
        cmpWith: o.cmpWith === undefined ? null : o.cmpWith,
        dir: o.dir || '',
        pair: o.pair ? o.pair.slice() : null,
        insKey: o.insKey === undefined ? null : o.insKey,
        popKey: o.popKey === undefined ? null : o.popKey,
        act: o.act || '',
        taken: taken.slice(),
        heapOK: _hpIsHeap(arr, n, kind),
        heapFull: o.heapFull === true && _hpIsHeap(arr, n, kind),
        cmpTotal: cmpTotal, swapTotal: swapTotal, siftRounds: siftRounds,
        W: geo.W, H: geo.H,
        desc: o.desc || '', log: o.log || '', logType: o.logType || 'info',
      });
    };
    const swapAt = function (i, j) {
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    };
    const valTxt = function (i) { return (i >= 1 && i <= n && arr[i]) ? String(arr[i].v) : '—'; };

    /* ---------- 向下筛选：把下标 i 的元素一路下沉（建堆 / 删除堆顶共用）
       pivotId = 本轮筛选的根，**整轮都带着**（渲染时紫圈一直标着"正在调整哪个结点"） ---------- */
    const siftDown = function (idx, act, fullAll, pivotId) {
      let i = idx, guard = 0;
      if (2 * i > n) {
        mk('stop', {
          act: act, cur: i, pivot: pivotId, heapFull: fullAll,
          desc: 'a[' + i + '] = ' + valTxt(i) + ' 是叶结点（2i > n），筛选结束',
          log: 'a[' + i + '] 是叶结点，无需筛选', logType: 'info',
        });
        return;
      }
      while (guard++ < 64) {
        const l = 2 * i, r = 2 * i + 1;
        if (l > n) break;
        let best = l;
        if (r <= n) {
          const pickL = !_hpBetter(kind, arr[r].v, arr[l].v);   // 右孩子更优才选右
          best = pickL ? l : r;
          cmpTotal++;
          mk('cmp', {
            act: act, cur: i, pivot: pivotId, cmpWith: best, dir: 'down',
            desc: '比较两个孩子的' + ext + '者：a[' + l + '] = ' + valTxt(l) + ' 与 a[' + r + '] = ' + valTxt(r)
              + ' ⟹ 选 ' + (best === l ? '左' : '右') + '孩子 a[' + best + '] = ' + valTxt(best),
            log: '比较孩子 a[' + l + ']=' + valTxt(l) + ' 与 a[' + r + ']=' + valTxt(r) + ' → 取' + ext + '者 a[' + best + ']',
            logType: 'info',
          });
        } else {
          cmpTotal++;
          mk('cmp', {
            act: act, cur: i, pivot: pivotId, cmpWith: best, dir: 'down',
            desc: '只有一个孩子 a[' + best + '] = ' + valTxt(best) + '（右孩子 ' + r + ' 不存在，2i+1 > n）',
            log: '只有左孩子 a[' + best + ']=' + valTxt(best), logType: 'info',
          });
        }
        cmpTotal++;
        mk('cmp', {
          act: act, cur: i, pivot: pivotId, cmpWith: best, dir: 'down',
          desc: '比较双亲 a[' + i + '] = ' + valTxt(i) + ' 与孩子 a[' + best + '] = ' + valTxt(best) + '：'
            + (_hpBetter(kind, arr[best].v, arr[i].v) ? '孩子更' + ext + '，需要交换' : '双亲已 ' + sign + ' 孩子，满足堆序'),
          log: '比较 a[' + i + ']=' + valTxt(i) + ' 与 a[' + best + ']=' + valTxt(best), logType: 'info',
        });
        if (!_hpBetter(kind, arr[best].v, arr[i].v)) {
          mk('stop', {
            act: act, cur: i, pivot: pivotId, heapFull: fullAll,
            desc: 'a[' + i + '] = ' + valTxt(i) + ' 已经 ' + sign + ' 两个孩子，堆序满足，本轮向下筛选结束',
            log: 'a[' + i + '] 满足堆序，筛选结束', logType: 'success',
          });
          return;
        }
        const g0 = posNow();
        swapAt(i, best);
        swapTotal++;
        mk('swap', {
          act: act, cur: best, pivot: pivotId, pair: [i, best], from: g0,
          desc: '交换 a[' + i + '] ↕ a[' + best + ']：' + valTxt(best) + ' 下沉、' + valTxt(i) + ' 上升；'
            + '被换下去的 ' + valTxt(best) + ' 还要继续和它的新孩子比较',
          log: '交换 a[' + i + '] ↕ a[' + best + ']', logType: 'warn',
        });
        i = best;
      }
      mk('stop', {
        act: act, cur: i, pivot: pivotId, heapFull: fullAll,
        desc: 'a[' + i + '] = ' + valTxt(i) + ' 已下沉到位（到底或已 ' + sign + ' 孩子），本轮结束',
        log: '下沉到位，本轮结束', logType: 'success',
      });
    };

    /* ---------- 向上调整：新元素从末尾往上走（插入专用） ---------- */
    const siftUp = function (idx, act) {
      let i = idx, guard = 0;
      while (guard++ < 64) {
        if (i <= 1) {
          mk('stop', {
            act: act, cur: 1, heapFull: true,
            desc: '新元素已经走到堆顶，插入完成（堆顶就是' + ext + '值 ' + valTxt(1) + '）',
            log: '新元素升到堆顶，插入完成', logType: 'success',
          });
          return;
        }
        const p = Math.floor(i / 2);
        cmpTotal++;
        mk('cmp', {
          act: act, cur: p, cmpWith: i, dir: 'up',
          desc: '比较新元素 a[' + i + '] = ' + valTxt(i) + ' 与双亲 a[' + p + '] = ' + valTxt(p) + '（⌊' + i + '/2⌋ = ' + p + '）：'
            + (_hpBetter(kind, arr[i].v, arr[p].v) ? '新元素更' + ext + '，需要交换' : '双亲已 ' + sign + ' 它，堆序满足'),
          log: '比较 a[' + i + ']=' + valTxt(i) + ' 与双亲 a[' + p + ']=' + valTxt(p), logType: 'info',
        });
        if (!_hpBetter(kind, arr[i].v, arr[p].v)) {
          mk('stop', {
            act: act, cur: i, heapFull: true,
            desc: 'a[' + i + '] = ' + valTxt(i) + ' 已经 ' + sign + ' 双亲，堆序满足，插入完成（只走了 ' + (i === idx ? 0 : 1) + ' 层以上的路径）',
            log: '插入完成：只沿一条向上的路径调整', logType: 'success',
          });
          return;
        }
        const g0 = posNow();
        swapAt(i, p);
        swapTotal++;
        mk('swap', {
          act: act, cur: p, pair: [i, p], from: g0,
          desc: '交换 a[' + i + '] ↕ a[' + p + ']：新元素 ' + valTxt(p) + ' 继续上升，与新的双亲比较',
          log: '交换 a[' + i + '] ↕ a[' + p + ']（新元素上升）', logType: 'warn',
        });
        i = p;
      }
    };

    /* ---------- 第 0 帧：就绪（把初始序列按层序放进完全二叉树） ---------- */
    model.keys.forEach(function (v) { n++; arr[n] = { v: v, id: nextId++ }; });
    mk('init', {
      act: '', heapFull: n <= 1,
      desc: '就绪：把 ' + n + ' 个关键字按「层序」填进完全二叉树（顺序存储，下标 1 基）。'
        + '目标是把它们调整成' + K + '（a[i] ' + sign + ' a[2i] 且 a[i] ' + sign + ' a[2i+1]）。'
        + '先看它现在是否已经是堆：' + (_hpIsHeap(arr, n, kind) ? '已经是合法堆 ✓' : '还不满足堆序 ✗'),
      log: '就绪：' + n + ' 个关键字，目标' + K, logType: 'info',
    });

    /* ---------- 建堆：从 ⌊n/2⌋ 倒着自底向上筛选（Floyd） ---------- */
    const firstNonLeaf = Math.floor(n / 2);
    if (firstNonLeaf >= 1) {
      mk('scan', {
        act: 'build', pivot: firstNonLeaf, cur: firstNonLeaf,
        desc: '建堆开始：从「最后一个非叶结点」a[⌊n/2⌋] = a[' + firstNonLeaf + '] 开始，'
          + '「倒着」（' + firstNonLeaf + ' → 1）逐个向下筛选。为什么可以这么做：轮到 i 时，它的左右子树已经各自是堆了',
        log: '建堆：从最后一个非叶结点 a[' + firstNonLeaf + '] 开始倒着筛选', logType: 'info',
      });
    }
    for (let i = firstNonLeaf; i >= 1; i--) {
      if (i !== firstNonLeaf) {
        mk('scan', {
          act: 'build', pivot: i, cur: i,
          desc: '接着筛选结点 a[' + i + ']（它的左右子树已经各自是堆，只需把 a[' + i + '] = ' + valTxt(i) + ' 下沉到位）',
          log: '筛选结点 a[' + i + ']', logType: 'info',
        });
      }
      siftRounds++;
      siftDown(i, 'build', i === 1, i);
    }
    if (firstNonLeaf >= 1) {
      mk('settled', {
        act: 'build', heapFull: true,
        desc: '建堆完成：自底向上筛选一共做了 ' + firstNonLeaf + ' 轮，现在整棵树是合法' + K
          + '，堆顶 a[1] = ' + valTxt(1) + ' 就是全堆的' + ext + '值。时间 O(n)，不是 O(n log n)',
        log: '建堆完成（O(n)）：堆顶 = ' + valTxt(1), logType: 'success',
      });
    }

    /* ---------- 插入：末尾落位 → 向上调整 ---------- */
    model.ins.forEach(function (key, qi) {
      const g0 = posNow();
      n++; arr[n] = { v: key, id: nextId++ };
      mk('place', {
        act: 'insert', insKey: key, cur: n, from: g0,
        desc: '插入 ' + key + '（第 ' + (qi + 1) + ' 个）：先放到数组「末尾」a[' + n + ']，'
          + '也就是完全二叉树的下一个空位；它可能比双亲更' + ext + '，所以要「向上调整」',
        log: '插入 ' + key + ' → 放到末尾 a[' + n + ']', logType: 'info',
      });
      siftRounds++;
      siftUp(n, 'insert');
    });

    /* ---------- 删除堆顶（取极值） ---------- */
    let del = model.rem === 'all' ? 1e9 : model.rem;
    while (del > 0 && n >= 1) {
      const top = arr[1].v;
      mk('take', {
        act: 'remove', cur: 1, popKey: top, heapFull: true,
        desc: '取出堆顶 a[1] = ' + top + '（' + K + '的堆顶就是全堆' + ext + '值，取它是 O(1)）。'
          + '这一步就是优先队列的"删除' + ext + '元"',
        log: '取出堆顶 ' + top + '（' + ext + '值）', logType: 'success',
      });
      taken.push(top);
      if (n === 1) {
        arr.length = 1; n = 0;
        mk('pop', {
          act: 'remove', heapFull: true,
          desc: '堆里只有这一个元素，取走后堆为空（大小 n = 0）——注意"堆的大小"变了，数组的容量并没有变',
          log: '堆已空（n = 0）', logType: 'warn',
        });
      } else {
        const last = arr[n];
        arr.length = n;
        n--;
        const g0 = posNow();
        arr[1] = last;
        mk('pop', {
          act: 'remove', cur: 1, pivot: 1, from: g0, heapFull: true,
          desc: '把「末尾元素」' + last.v + ' 搬到堆顶 a[1]，堆的大小 n 减 1（现在 n = ' + n + '）。'
            + '它多半比孩子小，所以要「向下筛选」（往下沉）',
          log: '末尾元素 ' + last.v + ' 顶上堆顶，n = ' + n, logType: 'warn',
        });
        siftRounds++;
        siftDown(1, 'remove', true, 1);
      }
      del--;
    }
    if (model.rem !== 'all' && model.rem > 0 && n === 0) {
      mk('settled', {
        act: 'remove', heapFull: true,
        desc: '删除次数超过了堆的大小，已经删到空为止（共取出 ' + taken.length + ' 个元素）',
        log: '删到空为止（共取出 ' + taken.length + ' 个）', logType: 'info',
      });
    }

    /* ---------- 收尾帧 ---------- */
    const descExtra = taken.length
      ? '已取出的堆顶序列（' + (kind === 'max' ? '大根堆 → 递减' : '小根堆 → 递增') + '）：'
        + taken.join(' → ') + '。把"取堆顶 n 次"做完整就是堆排序，逐步过程见「排序算法全家桶」。'
      : '当前堆顶 = ' + (n >= 1 ? valTxt(1) : '—') + '。';
    mk('done', {
      act: '', heapFull: true,
      desc: '全部完成：堆大小 n = ' + n + '，树高 = ' + _hpHeight(n) + '（⌊log₂' + n + '⌋ + 1），'
        + '累计比较 ' + cmpTotal + ' 次、交换 ' + swapTotal + ' 次、筛选 ' + siftRounds + ' 轮。'
        + descExtra + ' 结论：建堆 O(n)，单次插入 / 删除堆顶 O(log₂n)，取极值 O(1)。',
      log: '完成：n = ' + n + '，堆顶 ' + (n >= 1 ? valTxt(1) : '—') + '，比较 ' + cmpTotal + ' / 交换 ' + swapTotal,
      logType: 'success',
    });

    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ---------------- */
  render(ctx) {
    const s = ctx.snap, model = ctx.model, stage = ctx.stage;
    const geo = s.geo, arr = s.arr, n = s.n, N = geo.N;
    const kind = s.kind, K = _hpName(kind), ext = _hpExt(kind), sign = _hpSign(kind);

    /* 本帧发生位移的元素（渲染动画用） */
    const moved = [];
    for (let i = 1; i <= n; i++) {
      const id = arr[i].id, f = s.from[id];
      if (f && (f.x !== geo.x[i] || f.y !== geo.y[i])) moved.push(id);
    }
    /* 交换帧的"角色"：pair[0] = 原来的双亲下标（交换后装的是**升上来**的孩子）→ +1 绿
                    pair[1] = 原来的孩子下标（交换后装的是**沉下去**的双亲）→ −1 红
       这个映射容易写反（窗4 第一版就写反了），冒烟脚本用"交换前后两格的值"断言锁住它 */
    const inPair = function (i) {
      if (!s.pair) return 0;
      if (s.pair[0] === i) return 1;
      if (s.pair[1] === i) return -1;
      return 0;
    };

    /* ---------- 颜色 ---------- */
    const fillOf = function (i) {
      const pairSide = inPair(i);
      if (pairSide === -1) return { f: '#ef4444', t: '#fff' };      // 交换后沉到下面的
      if (pairSide === 1) return { f: '#10b981', t: '#fff' };       // 交换后升上去的
      if (s.step === 'take' && i === 1) return { f: '#ef4444', t: '#fff' };
      if (s.step === 'place' && s.insKey !== null && i === n) return { f: '#06b6d4', t: '#fff' };
      if (s.pivot !== null && i === s.pivot) return { f: '#6366f1', t: '#fff' };
      if (s.cur !== null && i === s.cur) return { f: '#2563eb', t: '#fff' };
      if (s.cmpWith !== null && i === s.cmpWith) return { f: '#f59e0b', t: '#fff' };
      return { f: '#e2e8f0', t: '#475569' };
    };

    /* ---------- 内联关键帧（§3.1-5：每帧重建 DOM，只有 @keyframes 会重放） ---------- */
    const css = [];

    /* ---------- ① 完全二叉树 ---------- */
    /* 边：静态（父 ⌊i/2⌋ → 子 i 的槽位固定不变），只随 n 出现/消失 */
    let edgeSvg = '';
    for (let i = 2; i <= n; i++) {
      const p = Math.floor(i / 2);
      const hot = (s.pair && (s.pair.indexOf(i) >= 0 || s.pair.indexOf(p) >= 0))
        || (s.cur !== null && (s.cur === i || s.cur === p));
      edgeSvg += '<line x1="' + geo.x[p] + '" y1="' + geo.y[p] + '" x2="' + geo.x[i] + '" y2="' + geo.y[i]
        + '" stroke="' + (hot ? '#94a3b8' : '#cbd5e1') + '" stroke-width="' + (hot ? 3.5 : 2.5)
        + '" stroke-linecap="round"/>';
    }

    /* 空槽（i > n）：淡淡地画出来，"容量"与"堆的大小"的区别一眼可见 */
    let emptySvg = '';
    for (let i = n + 1; i <= N; i++) {
      emptySvg += '<circle cx="' + geo.x[i] + '" cy="' + geo.y[i] + '" r="' + geo.r[i]
        + '" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-dasharray="4 5" opacity="0.75"/>';
    }

    /* 幽灵：交换帧里两个元素的"交换前"位置 */
    let ghostSvg = '';
    if (s.pair) {
      s.pair.forEach(function (i) {
        const id = arr[i] ? arr[i].id : null;
        const g = id === null ? null : s.from[id];
        if (!g) return;
        const gr = _hpR(Math.max(0, Math.round((g.y - _hpTop) / _hpLevel)));
        ghostSvg += '<g opacity="0.55">'
          + '<circle cx="' + g.x + '" cy="' + g.y + '" r="' + gr
          + '" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 4"/>'
          + '<text x="' + g.x + '" y="' + g.y + '" dy="0.35em" text-anchor="middle"'
          + ' style="font:700 11px Consolas,ui-monospace,monospace;fill:#94a3b8">' + arr[i].v + '</text>'
          + '</g>';
      });
    }

    /* 结点（元素）：坐标 = 它当前所在**下标**的槽位；from 给出起点做平移 */
    let nodeSvg = '';
    for (let i = 1; i <= n; i++) {
      const el = arr[i], id = el.id;
      const px = geo.x[i], py = geo.y[i], rr = geo.r[i], col = fillOf(i);
      let anim = '';
      const f = s.from[id];
      if (f && (f.x !== px || f.y !== py)) {
        css.push(_hpMove(id, f, { x: px, y: py }, inPair(i)));
        anim = ' style="animation:_hpN' + id + ' ' + _hpDur + ' ' + _hpEase + ' both"';
      } else if (!f) {
        css.push('@keyframes _hpN' + id + '{from{transform:translate(0px,26px);opacity:0}'
          + 'to{transform:translate(0px,0px);opacity:1}}');
        anim = ' style="animation:_hpN' + id + ' ' + _hpDur + ' ' + _hpEase + ' both"';
      }
      const halo = (s.pivot !== null && i === s.pivot) || (s.step === 'take' && i === 1)
        || (s.cmpWith !== null && i === s.cmpWith && s.dir === 'down' && s.step === 'cmp')
        ? '<circle cx="0" cy="0" r="' + (rr + 7) + '" class="knode-halo" style="stroke:'
          + (s.step === 'take' ? '#ef4444' : '#6366f1') + '"/>' : '';
      const fs = rr >= 20 ? 14 : (rr >= 17 ? 13 : 12);
      nodeSvg += '<g transform="translate(' + px + ',' + py + ')"><g' + anim + '>'
        + halo
        + '<circle cx="0" cy="0" r="' + rr + '" class="knode-circle" fill="' + col.f + '"/>'
        + '<text x="0" y="0" dy="0.35em" class="knode-text" style="fill:' + col.t + ';font-size:' + fs + 'px">' + el.v + '</text>'
        + '<text x="' + (rr * 0.78) + '" y="' + (-rr * 0.72) + '" text-anchor="middle"'
        + ' style="font:700 10px Consolas,ui-monospace,monospace;fill:#94a3b8;'
        + 'paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round">' + i + '</text>'
        + '</g></g>';
    }

    /* 待取出的角标（take 帧） */
    let takeSvg = '';
    if (s.step === 'take') {
      takeSvg = '<g><text class="hp-take" x="' + geo.x[1] + '" y="' + (geo.y[1] - geo.r[1] - 12) + '" text-anchor="middle"'
        + ' style="font:800 13px Consolas,ui-monospace,monospace;fill:#dc2626">取出 ' + s.popKey + ' ↑</text></g>';
    }

    /* ---------- ② 顺序存储（数组）行 ---------- */
    const cellY = geo.cellTop;
    let cellSvg = '';
    for (let i = 1; i <= N; i++) {
      const cx = geo.startX + (i - 1) * geo.cellW + 2, cw = geo.cellW - 4;
      const has = i <= n && arr[i];
      const isPair = inPair(i) !== 0;
      const isCur = s.cur === i || s.pivot === i || s.cmpWith === i;
      const fill = !has ? '#f8fafc' : isPair ? (inPair(i) === -1 ? '#fee2e2' : '#d1fae5')
        : (s.step === 'place' && i === n) ? '#cffafe'
          : isCur ? '#fef3c7' : '#ffffff';
      const stroke = !has ? '#e2e8f0' : isPair ? (inPair(i) === -1 ? '#f87171' : '#6ee7b7')
        : isCur ? '#f59e0b' : '#cbd5e1';
      cellSvg += '<rect class="hp-cell" x="' + cx + '" y="' + cellY + '" width="' + cw + '" height="' + _hpCellH
        + '" rx="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"'
        + (has ? '' : ' stroke-dasharray="4 4"') + '/>'
        + (has
          ? '<text x="' + (cx + cw / 2) + '" y="' + (cellY + _hpCellH / 2) + '" dy="0.35em" text-anchor="middle"'
            + ' style="font:800 ' + (geo.cellW < 38 ? 12 : 14) + 'px Consolas,ui-monospace,monospace;fill:'
            + (isPair || isCur ? (isPair ? (inPair(i) === -1 ? '#b91c1c' : '#047857') : '#b45309') : '#334155') + '">'
            + arr[i].v + '</text>'
          : '')
        + '<text x="' + (cx + cw / 2) + '" y="' + (cellY + _hpCellH + 13) + '" text-anchor="middle"'
        + ' style="font:700 10px Consolas,ui-monospace,monospace;fill:' + (has ? '#94a3b8' : '#cbd5e1') + '">'
        + i + '</text>';
    }

    /* 交换弧线：把两个下标连起来，直观显示"哪两个位置在换" */
    let arcSvg = '';
    if (s.pair) {
      const x1 = geo.startX + (s.pair[0] - 1) * geo.cellW + geo.cellW / 2;
      const x2 = geo.startX + (s.pair[1] - 1) * geo.cellW + geo.cellW / 2;
      const mx = (x1 + x2) / 2, y0 = geo.arcY;
      arcSvg = '<path class="hp-arc" d="M ' + x1 + ' ' + y0 + ' Q ' + mx + ' ' + (y0 - 34) + ' ' + x2 + ' ' + y0
        + '" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="6 5"/>'
        + '<text class="hp-arc-label" x="' + mx + '" y="' + geo.arcLabelY + '" text-anchor="middle"'
        + ' style="font:800 12px ui-sans-serif,system-ui;fill:#b45309">'
        + '交换 a[' + s.pair[0] + '] ↕ a[' + s.pair[1] + ']</text>';    }

    /* ---------- 统计卡 ---------- */
    const stats =
      RC408.ui.statCard('堆的大小 / 树高', n + ' 个',
        n ? '树高 = ⌊log₂' + n + '⌋ + 1 = ' + _hpHeight(n) + '；容量 ' + N + ' 格' : '（空堆）')
      + RC408.ui.statCard('堆顶（' + ext + '值）', n ? String(arr[1].v) : '—',
        K + '的堆顶就是全堆' + ext + '值，取它 O(1)')
      + RC408.ui.statCard('是否满足堆序', s.heapOK ? '✓ 是' : '✗ 否',
        s.heapOK ? '每个非叶结点 a[i] ' + sign + ' 它的孩子'
          : (s.step === 'init' ? '初始序列还不是堆，等筛选' : '筛选/调整进行中，过渡状态'),
        s.heapOK ? 'text-emerald-600' : 'text-rose-600')
      + RC408.ui.statCard('累计比较 / 交换', s.cmpTotal + ' / ' + s.swapTotal,
        '共筛选 ' + s.siftRounds + ' 轮（每轮只走一条路径）', 'text-indigo-600');

    /* ---------- 堆序逐结点检查（判堆的考点原样呈现） ---------- */
    const checkChips = [];
    for (let i = 1; 2 * i <= n; i++) {
      const kids = arr[2 * i + 1] ? ('a[' + (2 * i) + ']=' + arr[2 * i].v + ', a[' + (2 * i + 1) + ']=' + arr[2 * i + 1].v)
        : ('a[' + (2 * i) + ']=' + arr[2 * i].v + '（无右孩子）');
      const ok = _hpOK(kind, arr[i].v, arr[2 * i].v) && (!arr[2 * i + 1] || _hpOK(kind, arr[i].v, arr[2 * i + 1].v));
      checkChips.push(RC408.ui.chip('a[' + i + ']=' + arr[i].v + ' ' + sign + ' ' + kids, ok ? 'chip-hit' : 'chip-flash',
        ok ? '满足堆序' : '违反堆序：双亲比孩子更' + (kind === 'min' ? '大' : '小')));
    }

    /* ---------- 数组一览 ---------- */
    const arrChips = [];
    for (let i = 1; i <= N; i++) {
      const has = i <= n && arr[i];
      arrChips.push(RC408.ui.chip(i + ':' + (has ? arr[i].v : '空'),
        has ? (i === 1 ? 'chip-check' : '') : 'chip-future', has ? 'a[' + i + ']' : '未使用（i > n）'));
    }

    /* ---------- 已取出序列 ---------- */
    const takenChips = s.taken.length
      ? s.taken.map(function (v, i) {
        return RC408.ui.chip(v, i === s.taken.length - 1 ? 'chip-cur' : 'chip-mst', '第 ' + (i + 1) + ' 次取出的堆顶');
      }).join('<span class="text-slate-300 self-center">→</span>')
      : '<span class="text-xs text-slate-400">（还没有取出任何元素）</span>';

    /* ---------- 插入进度 ---------- */
    const insChips = model.ins.length
      ? model.ins.map(function (k) {
        const cur = (s.insKey !== null && s.insKey === k && s.step === 'place');
        return RC408.ui.chip(String(k), cur ? 'chip-cur' : 'chip-mst', '已插入 ' + k);
      }).join('<span class="text-slate-300 self-center">›</span>')
      : '<span class="text-xs text-slate-400">（本次演示没有插入操作）</span>';

    /* ---------- 提示条 ---------- */
    const tip = s.step === 'take'
      ? '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">'
        + '正在取出堆顶 <b>' + s.popKey + '</b>（' + K + '的' + ext + '值）。删完之后要把<b>末尾元素</b>搬到堆顶，再向下筛选，否则堆序会被破坏。</div>'
      : s.step === 'init'
        ? '<div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">'
        + '初始序列按层序填进完全二叉树后' + (s.heapOK
          ? '<b>已经</b>是合法' + K + '了（本序列恰好不需要调整，点单步可以看到每一轮筛选都"无需交换"）。'
          : '<b>还不是</b>合法' + K + '（要求每个非叶结点 a[i] ' + sign + ' 它的孩子）。点「单步」开始<b>自底向上筛选</b>：从最后一个非叶结点 a[⌊n/2⌋] 倒着做到 a[1]。')
        + '</div>'
        : s.heapOK
          ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">'
          + '✓ 当前是合法' + K + '：每个非叶结点 a[i] ' + sign + ' 它的两个孩子（'
          + (n > 1 ? '查 i = 1~' + Math.floor(n / 2) : (n === 0 ? '空堆，没有结点可查' : '只有一个元素，天然是堆')) + '）。'
          + '注意堆<b>只</b>保证这条，左孩子不一定 ≥ 右孩子，同层也不一定有序。</div>'
          : '<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">'
          + '⚠️ 当前处于筛选的<b>过渡状态</b>：某个双亲还比孩子更' + (kind === 'min' ? '大' : '小') + '，继续单步就会把它换下去。'
          + '（过渡帧不是合法堆，属正常现象）</div>';

    const legend = RC408.ui.legend('#6366f1', '本轮正在筛选的根（红圈）')
      + RC408.ui.legend('#2563eb', '当前被比较的双亲')
      + RC408.ui.legend('#f59e0b', '当前被比较的孩子（选中的更' + ext + '者）')
      + RC408.ui.legend('#ef4444', '交换后下沉的元素')
      + RC408.ui.legend('#10b981', '交换后上升的元素')
      + RC408.ui.legend('#06b6d4', '刚插入的新元素')
      + RC408.ui.legend('#94a3b8', '虚线圆圈 = 交换前的位置；淡虚线圆 = 还没用到的数组空间')
      + RC408.ui.legend('#64748b', '结点右上角小数字 = 它当前的数组下标（双亲 ⌊i/2⌋、左孩子 2i、右孩子 2i+1）');

    const svg = '<svg viewBox="0 0 ' + geo.W + ' ' + geo.H + '" class="w-full h-auto mx-auto" style="max-width:'
      + Math.max(geo.W, 520) + 'px">'
      + edgeSvg + emptySvg + arcSvg + ghostSvg + cellSvg + nodeSvg + takeSvg + '</svg>';

    stage.innerHTML =
      '<div class="space-y-4">'
      /* 关键帧内联注入（§3.1-5）：必须放在 <svg> 之外 */
      + '<style>' + css.join('') + '</style>'
      + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + stats + '</div>'
      + tip
      + '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">'
      + svg
      + '<div class="text-[11px] text-slate-400 text-center mt-1">上：完全二叉树（圆内是关键字，右上角小字是数组下标）　下：顺序存储的数组（格子下方是下标 1 ~ '
      + N + '）</div>'
      + '</div>'
      + '<div>' + RC408.ui.sectionTitle('堆序检查（只要查非叶结点 i = 1 ~ ⌊n/2⌋，' + K + '要求 a[i] ' + sign + ' a[2i] 且 a[i] ' + sign + ' a[2i+1]）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5">' + (checkChips.length ? checkChips.join('') : '<span class="text-xs text-slate-400">（当前堆里没有非叶结点）</span>') + '</div>'
      + '<div>' + RC408.ui.sectionTitle('顺序存储一览（容量 ' + N + ' 格，当前堆大小 n = ' + n + '；"空"= 下标超过 n 的空间）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5">' + arrChips.join('') + '</div>'
      + (model.ins.length
        ? '<div>' + RC408.ui.sectionTitle('本次插入的新元素') + '</div><div class="flex flex-wrap gap-1.5 items-center">' + insChips + '</div>'
        : '')
      + '<div>' + RC408.ui.sectionTitle('已取出的堆顶（取 ' + ext + '值的顺序' + (s.taken.length > 1 ? '：' + (kind === 'max' ? '递减' : '递增') : '') + '）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5 items-center">' + takenChips + '</div>'
      + '<div>' + RC408.ui.sectionTitle('优先队列与复杂度') + '</div>'
      + '<div class="text-xs text-slate-600 leading-relaxed">'
      + '<b>建堆</b>：自底向上筛选，时间 <b>O(n)</b>（逐个插入建堆是 O(n log₂n)，Floyd 更快）；'
      + '<b>插入</b>：末尾落位 + 向上调整一条路径，O(log₂n)；'
      + '<b>删除堆顶</b>：取走 O(1) + 末尾顶上再向下调整一条路径，O(log₂n)。'
      + '用堆实现优先队列就是这三件事；本模块讲"堆的结构与调整"，<b>堆排序</b>（反复取堆顶、尾部有序区扩大）见「排序算法全家桶」。'
      + '</div>'
      + '<div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">' + legend + '</div>'
      + '</div>';
  },
});
