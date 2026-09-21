'use strict';
/* ============================================================================
 * ds-bst-avl.js —— 【数据结构】二叉排序树（BST）与平衡二叉树（AVL）· 插入与旋转
 * ----------------------------------------------------------------------------
 * 前缀：_av（所有顶层函数/常量都带前缀，避免经典 script 全局污染，见 handover §3.1-3）
 *
 * 快照设计：每个动作一帧（另加 init / done）：
 *   step: init | cmp | insert | unbal | rot | settled | done
 * 每帧**全量携带**（§1.3 铁律，回退/跳帧才不出错）：
 *   nodes  深拷贝的结点数组（下标 = id；left/right/parent 为 id 或 null）
 *   root   当前根 id（空树为 null）
 *   pos    本帧各结点坐标 id → {x,y}
 *   from   上一帧各结点坐标（渲染用它做滑动动画与"旋转前"幽灵标记）
 *   meta   一次遍历算出的 {h, bf, depth, order, height, maxDepth, nodeCount}
 *
 * 为什么 x 用"固定槽位"（窗2 的关键设计决策，见 handover §3.2-12）：
 *   BST 插入与旋转都**保持中序序列不变**，于是把「x = 该关键字在最终有序序列里的名次」
 *   固定下来后，每个关键字一辈子待在同一列，全树只有**竖直**位移。这样结点与其父边的
 *   位移就是同一个纯竖直向量，边可以用同一个仿射变换**精确**跟随结点（中途不脱节），
 *   而且全程零 style.css 改动（对比 §6.3-6 里窗0"旋转过渡要动 CSS"的担心）。
 *
 * 口径（408/严蔚敏，经 2009-4、2012-4、2013-3、2020-5、2021-6、2026-8 真题印证）：
 *   BF = 左子树高 − 右子树高；AVL 每个结点 |BF| ≤ 1；空子树高 0、叶结点高 1；
 *   旋转不改变中序序列；插入最多调整一次（单旋或双旋）。
 * ========================================================================== */

/* ------------------------------ 布局常量（_av 前缀） ------------------------------ */
const _avR      = 21;     // 结点半径
const _avGap    = 78;     // 相邻槽位水平间距
const _avMargin = 44;     // 左右留边（> 半径 + 平衡因子标签半宽）
const _avTop    = 54;     // 第一层结点中心 y（上方还要放得下 11px 的平衡因子标签）
const _avLevel  = 86;     // 层间距
const _avBottom = 34;     // 下留边
const _avDur    = '0.62s';
const _avEase   = 'cubic-bezier(.4,0,.2,1)';

/* ------------------------------ 纯工具（_av 前缀） ------------------------------ */

/** 一次后序遍历算出每个结点的高度 / 平衡因子 / 深度；BF = 左高 − 右高（408 口径） */
function _avMeta(nodes, root) {
  const h = {}, bf = {}, depth = {}, order = [];
  let maxDepth = -1;
  (function walk(id, d) {
    if (id === null || id === undefined) return 0;
    const nd = nodes[id];
    if (!nd) return 0;
    depth[id] = d;
    if (d > maxDepth) maxDepth = d;
    order.push(id);
    const lh = walk(nd.left, d + 1);
    const rh = walk(nd.right, d + 1);
    h[id] = 1 + Math.max(lh, rh);
    bf[id] = lh - rh;
    return h[id];
  })(root, 0);
  return {
    h: h, bf: bf, depth: depth, order: order, maxDepth: maxDepth,
    height: maxDepth + 1, nodeCount: order.length,
  };
}

/** 坐标：x = 固定槽位 × 间距 + 左边距；y = 深度 × 层距 + 顶边距 */
function _avPos(nodes, root, slotOf) {
  const m = _avMeta(nodes, root);
  const pos = {};
  for (let i = 0; i < m.order.length; i++) {
    const id = m.order[i];
    pos[id] = {
      x: _avMargin + slotOf[nodes[id].key] * _avGap,
      y: _avTop + m.depth[id] * _avLevel,
    };
  }
  return { pos: pos, meta: m };
}

/** 右旋：以 z 为轴；y = z 的左孩子上升为子树根，y 的右子树改挂到 z 的左孩子。返回新根 id */
function _avRotR(nodes, zId, rootId) {
  const z = nodes[zId];
  const y = nodes[z.left];
  const b = y.right;
  z.left = b;
  if (b !== null) nodes[b].parent = zId;
  y.right = zId;
  y.parent = z.parent;
  if (z.parent === null) rootId = y.id;
  else {
    const p = nodes[z.parent];
    if (p.left === zId) p.left = y.id; else p.right = y.id;
  }
  z.parent = y.id;
  return rootId;
}

/** 左旋：以 z 为轴；y = z 的右孩子上升为子树根，y 的左子树改挂到 z 的右孩子。返回新根 id */
function _avRotL(nodes, zId, rootId) {
  const z = nodes[zId];
  const y = nodes[z.right];
  const b = y.left;
  z.right = b;
  if (b !== null) nodes[b].parent = zId;
  y.left = zId;
  y.parent = z.parent;
  if (z.parent === null) rootId = y.id;
  else {
    const p = nodes[z.parent];
    if (p.left === zId) p.left = y.id; else p.right = y.id;
  }
  z.parent = y.id;
  return rootId;
}

/** 高度 h 的 AVL 树**最少**结点数：N(1)=1, N(2)=2, N(h)=N(h−1)+N(h−2)+1（2012-4） */
function _avMin(h) {
  const N = [0, 1, 2];
  for (let i = 3; i <= h; i++) N[i] = N[i - 1] + N[i - 2] + 1;
  return N[h] || 0;
}

/** 同样插入顺序、但**不做平衡**的普通 BST 在各前缀下的树高（用于对照，bstH[i] = 前 i 个关键字） */
function _avPlainHeights(seq) {
  const nd = [];
  const out = [0];
  let rt = null;
  for (let i = 0; i < seq.length; i++) {
    nd[i] = { id: i, key: seq[i], left: null, right: null };
    if (rt === null) rt = i;
    else {
      let cur = rt;
      for (;;) {
        if (seq[i] < nd[cur].key) {
          if (nd[cur].left === null) { nd[cur].left = i; break; }
          cur = nd[cur].left;
        } else {
          if (nd[cur].right === null) { nd[cur].right = i; break; }
          cur = nd[cur].right;
        }
      }
    }
    out.push(_avMeta(nd, rt).height);
  }
  return out;
}

/** 带符号的平衡因子文案（+1 / 0 / −1） */
function _avBfTxt(v) { return v > 0 ? '+' + v : String(v); }

/* ============================================================================
 * 模块定义
 * ========================================================================== */
RC408.registerModule({
  id: 'ds-bst-avl',
  mode: 'stepper',
  title: '二叉排序树（BST）与平衡二叉树（AVL）· 插入与旋转',

  theory: `
> **为什么要有它**：BST 平均查找是 \\(O(\\log_2 n)\\)，但**插入序列有序时会退化成单支链**（树高 n、查找掉到 \\(O(n)\\)）——AVL 用"插入后旋转"把树高压住。
> **怎么实现**：插入后自底向上找到**最小不平衡子树** z，看 z 与较高孩子 y 的平衡因子判型（LL / RR / LR / RL），做一次单旋或双旋。
> **记住什么**：\\(BF=h_L-h_R\\) 与判型表 + **旋转不改变中序序列** + 最少结点数递推 \\(N(h)=N(h-1)+N(h-2)+1\\)。

## 二叉排序树（BST）
- **定义**：左子树所有关键字 < 根 < 右子树所有关键字，左右子树也各是 BST；
- **中序遍历严格递增**——最好用的判据：判"是否二叉搜索树"、比较关键字大小都靠它（\\(O(n)\\) 时间、\\(O(h)\\) 空间）；
- **插入的新结点一定是叶子**（一路比较到空指针才落位）；
- **删除**三种：① 叶结点直接删；② 只有一个孩子 → 用孩子顶替；③ 两个孩子 → 用**中序前驱（左子树最右）或中序后继（右子树最左）**顶替，再删掉那个前驱 / 后继；
  删除后再把同一关键字插回来，**不保证还原成原来的树**；
- **最坏情况**：插入序列本身有序 → BST 退化成单支链，树高 n，查找 \\(O(n)\\)——这正是 AVL 要解决的问题。

## 平衡二叉树（AVL）
- \\(BF=h_L-h_R\\)（左子树高 − 右子树高），AVL 要求**每个结点** \\(|BF|\\le 1\\)；空子树高 0、叶结点高 1；
- 插入后从新结点**向上**找到第一个 \\(|BF|=2\\) 的结点 z（最小不平衡子树的根），再看 z 的较高孩子 y 的 BF 判型：

| 型 | 条件 | 调整动作 |
| --- | --- | --- |
| **LL** | \\(BF(z)=+2\\) 且 \\(BF(y)\\ge 0\\) | 对 z **右旋**一次 |
| **RR** | \\(BF(z)=-2\\) 且 \\(BF(y)\\le 0\\) | 对 z **左旋**一次 |
| **LR** | \\(BF(z)=+2\\) 且 \\(BF(y)<0\\) | 先对 y **左旋**，再对 z **右旋** |
| **RL** | \\(BF(z)=-2\\) 且 \\(BF(y)>0\\) | 先对 y **右旋**，再对 z **左旋** |

- 右旋：y（z 的左孩子）上升为子树根，z 下降为 y 的**右**孩子，y 原来的右子树改挂成 z 的**左**子树；左旋左右对称；**LR / RL 必须两次**；
- **插入最多调整一次**（一次单旋或一次双旋）就能恢复平衡；删除可能要向上多轮；
- **旋转不改变中序序列**，只是把子树"压扁"。

## 高度与最少结点数
设 \\(N(h)\\) 为高度 h 的 AVL 树**最少**结点数：\\(N(1)=1,\\ N(2)=2,\\ N(h)=N(h-1)+N(h-2)+1\\)。

| h | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N(h) | 1 | 2 | 4 | 7 | 12 | 20 | 33 |

- **2012-4 型**：高度 6 且所有非叶结点 BF 全为 +1（每个结点都取最少结点的那种形状）→ 结点数 \\(N(6)=20\\)；
- **2026-8 型（易错）**：高度 4 的 AVL **最少是 7 个结点**，此时根的两棵子树高为 (3,2)、结点数分别是 4 与 2，**相差最多为 2**（官方答案）——
  别再按"子树高 3 最多 7 个结点"去算成 5，那是把约束换掉了；
- 反过来：n 个结点的 AVL 树高不超过约 \\(1.44\\log_2(n+1)\\)，远好于普通 BST 的最坏 n。

## 考点提醒（易错点）
1. 问"插入某关键字后根是谁"：**先按 BST 插到叶子位置，再自下而上找最小不平衡子树**，先判型再旋；
2. 问"哪条查找路径不可能"、"哪个序列不能生成此 BST"：查**路径上相邻两数的大小关系是否与转向一致**，以及 BST 的中序有序性；
3. 数"BF 为 0 的分支结点"：建完树逐个子树算高度，**别漏掉根**；
4. **删除后再插入不保证树形还原**（BST 与 AVL 都是），选择题常拿它设陷阱。

> **真题考情**：**13/18 年（选 13 题 + 大 2 道）**：选 2009-4、2010-4（RL 型要两次旋转）、2011-7、
> 2012-4、2013-3·6、2015-4、2018-6、2019-4、2020-5、2021-6、2024-7、2026-8；大 2022-41、2026-41。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'keys', label: '关键字序列（按此顺序依次插入）', type: 'textarea', rows: 2, wide: true,
      default: '1,2,3,4,5,6,7,8,9,10',
      help: '整数（0~999），逗号 / 空格分隔，重复的自动忽略；最多 15 个。默认给的是**有序序列**，可直接对比"普通 BST 退化成链"与"AVL 自动平衡"',
    },
    {
      key: 'mode', label: '树的类型', type: 'select', default: 'avl',
      options: [
        { v: 'avl', t: 'AVL 平衡二叉树（插入后检测失衡并旋转）' },
        { v: 'bst', t: '普通二叉排序树（只插入，不旋转，看退化）' },
      ],
    },
  ],

  /* ---------------- 预设（冒烟脚本会用假 rt 逐个跑通并断言标签承诺的动作） ---------------- */
  quickActions: [
    {
      label: '🎲 随机序列', run(rt) {
        const pool = [];
        for (let i = 1; i <= 99; i++) pool.push(i);
        pool.sort(() => Math.random() - 0.5);
        const n = RC408.util.rnd(8, 10);
        rt.setInput('keys', pool.slice(0, n).sort((a, b) => a - b).join(','));
        rt.setInput('mode', 'avl');
        rt.load();
      },
    },
    { label: '🔃 LL 型（左左过重 → 右旋）', run(rt) { rt.setInput('keys', '30,20,10'); rt.setInput('mode', 'avl'); rt.load(); } },
    { label: '🔃 RR 型（右右过重 → 左旋）', run(rt) { rt.setInput('keys', '10,20,30'); rt.setInput('mode', 'avl'); rt.load(); } },
    { label: '🔀 LR 型（左右过重 → 先左后右）', run(rt) { rt.setInput('keys', '30,10,20'); rt.setInput('mode', 'avl'); rt.load(); } },
    { label: '🔀 RL 型（右左过重 → 先右后左）', run(rt) { rt.setInput('keys', '10,30,20'); rt.setInput('mode', 'avl'); rt.load(); } },
    { label: '📝 2021-6 真题（插入 23 后根是谁）', run(rt) { rt.setInput('keys', '20,16,30,25,40,23'); rt.setInput('mode', 'avl'); rt.load(); } },
    { label: '📉 同一序列 · 普通 BST（退化成链）', run(rt) { rt.setInput('keys', '1,2,3,4,5,6,7,8,9,10'); rt.setInput('mode', 'bst'); rt.load(); } },
    { label: '📈 同一序列 · AVL（自动平衡）', run(rt) { rt.setInput('keys', '1,2,3,4,5,6,7,8,9,10'); rt.setInput('mode', 'avl'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const raw = String(vals.keys === undefined || vals.keys === null ? '' : vals.keys).trim();
    if (!raw) throw { message: '请输入关键字序列，例如 30,20,10（逗号 / 空格分隔）' };
    const toks = raw.split(/[,，、;；\s]+/).filter(Boolean);
    const seq = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!/^\d+$/.test(t)) throw { message: '「' + t + '」不是非负整数；关键字只支持 0~999 的整数（不要小数、字母、负号）' };
      const v = parseInt(t, 10);
      if (v > 999) throw { message: '关键字 ' + v + ' 超出演示范围（只支持 0~999）' };
      if (seq.indexOf(v) < 0) seq.push(v);          // BST 关键字互不相同，重复的忽略
    }
    if (!seq.length) throw { message: '至少要有 1 个不同的关键字' };
    if (seq.length > 15) throw { message: '关键字最多 15 个（便于展示，当前 ' + seq.length + ' 个不同关键字）' };
    const sorted = seq.slice().sort(function (a, b) { return a - b; });
    const slotOf = {};
    sorted.forEach(function (k, i) { slotOf[k] = i; });
    return {
      seq: seq, sorted: sorted, slotOf: slotOf,
      mode: vals.mode === 'bst' ? 'bst' : 'avl',
      dropped: toks.length - seq.length,
    };
  },

  /* ---------------- ② 纯算法：逐动作产出快照（零 DOM） ---------------- */
  buildSnapshots(model) {
    const seq = model.seq, slotOf = model.slotOf, mode = model.mode;
    const modeName = mode === 'avl' ? 'AVL 平衡二叉树' : '普通二叉排序树';
    const bstH = _avPlainHeights(seq);

    const nodes = [];            // 下标 = id（插入次序）
    let root = null;
    let nextId = 0;
    let rotTotal = 0, cmpTotal = 0;
    const snaps = [];

    const copyTree = function () {
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        out.push(n ? { id: n.id, key: n.key, left: n.left, right: n.right, parent: n.parent } : null);
      }
      return out;
    };

    /** 一帧：from 缺省 = 本帧坐标（即"没有位移"，不动画） */
    const mk = function (step, o) {
      const g = _avPos(nodes, root, slotOf);
      const done = o.done === undefined ? 0 : o.done;
      snaps.push({
        step: step, mode: mode, done: done,
        nodes: copyTree(), root: root,
        pos: g.pos, from: o.from || g.pos,
        meta: g.meta, bstH: bstH[done],
        key: o.key === undefined ? null : o.key,
        path: o.path ? o.path.slice() : [],
        cur: o.cur === undefined ? null : o.cur,
        ins: o.ins === undefined ? null : o.ins,
        unbal: o.unbal ? o.unbal.slice() : [],
        rot: o.rot || null,
        rotTotal: rotTotal, cmpTotal: cmpTotal,
        desc: o.desc || '', log: o.log || '', logType: o.logType || 'info',
      });
    };

    /* ---------- 第 0 帧：就绪 ---------- */
    mk('init', {
      done: 0,
      desc: '就绪：共 ' + seq.length + ' 个关键字，按「' + modeName + '」依次插入。'
        + (mode === 'avl' ? '插入后自底向上找第一个 |BF| ≥ 2 的结点并旋转。' : '不做任何旋转，观察它会不会退化成单支链。'),
      log: '就绪：' + seq.length + ' 个关键字 / ' + modeName,
      logType: 'info',
    });

    /* ---------- 逐个插入 ---------- */
    seq.forEach(function (key, qi) {
      /* ① 查找路径（每比较一次一帧） */
      const path = [];
      let curId = root;
      while (curId !== null) {
        path.push(curId);
        const c = nodes[curId];
        cmpTotal++;
        const dir = key < c.key ? -1 : (key > c.key ? 1 : 0);
        mk('cmp', {
          done: qi, key: key, path: path, cur: curId,
          desc: '比较 ' + key + (dir === 0 ? ' = ' : (dir < 0 ? ' < ' : ' > ')) + c.key
            + (dir === 0 ? '：已存在，跳过' : '：走' + (dir < 0 ? '左' : '右') + '子树'),
          log: '第 ' + (qi + 1) + ' 个关键字 ' + key + '：与 ' + c.key + ' 比较 → '
            + (dir < 0 ? '向左' : dir > 0 ? '向右' : '相等（跳过）'),
          logType: 'info',
        });
        if (dir === 0) { curId = null; break; }
        curId = dir < 0 ? c.left : c.right;
      }

      /* ② 插入到叶位置 */
      const g0 = _avPos(nodes, root, slotOf).pos;
      const nd = { id: nextId++, key: key, left: null, right: null, parent: null };
      nodes[nd.id] = nd;
      if (root === null) root = nd.id;
      else {
        let p = root;
        for (;;) {
          const pn = nodes[p];
          if (key < pn.key) {
            if (pn.left === null) { pn.left = nd.id; nd.parent = p; break; }
            p = pn.left;
          } else {
            if (pn.right === null) { pn.right = nd.id; nd.parent = p; break; }
            p = pn.right;
          }
        }
      }
      mk('insert', {
        done: qi + 1, key: key, path: path, ins: nd.id, from: g0,
        desc: '把 ' + key + ' 作为叶结点插入（新结点一定落在叶位置）',
        log: '插入 ' + key + ' ✓',
        logType: 'success',
      });

      if (mode !== 'avl') return;

      /* ③ 自底向上找最小不平衡子树并旋转（正常情况只调整一次） */
      let didRot = false, guard = 0;
      while (guard++ < 6) {
        const g = _avPos(nodes, root, slotOf);
        let zId = null;
        for (let i = 0; i < g.meta.order.length; i++) {
          const id = g.meta.order[i];
          if (Math.abs(g.meta.bf[id]) >= 2 && (zId === null || g.meta.depth[id] > g.meta.depth[zId])) zId = id;
        }
        if (zId === null) break;

        const zn = nodes[zId];
        const bfz = g.meta.bf[zId];
        const yId = bfz > 0 ? zn.left : zn.right;
        const bfy = g.meta.bf[yId];
        const type = bfz > 0 ? (bfy >= 0 ? 'LL' : 'LR') : (bfy <= 0 ? 'RR' : 'RL');
        const zKey = zn.key, yKey = nodes[yId].key;

        mk('unbal', {
          done: qi + 1, key: key, unbal: [zId],
          desc: '失衡！结点 ' + zKey + ' 的 BF = ' + _avBfTxt(bfz)
            + '（|BF| ≥ 2），它是最小不平衡子树的根 z；较高孩子 y = ' + yKey
            + '（BF = ' + _avBfTxt(bfy) + '）⟹ ' + type + ' 型',
          log: '失衡：结点 ' + zKey + ' 的 BF = ' + _avBfTxt(bfz) + '（' + type + ' 型）',
          logType: 'error',
        });

        const parts = type === 'LL' ? [['右旋', zId]]
          : type === 'RR' ? [['左旋', zId]]
            : type === 'LR' ? [['左旋', yId], ['右旋', zId]]
              : [['右旋', yId], ['左旋', zId]];

        parts.forEach(function (pt, pi) {
          const dir = pt[0], at = pt[1];
          const atNode = nodes[at];
          const y2 = dir === '右旋' ? atNode.left : atNode.right;
          const bId = y2 === null ? null : (dir === '右旋' ? nodes[y2].right : nodes[y2].left);
          const atKey = atNode.key;
          const y2Key = y2 === null ? '—' : nodes[y2].key;
          const bKey = bId === null ? null : nodes[bId].key;
          const gb = _avPos(nodes, root, slotOf).pos;
          root = dir === '右旋' ? _avRotR(nodes, at, root) : _avRotL(nodes, at, root);
          rotTotal++;
          didRot = true;
          const sideTxt = dir === '右旋'
            ? y2Key + ' 上升为子树的根，' + atKey + ' 下降为它的右孩子'
              + (bKey === null ? '（原来的右子树为空）' : '，' + y2Key + ' 原来的右子树（根 ' + bKey + '）改挂为 ' + atKey + ' 的左子树')
            : y2Key + ' 上升为子树的根，' + atKey + ' 下降为它的左孩子'
              + (bKey === null ? '（原来的左子树为空）' : '，' + y2Key + ' 原来的左子树（根 ' + bKey + '）改挂为 ' + atKey + ' 的右子树');
          mk('rot', {
            done: qi + 1, key: key, from: gb,
            /* z / y 取**本步**的轴与上升结点（双旋第 2 步的 y 不是型判定时的那个 y，
               否则蓝圈会标错人）；z0 保留原始失衡结点，用红圈提示"从哪失衡的" */
            rot: { type: type, z: at, y: y2, z0: zId, part: pi + 1, dir: dir, at: at, t: bId, zKey: zKey, yKey: yKey },
            desc: type + ' 型' + (parts.length > 1 ? '（第 ' + (pi + 1) + '/2 步）' : '')
              + '：对 ' + atKey + ' ' + dir + ' —— ' + sideTxt + '。旋转不改变中序序列。',
            log: type + ' 型：对 ' + atKey + ' ' + dir + (parts.length > 1 ? '（' + (pi + 1) + '/2）' : ''),
            logType: 'warn',
          });
        });
      }

      if (didRot) {
        const g2 = _avPos(nodes, root, slotOf);
        mk('settled', {
          done: qi + 1, key: key,
          desc: '调整完成：全树重新满足 |BF| ≤ 1（插入最多只需一次调整），当前树高 ' + g2.meta.height,
          log: '调整完成，树高 ' + g2.meta.height,
          logType: 'success',
        });
      }
    });

    /* ---------- 收尾帧 ---------- */
    const gf = _avPos(nodes, root, slotOf);
    const avlH = gf.meta.height, plainH = bstH[seq.length];
    mk('done', {
      done: seq.length,
      desc: '全部插入完成：' + seq.length + ' 个关键字，当前树高 ' + avlH
        + (mode === 'avl'
          ? '；同样序列若不做平衡，普通 BST 的树高是 ' + plainH
            + (plainH > avlH ? '（AVL 把高度压掉了 ' + (plainH - avlH) + ' 层）' : '（本序列恰好没退化）')
          : '；切到「AVL」模式可看同一序列自动平衡后的高度')
        + '。累计旋转 ' + rotTotal + ' 次。',
      log: '完成：树高 ' + avlH + '（普通 BST 为 ' + plainH + '），累计旋转 ' + rotTotal + ' 次',
      logType: 'success',
    });

    /* ---------- 坐标系（全帧统一，避免画面跳动） ---------- */
    let maxD = 0;
    snaps.forEach(function (s) { if (s.meta.maxDepth > maxD) maxD = s.meta.maxDepth; });
    const W = _avMargin * 2 + Math.max(seq.length - 1, 0) * _avGap;
    const H = _avTop + maxD * _avLevel + _avBottom;
    snaps.forEach(function (s) { s.W = W; s.H = H; });
    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ---------------- */
  render(ctx) {
    const s = ctx.snap, model = ctx.model, stage = ctx.stage;
    const nodes = s.nodes, pos = s.pos, from = s.from, meta = s.meta;
    const empty = meta.nodeCount === 0;

    /* 本帧发生位移的结点（渲染动画 + "旋转前"幽灵） */
    const moved = [];
    for (let i = 0; i < meta.order.length; i++) {
      const id = meta.order[i];
      const f = from[id];
      if (f && (f.x !== pos[id].x || f.y !== pos[id].y)) moved.push(id);
    }
    const isRot = s.step === 'rot';
    const unbalSet = {};
    s.unbal.forEach(function (id) { unbalSet[id] = true; });

    /* ---------- 颜色 ---------- */
    const fillOf = function (id) {
      if (unbalSet[id]) return { f: '#ef4444', t: '#fff' };
      if (isRot && s.rot) {
        if (id === s.rot.y) return { f: '#2563eb', t: '#fff' };
        if (id === s.rot.z) return { f: '#ef4444', t: '#fff' };
        if (s.rot.t !== null && id === s.rot.t) return { f: '#06b6d4', t: '#fff' };
      }
      if (s.ins !== null && id === s.ins) return { f: '#10b981', t: '#fff' };
      if (s.path.indexOf(id) >= 0) return { f: '#f59e0b', t: '#fff' };
      return { f: '#e2e8f0', t: '#475569' };
    };

    /* ---------- 动画关键帧（内联注入，零 style.css 改动） ---------- */
    const css = [];

    /* 边：在**孩子**的绝对坐标帧里画线，位移用"仿射变换"从旧位置移到新位置。
       因为 x 是固定槽位（中序不变），所有位移都是纯竖直的，这条仿射变换在
       起点与终点都**精确**落在两端结点圆心，中途也不会脱节。 */
    let edgeSvg = '';
    for (let i = 0; i < meta.order.length; i++) {
      const id = meta.order[i];
      const pid = nodes[id].parent;
      if (pid === null || pid === undefined || !pos[pid]) continue;
      const a = pos[id], b = pos[pid];
      const bx = b.x - a.x, by = b.y - a.y;
      const isNew = !from[id];
      let anim = '';
      if (isNew) {
        css.push('@keyframes _avE' + id + '{from{opacity:0}to{opacity:1}}');
        anim = ' style="animation:_avE' + id + ' ' + _avDur + ' ' + _avEase + ' both"';
      } else if (moved.indexOf(id) >= 0 || moved.indexOf(pid) >= 0) {
        const dc = { x: from[id].x - a.x, y: from[id].y - a.y };
        const dp = { x: from[pid].x - b.x, y: from[pid].y - b.y };
        const wx = bx + dp.x - dc.x, wy = by + dp.y - dc.y;
        const su = Math.sqrt(bx * bx + by * by), sw = Math.sqrt(wx * wx + wy * wy);
        const sc = su > 0.001 ? sw / su : 1;
        let th = (Math.atan2(wy, wx) - Math.atan2(by, bx)) * 180 / Math.PI;
        th = ((th + 540) % 360) - 180;
        css.push('@keyframes _avE' + id + '{from{transform:translate(' + dc.x + 'px,' + dc.y + 'px) rotate('
          + th.toFixed(3) + 'deg) scale(' + sc.toFixed(4) + ')}to{transform:translate(0px,0px) rotate(0deg) scale(1)}}');
        anim = ' style="animation:_avE' + id + ' ' + _avDur + ' ' + _avEase + ' both"';
      }
      const hot = (s.ins === id) || (s.step === 'cmp' && s.cur === id) || (s.rot && (s.rot.z === id || s.rot.y === id));
      edgeSvg += '<g transform="translate(' + a.x + ',' + a.y + ')"><g' + anim + '>'
        + '<line x1="0" y1="0" x2="' + bx + '" y2="' + by + '" stroke="' + (hot ? '#94a3b8' : '#cbd5e1')
        + '" stroke-width="' + (hot ? 3.5 : 2.5) + '" stroke-linecap="round"/></g></g>';
    }

    /* 幽灵：旋转帧标出各结点的"旋转前"位置 */
    let ghostSvg = '';
    if (isRot) {
      moved.forEach(function (id) {
        const g = from[id], p = pos[id];
        ghostSvg += '<g opacity="0.5">'
          + '<line x1="' + g.x + '" y1="' + g.y + '" x2="' + p.x + '" y2="' + p.y
          + '" stroke="#a5b4fc" stroke-width="2" stroke-dasharray="4 4"/>'
          + '<circle cx="' + g.x + '" cy="' + g.y + '" r="15" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 4"/>'
          + '<text x="' + g.x + '" y="' + g.y + '" dy="0.35em" text-anchor="middle"'
          + ' style="font:700 11px Consolas,ui-monospace,monospace;fill:#94a3b8">' + nodes[id].key + '</text>'
          + '</g>';
      });
    }

    /* 结点 */
    let nodeSvg = '';
    for (let i = 0; i < meta.order.length; i++) {
      const id = meta.order[i];
      const nd = nodes[id], p = pos[id], col = fillOf(id);
      let anim = '';
      if (moved.indexOf(id) >= 0) {
        css.push('@keyframes _avN' + id + '{from{transform:translate(' + (from[id].x - p.x) + 'px,'
          + (from[id].y - p.y) + 'px)}to{transform:translate(0px,0px)}}');
        anim = ' style="animation:_avN' + id + ' ' + _avDur + ' ' + _avEase + ' both"';
      } else if (!from[id]) {
        const par = nd.parent;
        const dx = (par !== null && pos[par]) ? pos[par].x - p.x : 0;
        const dy = (par !== null && pos[par]) ? pos[par].y - p.y : -20;
        css.push('@keyframes _avN' + id + '{from{transform:translate(' + dx + 'px,' + dy + 'px);opacity:0}'
          + 'to{transform:translate(0px,0px);opacity:1}}');
        anim = ' style="animation:_avN' + id + ' ' + _avDur + ' ' + _avEase + ' both"';
      }
      const isCur = (s.step === 'cmp' && s.cur === id);
      /* 红圈：查找中的当前结点 / 失衡结点 / 本步不是轴的那个"原始最小不平衡子树根" */
      const ringZ0 = isRot && s.rot && s.rot.z0 === id && s.rot.z0 !== s.rot.z;
      const halo = (isCur || unbalSet[id] || ringZ0)
        ? '<circle cx="0" cy="0" r="27" class="knode-halo" style="stroke:'
          + ((unbalSet[id] || ringZ0) ? '#ef4444' : '#6366f1') + '"/>'
        : '';
      const bfv = meta.bf[id];
      const bfColor = Math.abs(bfv) >= 2 ? '#dc2626' : (bfv === 0 ? '#059669' : '#64748b');
      nodeSvg += '<g transform="translate(' + p.x + ',' + p.y + ')"><g' + anim + '>'
        + halo
        + '<circle cx="0" cy="0" r="' + _avR + '" class="knode-circle" fill="' + col.f + '"/>'
        + '<text x="0" y="0" dy="0.35em" class="knode-text" style="fill:' + col.t + '">' + nd.key + '</text>'
        + '<text x="0" y="-28" text-anchor="middle" style="font:800 11px Consolas,ui-monospace,monospace;fill:'
        + bfColor + ';paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round">'
        + _avBfTxt(bfv) + '</text>'
        + '</g></g>';
    }

    /* ---------- 统计卡 ---------- */
    let hMax = 1;
    while (_avMin(hMax + 1) <= meta.nodeCount) hMax++;
    if (meta.nodeCount < 1) hMax = 0;
    const unbalNow = meta.order.filter(function (id) { return Math.abs(meta.bf[id]) >= 2; }).length;
    const nxt = _avMin(hMax + 1);
    const stats =
      RC408.ui.statCard('结点数 / 树高', empty ? '0' : meta.nodeCount + ' 个',
        empty ? '（空树）' : '树高 h = ' + meta.height)
      + RC408.ui.statCard('普通 BST 树高（同序列）', String(s.bstH),
        s.mode === 'avl' && s.bstH > meta.height ? 'AVL 比它矮 ' + (s.bstH - meta.height) + ' 层' : '不做平衡时的插入高度')
      + RC408.ui.statCard('失衡结点数', String(unbalNow),
        '当前 |BF| ≥ 2 的结点（应为 0）', unbalNow ? 'text-rose-600' : 'text-emerald-600')
      + RC408.ui.statCard('累计旋转次数', String(s.rotTotal),
        'LL/RR 各 1 次，LR/RL 各 2 次', 'text-indigo-600');

    /* ---------- 结点表（关键字 / 高度 / 平衡因子） ---------- */
    const byKey = meta.order.slice().sort(function (a, b) { return nodes[a].key - nodes[b].key; });
    const chips = byKey.map(function (id) {
      const bfv = meta.bf[id];
      const cls = Math.abs(bfv) >= 2 ? 'chip-flash' : (bfv === 0 ? 'chip-hit' : 'chip-check');
      const side = bfv > 0 ? '左重' : bfv < 0 ? '右重' : '等高';
      return RC408.ui.chip(nodes[id].key + ' · h=' + meta.h[id] + ' · BF=' + _avBfTxt(bfv), cls,
        '结点 ' + nodes[id].key + '：左右子树高 ' + (meta.h[id] - 1 - Math.max(0, -bfv)) + ' / '
        + (meta.h[id] - 1 - Math.max(0, bfv)) + '，' + side);
    }).join('');

    /* ---------- 插入进度 ---------- */
    const insChips = model.seq.map(function (k, i) {
      const done = i < s.done;
      const curKey = (s.key !== null && s.key === k && i === s.done - 1);
      return RC408.ui.chip(String(k), curKey ? 'chip-cur' : (done ? 'chip-mst' : 'chip-future'),
        done ? '已插入' : '尚未插入');
    }).join('<span class="text-slate-300 self-center">›</span>');

    /* ---------- N(h) 参考行 ---------- */
    const nhChips = [1, 2, 3, 4, 5, 6, 7].map(function (h) {
      const hot = (h === hMax && !empty);
      return RC408.ui.chip('h=' + h + ' → ' + _avMin(h), hot ? 'chip-check' : 'chip-future',
        '高度 ' + h + ' 的 AVL 树最少需要 ' + _avMin(h) + ' 个结点');
    }).join('');

    /* ---------- 提示条 ---------- */
    const tip = unbalNow
      ? '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">'
        + '⚠️ 当前存在 ' + unbalNow + ' 个 |BF| ≥ 2 的结点 —— ' + (s.mode === 'avl' ? '下一步就会旋转调整（正常只在"失衡"那一帧出现）' : '普通 BST 不旋转，会一直失衡下去') + '</div>'
      : (s.mode === 'avl'
        ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">'
          + '✓ 全树平衡：每个结点的 |BF| ≤ 1。旋转不改变中序序列，插入最多只需调整一次。</div>'
        : '<div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-600">'
          + '普通 BST 不做平衡：插入有序序列时会长成单支链，树高 = 结点数，查找退化到 O(n)。</div>');

    const legend = RC408.ui.legend('#f59e0b', '查找路径经过的结点')
      + RC408.ui.legend('#10b981', '本步新插入的结点')
      + RC408.ui.legend('#ef4444', '本次旋转的轴 z（旋转后下降）')
      + RC408.ui.legend('#2563eb', '上升为子树根的 y')
      + RC408.ui.legend('#06b6d4', '被移交的子树（改挂到另一侧）')
      + RC408.ui.legend('#ef4444', '红圈 = 最小不平衡子树的根（双旋时它可能还没轮到转）')
      + RC408.ui.legend('#94a3b8', '虚线圆圈 = 该结点"旋转前"的位置');

    const svg = empty
      ? '<div class="py-10 text-center text-sm text-slate-400">（空树：还没有插入任何关键字）</div>'
      : '<svg viewBox="0 0 ' + s.W + ' ' + s.H + '" class="w-full h-auto mx-auto" style="max-width:' + Math.max(s.W, 480) + 'px">'
        + edgeSvg + ghostSvg + nodeSvg + '</svg>';

    stage.innerHTML =
      '<div class="space-y-4">'
      /* 关键帧内联注入（零 style.css 改动）：每帧重建 DOM 会重放 animation；
         必须放在 <svg> 之外——HTML 解析器在 SVG 外来内容里对 <style> 的处理不稳妥 */
      + '<style>' + css.join('') + '</style>'
      + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + stats + '</div>'
      + tip
      + '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">'
      + svg + '</div>'
      + '<div>' + RC408.ui.sectionTitle('结点一览（结点上方数字 = 平衡因子 BF = 左子树高 − 右子树高）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5">' + (chips || '<span class="text-xs text-slate-400">（暂无结点）</span>') + '</div>'
      + '<div>' + RC408.ui.sectionTitle('插入顺序（已完成 ' + s.done + ' / ' + model.seq.length + '）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5 items-center">' + insChips + '</div>'
      + '<div>' + RC408.ui.sectionTitle('高度 h 的 AVL 树最少结点数 N(h) = N(h−1) + N(h−2) + 1（2012-4、2026-8 都靠它）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5">' + nhChips + '</div>'
      + '<div class="text-xs text-slate-500">' + (empty
        ? '空树：还没有结点。'
        : '当前 n = ' + meta.nodeCount + ' ⟹ AVL 树高最多 ' + hMax + '（因为 N(' + hMax + ') = ' + _avMin(hMax)
          + ' ≤ ' + meta.nodeCount + ' < N(' + (hMax + 1) + ') = ' + nxt + '）；普通 BST 最坏可到 n = ' + meta.nodeCount + '。')
        + '</div>'
      + '<div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">' + legend + '</div>'
      + '</div>';
  },
});
