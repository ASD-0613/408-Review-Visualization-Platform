'use strict';
/* ============================================================================
 * tree-forest.js —— 【数据结构】树、森林与二叉树的转换（左孩子右兄弟）
 * ----------------------------------------------------------------------------
 * 考情：18 年中 **8 年**考（全为选择题）= 2009-6、2011-6、2014-5、2019-2、2020-4、2021-4、2025-4、2026-4。
 *   逐条依据、"看着像但不登记"的对照清单、以及与 `ds-bintree-traversal` 的边界，
 *   全部写在 `js/exam-history.js` 该条注释里（窗36 从零核定）。
 *
 * ── 数据模型（parse 的产物） ──────────────────────────────────────────────
 *   forest : 树的数组，元素 = 第 i 棵树的根结点 id（k = forest.length）
 *   nodes  : 全部结点按 id 索引 —— { id, label, parent, kids:[孩子 id], tree, depth, sib, first, next, bdepth }
 *   n      : 结点总数；leafIds = 叶结点（kids 为空）；root = 转换后二叉树的根 = forest[0].id
 *
 * ── 三个"同名量"的单位（闸门 2：先钉死口径，再写断言） ────────────────────
 *   depth —— 在**原森林**里的层号，**根为 1**（教材口径）
 *   sib   —— 在**原森林**里的兄弟序号，**第一个孩子为 1**
 *   tree  —— 属于第几棵树，**从 1 起**
 *   bdepth（二叉树层号，根为 1）由上面两个推出，是本模块所有结构/几何断言的根：
 *        bdepth(v) = 沿"树根 → v"的路径把兄弟序号累加
 *        递归写法：a 是 p 的第 s 个孩子 ⟹ bdepth(a) = bdepth(p) + s；第 t 棵树的根 bdepth = t
 *        ⚠ 别写成 depth + (sib−1) + (tree−1)：树根的 sib 恰等于 tree，会被重复计一次（窗36 实测）
 *
 * ── 不变量（任意帧成立；"转换完成帧"额外要求"已建边 = 全部边"） ─────────────
 *   I1 左孩子 = 第一个孩子：first(v) = kids(v)[0] ?? null
 *   I2 右孩子 = 下一个兄弟：next(v) = 同父孩子表的下一个；**各棵树的根互为兄弟**，
 *      第 i 棵树的根 next = 第 i+1 棵树的根（"森林 → 一棵二叉树"就靠这条接起来）
 *   I3 转换只改指针、不改结点集合：两边结点集合完全相同（id 一一对应）
 *   I4 边的条数（**别把"父子边"与"左链边"混成一个数**）：
 *      原森林 —— 父子边 n−k 条（除各棵树根之外的每个结点贡献 1 条）
 *      二叉树 T —— 共 n−1 条（n 个结点的二叉树就是 n−1 条边），其中
 *          左链边 = **分支结点数**（每个有孩子的结点恰好贡献一条左链）
 *          右链边 = (n−1) − 分支结点数 = 兄弟间的 (n−k−分支结点数) + 树根之间的 (k−1)
 *   I5 T 的根**右链长度 = k** ⟹ 根没有右孩子 ⟺ 森林只有一棵树
 *   I6 F 中叶结点数 = T 中**左孩子为空**的结点数（2014-5）；
 *      T 中**无右孩子的结点数 = 分支结点数 + 1**（2011-6）
 *   I7 森林的先序遍历序列 ≡ T 的先序序列；森林的中序遍历（= 各棵树的后根遍历）≡ T 的中序序列
 *   I8 树的转换高度 h_i = （该树结点在整棵 T 里的最大层号）− (i−1)；T 的高度 = max_i (h_i + i − 1)
 *   I9 把各棵树的 h_i **降序**排列后 max_i (h_i + i − 1) 就是 T 的最小高度（2026-4 的算法）
 *
 * ── 帧设计（快照全量携带视觉状态，§1.3 铁律） ────────────────────────────
 *   mode = 't2b' / 'b2t'：按**森林的先根次序**（= T 的先序）逐结点处理，每结点 1 帧；
 *        两个方向共用同一套边，只是解说方向相反（接指针 / 读回来）。
 *   mode = 'pre' / 'post'：在完成态的两棵树上同步走一遍，每结点 1 帧，输出序列实时生长；
 *        'pre' ⟹ 先根 ≡ 先序，'post' ⟹ 后根 ≡ 中序。
 *   每帧字段（**每一帧都带齐**，回退 / 跳帧才不会串味）：
 *        { type, cur, doneIds, edges, path, out, desc, log, logType }
 * ========================================================================== */

/* ---------------- 版面常量（结点半径 / 列间距按结点数自适应） ---------------- */
const _tfROW = 76;                                       // 层间距
const _tfRad = n => (n <= 12 ? 20 : n <= 16 ? 17 : 14);  // 结点半径
const _tfStep = n => (n <= 12 ? 82 : n <= 16 ? 64 : 50); // 相邻列间距
const _tfPad = 30;                                       // 画布内边距

function _tfEsc(s) { return RC408.util.esc(String(s)); }

/* 画一个结点：圆 + 文字 + 可选角标；cls 只当选择器用（不配 CSS，见 §4.6） */
function _tfDot(x, y, r, id, label, fill, txt, cls, badge) {
  const fs = Math.max(10, Math.round(r * 0.92));
  return '<g class="' + cls + '" data-id="' + id + '">' +
    '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" class="knode-circle" fill="' + fill + '"/>' +
    '<text x="' + x + '" y="' + y + '" dy="0.35em" class="knode-text" style="fill:' + txt + ';font-size:' + fs + 'px">' +
    _tfEsc(label) + '</text>' +
    (badge ? '<text class="tf-no" x="' + (x + r - 2) + '" y="' + (y - r + 2) +
      '" style="font:800 11px Consolas,monospace;fill:#065f46;text-anchor:middle">' + badge + '</text>' : '') +
    '</g>';
}

/* 画一条边 */
function _tfLine(a, b, stroke, w, dash, cls, op) {
  return '<line class="' + cls + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y +
    '" stroke="' + stroke + '" stroke-width="' + w + '"' +
    (dash ? ' stroke-dasharray="' + dash + '"' : '') +
    (op === undefined ? '' : ' opacity="' + op + '"') + ' stroke-linecap="round"/>';
}

/* 森林（普通树形）布局：叶子占槽位、父结点居中；多棵树依次横排。
   坐标写回 nd._lx（槽位）；返回 { span, maxD } */
function _tfForestLayout(model) {
  const { nodes, forest } = model;
  let cursor = 0, maxD = 1;
  const place = id => {
    const nd = nodes[id];
    maxD = Math.max(maxD, nd.depth);
    if (!nd.kids.length) { nd._lx = cursor; cursor += 1; }
    else {
      nd.kids.forEach(place);
      nd._lx = (nodes[nd.kids[0]]._lx + nodes[nd.kids[nd.kids.length - 1]]._lx) / 2;
    }
  };
  forest.forEach(t => { place(t.id); cursor += 0.6; });
  return { span: Math.max(cursor - 0.6, 1), maxD };
}

/* 二叉树布局：x = 中序序号（左孩子右兄弟树的标准画法，无交叉），y = 层号（根为 1）。
   坐标写回 nd._bx / nd._by；返回 { cols, maxD } */
function _tfBinLayout(model) {
  const { nodes } = model;
  let ix = 0, maxD = 1;
  const walk = (id, d) => {
    if (id === null) return;
    maxD = Math.max(maxD, d);
    walk(nodes[id].first, d + 1);
    nodes[id]._bx = ix++; nodes[id]._by = d;
    walk(nodes[id].next, d + 1);
  };
  walk(model.root, 1);
  return { cols: Math.max(ix, 1), maxD };
}

/* 森林的"先根 / 后根"遍历序列（森林 = 依次遍历各棵树） */
function _tfForestSeq(model, kind) {
  const { nodes, forest } = model;
  const out = [];
  const go = id => {
    const nd = nodes[id];
    if (kind === 'pre') out.push(id);
    nd.kids.forEach(go);
    if (kind === 'post') out.push(id);
  };
  forest.forEach(t => go(t.id));
  return out;
}

/* 二叉树的先序 / 中序序列（**独立参考实现**：直接沿 first / next 走，不借用森林遍历，§3.8-1） */
function _tfBinSeq(model, kind) {
  const { nodes } = model;
  const out = [];
  const go = id => {
    if (id === null) return;
    const nd = nodes[id];
    if (kind === 'pre') out.push(id);
    go(nd.first);
    if (kind === 'in') out.push(id);
    go(nd.next);
  };
  go(model.root);
  return out;
}

/* 从某结点开始一路沿右指针（next）走，能走到的结点数 */
function _tfRightChain(model, id) {
  const { nodes } = model;
  let c = 0, cur = id;
  while (cur !== null && cur !== undefined) { c++; cur = nodes[cur].next; }
  return c;
}

/* 森林的先根次序 = 转换后二叉树的先序（'t2b' / 'b2t' 的处理次序） */
function _tfPreOrder(model) { return _tfBinSeq(model, 'pre'); }

/* 从某结点到它所在树的根（含两端）的路径 */
function _tfPath(model, id) {
  const { nodes } = model;
  const p = [];
  let cur = id;
  while (cur !== null && cur !== undefined) { p.unshift(cur); cur = nodes[cur].parent; }
  return p;
}

/* ========================================================================== */

RC408.registerModule({
  id: 'ds-tree-forest',
  mode: 'stepper',
  title: '树、森林与二叉树的转换（左孩子右兄弟）',

  theory: `
> **为什么要有它**：树和森林里"一个结点可以有任意多个孩子"，二叉树的每个结点最多两个孩子——两类结构的指针字段不一样，遍历结论也不一样。把树 / 森林**翻译**成二叉树（**左孩子右兄弟**表示法），就能拿二叉树那一整套算法与结论去处理它们。
> **怎么实现**：每个结点只留两个指针——**左指针指向第一个孩子**（存原来的父子关系），**右指针指向下一个兄弟**（存原来的兄弟关系）；森林里**各棵树的根互为兄弟**，于是第 2 棵树起的根依次挂在第 1 棵树根的右链上，整个森林就成了一棵二叉树。
> **记住什么**：转换**只改指针、不改结点集合**；原森林的每条父子边变成一条左链边、每对相邻兄弟变成一条右链边；**T 的根有没有右孩子 ⟺ 森林是不是只有一棵树**；遍历对应是**先根 ≡ 先序**、**后根 ≡ 中序**。

## 转换规则（左孩子右兄弟）
| 原森林里 | 二叉树 T 里 |
| --- | --- |
| v 是 u 的**第一个孩子** | v 是 u 的**左孩子** |
| v 是 u 的第 k 个孩子（k ≥ 2） | v 是 u 第一个孩子的**右链上第 k−1 个** |
| v 是 u 的**下一个兄弟** | v 是 u 的**右孩子** |
| 各棵树的根 | 依次接成一条**右链**，第 1 棵树的根就是 T 的根 |

- **只改指针、不改结点**：结点个数 \\(n\\) 不变；原森林有 \\(n-k\\) 条父子边，转换后二叉树共 \\(n-1\\) 条边 = **左链边（= 分支结点数）** + 右链边；
  别把"父子边"与"左链边"混成一个数——一个分支结点不论有几个孩子，**只在左链上贡献一条边**；
- **反向（二叉树 → 树 / 森林）**：把每个结点的**左孩子还原成第一个孩子**、**右孩子还原成下一个兄弟**；根结点**没有右孩子就是一棵树、有右孩子就是森林**（根的右链上有几个结点，森林就有几棵树）；
- **同一结点在两边的层号不是一回事**（两条同名的量，别混着用）：\\(v\\) 在 T 里的层号 = **从它所在树的根到 \\(v\\) 的路径上各结点兄弟序号之和**（第 \\(t\\) 棵树的根在 T 里就是第 \\(t\\) 层）；所以"原树第 3 层"与"T 里第 3 层"通常不是同一批结点。

## 树 / 森林的遍历与二叉树遍历的对应
| 树 / 森林 | 二叉树 T |
| --- | --- |
| 树的**先根**遍历（先访问根，再依次先根遍历各棵子树） | **先序**遍历 |
| 树的**后根**遍历（先依次后根遍历各棵子树，再访问根） | **中序**遍历 |
| 森林的**先序**遍历（依次先根遍历各棵树） | **先序**遍历 |
| 森林的**中序**遍历（依次后根遍历各棵树） | **中序**遍历 |

## 考点提醒（易错点）
- **无右孩子的结点数 = 分支结点数 + 1**：每个分支结点的**最右孩子**没有右兄弟、根也没有右兄弟（2011-6：2011 个结点、116 个叶结点 ⟹ 分支结点 1895 个，答案 \\(1895+1=1896\\)）；
- **F 中叶结点的个数 = T 中左孩子为空的结点数**：叶结点没有孩子 ⟹ 左指针为空；反过来左指针为空就是叶结点（2014-5 的四个选项里只有这一条恒成立）；
- **T 的根右链长度 = 森林中树的棵数**：2021-4 只要按先序 + 中序把 T 画出来，从根一路往右数几个结点即可；
- **遍历对应要盯住方向**：题面给的是"森林的先根 / 中根序列"，那分别是 T 的**先序 / 中序**序列，**不是后序**（2020-4）；"树的后根遍历"对应二叉树的**中序**，不是后序（2019-2）；
- **转换会改变高度**：\\(h=\\max_i(h_i+i-1)\\)（\\(h_i\\) 是第 i 棵树转换后的高度）；次序任意时**把 \\(h_i\\) 大的树排在前面**能让 T 最矮（2026-4：五棵树 2/3/4/5/7 个结点，最小高度 6）；
- 陷阱（2009-6）：已知"u 是 v 的父结点的父结点"，反推原森林里 u、v 的关系时，**"u 的父结点与 v 的父结点是兄弟"这一条不成立**——那种情形下 u、v 分属最左父结点的两棵不同子树，不可能落在同一条路径上（答案只有"父子关系"与"兄弟关系"两种）。

> **真题考情**：**8/18 年（全为选择题）**：2009-6（转换后 u、v 的关系）、2011-6（无右孩子的结点数）、2014-5（F 的叶结点数 = T 中左孩子为空的结点数）、2019-2（树 T → 二叉树 BT 后的遍历对应）、2020-4（森林先根 / 中根序列 ↔ T 先序 / 中序）、2021-4（由 T 的先序 + 中序反推 F 的树数）、2025-4（左孩子右兄弟转换的性质辨析）、2026-4（五棵树的最小高度）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'forest', label: '森林（括号表示法，多棵树用逗号分隔）', type: 'textarea', rows: 2, wide: true,
      default: 'A(B(E,F),C,D(G)),H(I)',
      help: '结点名最长 3 个字符、总共最多 21 个结点；A(B,C),D(E) 表示两棵树；孩子写在括号里用逗号分隔',
    },
    {
      key: 'mode', label: '演示方式', type: 'select', default: 't2b',
      options: [
        { v: 't2b', t: '森林 / 树 → 二叉树（逐结点接左孩子、右兄弟）' },
        { v: 'b2t', t: '二叉树 → 树 / 森林（逐结点把左、右指针读回来）' },
        { v: 'pre', t: '遍历对应 · 先根遍历 ≡ 先序遍历' },
        { v: 'post', t: '遍历对应 · 后根遍历 ≡ 中序遍历' },
      ],
    },
  ],

  quickActions: [
    {
      label: '🎲 随机森林', run(rt) {
        const pool = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
        const nTree = RC408.util.rnd(1, 3);
        const parts = [];
        for (let t = 0; t < nTree; t++) {
          const reserve = (nTree - 1 - t) * 2;                 // 给后面每棵树至少留 2 个结点
          const budget = Math.min(RC408.util.rnd(2, 6), pool.length - reserve);
          if (budget < 2) break;
          const build = (left, depth) => {
            const me = pool.shift();
            const slots = left - 1;
            if (slots <= 0 || depth >= 4) return me;
            const nk = RC408.util.rnd(0, Math.min(3, slots));
            if (!nk) return me;
            const kids = [];
            let rem = slots;
            for (let i = 0; i < nk; i++) {
              const give = (i === nk - 1) ? rem : RC408.util.rnd(1, Math.max(1, rem - (nk - 1 - i)));
              kids.push(build(give, depth + 1));
              rem -= give;
            }
            return me + '(' + kids.join(',') + ')';
          };
          parts.push(build(budget, 1));
        }
        rt.setInput('forest', parts.length ? parts.join(',') : 'A(B,C),D(E)');
        rt.load();
      },
    },
    {
      label: '📄 2009-6（u 是 v 的祖父 → 判原森林关系）', run(rt) {
        rt.setInput('forest', 'A(B(D,E),C,F),G(H)'); rt.setInput('mode', 't2b'); rt.load();
      },
    },
    {
      label: '📄 2011-6（无右孩子的结点数）', run(rt) {
        rt.setInput('forest', 'A(B(D,E,F),C(G))'); rt.setInput('mode', 't2b'); rt.load();
      },
    },
    {
      label: '📄 2014-5（叶子数 = 左孩子为空的结点数）', run(rt) {
        rt.setInput('forest', 'A(B(C,D),E),F(G,H)'); rt.setInput('mode', 't2b'); rt.load();
      },
    },
    {
      label: '📄 2021-4（由 T 的先序 + 中序反推树数）', run(rt) {
        rt.setInput('forest', 'A(B,D),C(E,G),F'); rt.setInput('mode', 't2b'); rt.load();
      },
    },
    {
      label: '📄 2026-4（5 棵树 2/3/4/5/7 的最小高度）', run(rt) {
        rt.setInput('forest', 'A(B(E,F),C(G),D),H(I(K,L),J),M(N(O),P),Q(R,S),T(U)');
        rt.setInput('mode', 't2b'); rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入：森林的括号表示法 ---------------- */
  parse(vals) {
    const src = String(vals.forest === undefined ? '' : vals.forest)
      .replace(/（/g, '(').replace(/）/g, ')').trim();
    if (!src) throw { message: '请输入森林的括号表示法，如 A(B,C),D(E)' };
    if (/[^\w\u4e00-\u9fa5(),\s]/.test(src)) {
      throw { message: '只能出现结点名、括号、逗号与空格（结点名请用字母 / 数字 / 汉字）' };
    }

    const nodes = [], roots = [];
    let pos = 0;
    const readLabel = () => {
      const start = pos;
      while (pos < src.length && '(),'.indexOf(src[pos]) < 0) pos++;
      return src.slice(start, pos).trim();
    };
    const readTree = (depth, tree, parent) => {
      const name = readLabel();
      if (!name) throw { message: '括号表示法不完整：第 ' + (pos + 1) + ' 个字符处缺结点名（检查括号与逗号是否配对）' };
      const nd = { id: nodes.length, label: name.slice(0, 3), parent: parent, kids: [], tree: tree, depth: depth };
      nodes.push(nd);
      if (src[pos] === '(') {
        pos++;
        for (;;) {
          nd.kids.push(readTree(depth + 1, tree, nd.id).id);
          if (src[pos] === ',') { pos++; continue; }
          if (src[pos] === ')') { pos++; break; }
          throw { message: '括号不配对：读完 ' + nd.label + ' 的孩子后既不是 , 也不是 )' };
        }
      }
      return nd;
    };

    for (;;) {
      roots.push(readTree(1, roots.length + 1, null));
      if (pos >= src.length) break;
      if (src[pos] === ',') { pos++; continue; }
      throw { message: '第 ' + (pos + 1) + ' 个字符处无法解析：' + src[pos] };
    }
    if (nodes.length > 21) throw { message: '结点数最多 21 个（便于展示），现在是 ' + nodes.length + ' 个' };

    /* ---- 派生量：first / next / sib / bdepth（不变量 I1–I2 的载体） ---- */
    const rootIds = roots.map(t => t.id);
    nodes.forEach(nd => { nd.first = nd.kids.length ? nd.kids[0] : null; nd.next = null; });
    nodes.forEach(nd => {
      nd.kids.forEach((cid, i) => { nodes[cid].next = (i + 1 < nd.kids.length) ? nd.kids[i + 1] : null; });
    });
    rootIds.forEach((id, i) => { nodes[id].next = (i + 1 < rootIds.length) ? rootIds[i + 1] : null; });
    nodes.forEach(nd => {
      const sibs = nd.parent === null ? rootIds : nodes[nd.parent].kids;
      nd.sib = sibs.indexOf(nd.id) + 1;
    });
    /* bdepth = 沿"树根 → 本结点"的路径把兄弟序号**累加**（等价于递归式 bdepth = bdepth(parent) + sib）。
       ⚠ 窗36 第一版写成 `depth + (sib−1) + (tree−1)`，**对树根会重复计一次**（根的 sib 恰等于 tree）：
       `A(B,D),C(E,G),F` 里 C 是第 2 棵树的根，被算成第 3 层，实际是第 2 层。
       解析式：a 是 p 的第 s 个孩子 ⟹ bdepth(a) = bdepth(p) + s，而 bdepth(第 t 棵树的根) = t。
       模块内 `nodes` 按"父结点先于孩子"压入（见 parse 的 readTree），所以这里的顺序遍历是安全的。 */
    nodes.forEach(nd => { nd.bdepth = (nd.parent === null ? 0 : nodes[nd.parent].bdepth) + nd.sib; });

    const n = nodes.length, k = rootIds.length;
    const root = rootIds[0];
    const leafIds = nodes.filter(nd => !nd.kids.length).map(nd => nd.id);
    const noLeft = nodes.filter(nd => nd.first === null).map(nd => nd.id);
    const noRight = nodes.filter(nd => nd.next === null).map(nd => nd.id);
    const branch = n - leafIds.length;
    /* I8：各棵树的转换高度 h_i = （该树结点在整棵 T 里的最大层号）− (i−1)
       —— 减去偏移是因为第 i 棵树的根在整棵 T 里从第 i 层开始，单看这棵树时应从第 1 层算起 */
    const treeH = rootIds.map((rid, i) => {
      let h = 1;
      nodes.forEach(nd => { if (nd.tree === i + 1) h = Math.max(h, nd.bdepth - i); });
      return h;
    });
    const binH = Math.max.apply(null, nodes.map(nd => nd.bdepth));
    /* I9：h_i 降序排列后的最小高度（2026-4 就是这么算的） */
    const sortedDesc = treeH.slice().sort((a, b) => b - a);
    const minH = Math.max.apply(null, sortedDesc.map((h, i) => h + i));
    const model = {
      src: src, nodes: nodes, forest: rootIds.map(id => ({ id: id })), root: root, n: n, k: k,
      leafIds: leafIds, noLeft: noLeft, noRight: noRight, branch: branch,
      treeH: treeH, binH: binH, minH: minH, rootChain: 0,
      seqPre: [], seqIn: [], seqForestPre: [], seqForestPost: [],
      mode: ['t2b', 'b2t', 'pre', 'post'].indexOf(vals.mode) >= 0 ? vals.mode : 't2b',
    };
    model.rootChain = _tfRightChain(model, root);
    model.seqPre = _tfBinSeq(model, 'pre');
    model.seqIn = _tfBinSeq(model, 'in');
    model.seqForestPre = _tfForestSeq(model, 'pre');
    model.seqForestPost = _tfForestSeq(model, 'post');
    return model;
  },

  /* ---------------- ② 纯算法：逐帧快照 ---------------- */
  buildSnapshots(model) {
    const nodes = model.nodes, n = model.n, k = model.k, root = model.root, mode = model.mode;
    const name = id => nodes[id].label;
    const seqText = ids => ids.map(name).join(' → ');
    const order = _tfPreOrder(model);
    const ALL = [];
    order.forEach(id => {
      const nd = nodes[id];
      if (nd.first !== null) ALL.push({ a: id, b: nd.first, k: 'L' });
      if (nd.next !== null) ALL.push({ a: id, b: nd.next, k: 'R' });
    });
    const snaps = [];

    if (mode === 't2b' || mode === 'b2t') {
      const isT2B = mode === 't2b';
      snaps.push({
        type: 'init', cur: null, doneIds: [], edges: [], path: [], out: [],
        desc: isT2B
          ? '森林共 ' + k + ' 棵树、' + n + ' 个结点：左边是原树形，右边是要长出来的二叉树'
          : '二叉树 T 共 ' + n + ' 个结点：逐个结点读它的左 / 右指针，把树与森林还原回左边',
        log: '就绪：' + k + ' 棵树 / ' + n + ' 个结点，按' + (isT2B ? '森林的先根次序' : 'T 的先序次序') + '逐结点处理',
        logType: 'info',
      });
      const edges = [], done = [];
      order.forEach(id => {
        const nd = nodes[id];
        const parts = [];
        if (nd.first !== null) {
          edges.push({ a: id, b: nd.first, k: 'L' });
          parts.push(isT2B ? '第一个孩子 ' + name(nd.first) + ' 接到左指针' : '左孩子 ' + name(nd.first) + ' ⟹ 是第一个孩子');
        } else {
          parts.push(isT2B ? '没有孩子，左指针为空' : '左指针为空 ⟹ 它是叶结点');
        }
        if (nd.next !== null) {
          edges.push({ a: id, b: nd.next, k: 'R' });
          parts.push(isT2B ? '下一个兄弟 ' + name(nd.next) + ' 接到右指针' : '右孩子 ' + name(nd.next) + ' ⟹ 是下一个兄弟');
        } else {
          parts.push(isT2B
            ? (nd.parent === null ? '它是最后一棵树的根，右指针为空' : '没有下一个兄弟，右指针为空')
            : (nd.parent === null ? '右指针为空 ⟹ 它是最右一棵树的根' : '右指针为空 ⟹ 它是父结点的最右孩子'));
        }
        done.push(id);
        snaps.push({
          type: 'link', cur: id, doneIds: done.slice(), edges: edges.map(e => ({ a: e.a, b: e.b, k: e.k })),
          path: [], out: [],
          desc: (isT2B ? '接 ' : '读 ') + name(id) + '：' + parts.join('；'),
          log: (isT2B ? '接指针 ' : '还原 ') + name(id) + ' —— ' + parts.join('，'),
          logType: 'info',
        });
      });
      snaps.push({
        type: 'done', cur: null, doneIds: done.slice(), edges: edges.map(e => ({ a: e.a, b: e.b, k: e.k })),
        path: [], out: [],
        desc: '转换完成：' + n + ' 个结点、' + k + ' 棵树；二叉树共 ' + edges.length +
          ' 条边（左链 ' + model.branch + ' 条 = 分支结点数，右链 ' + (edges.length - model.branch) + ' 条）',
        log: '完成：森林与二叉树互转。T 的根 ' + name(root) + ' 右链长 ' + model.rootChain + ' = 树的棵数 ' + k +
          '；叶结点 ' + model.leafIds.length + ' 个 = T 中左孩子为空的结点数；T 的高度 ' + model.binH +
          '（各棵树转换高度 ' + model.treeH.join('/') + '，最小高度 ' + model.minH + '）',
        logType: 'success',
      });
      return snaps;
    }

    /* ---- 遍历对应：先根 ≡ 先序 / 后根 ≡ 中序 ---- */
    const isPre = mode === 'pre';
    const kind = isPre ? 'pre' : 'post';
    const forestName = isPre ? '先根遍历' : '后根遍历';
    const binName = isPre ? '先序遍历' : '中序遍历';
    const copyAll = () => ALL.map(e => ({ a: e.a, b: e.b, k: e.k }));
    snaps.push({
      type: 'init', cur: null, doneIds: [], edges: copyAll(), path: [], out: [],
      desc: '在森林上做' + forestName + '，同时在二叉树 T 上做' + binName + '——两边访问结点的次序完全一样',
      log: '就绪：' + k + ' 棵树 / ' + n + ' 个结点，逐结点对照' + forestName + '与' + binName,
      logType: 'info',
    });
    const out = [];
    _tfForestSeq(model, kind).forEach((id, i) => {
      out.push(id);
      snaps.push({
        type: 'visit', cur: id, doneIds: out.slice(), edges: copyAll(), path: _tfPath(model, id), out: out.slice(),
        desc: '第 ' + (i + 1) + ' 个访问 ' + name(id) + '：它既是森林' + forestName + '的第 ' + (i + 1) +
          ' 个，也是 T ' + binName + '的第 ' + (i + 1) + ' 个',
        log: '访问 ' + name(id) + '（' + forestName + '第 ' + (i + 1) + ' 个 ≡ ' + binName + '第 ' + (i + 1) + ' 个）',
        logType: 'success',
      });
    });
    snaps.push({
      type: 'done', cur: null, doneIds: out.slice(), edges: copyAll(), path: [], out: out.slice(),
      desc: '两边序列完全相同：森林' + forestName + ' = 二叉树' + binName + ' = ' + seqText(out),
      log: '完成：森林' + forestName + '序列与 T ' + binName + '序列逐项相等（共 ' + out.length + ' 个结点）',
      logType: 'success',
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const s = ctx.snap, model = ctx.model, stage = ctx.stage;
    const nodes = model.nodes, n = model.n, k = model.k, root = model.root, mode = model.mode;
    const isOrder = (mode === 'pre' || mode === 'post');
    const isB2T = (mode === 'b2t');
    const rad = _tfRad(n), step = _tfStep(n);

    /* ---- 森林面板 ---- */
    const FL = _tfForestLayout(model);
    const FW = Math.round(_tfPad * 2 + rad * 2 + (FL.span - 1) * step);
    const FH = Math.round(_tfPad * 2 + rad * 2 + (FL.maxD - 1) * _tfROW);
    const fAt = id => ({ x: _tfPad + rad + nodes[id]._lx * step, y: _tfPad + rad + (nodes[id].depth - 1) * _tfROW });
    /* ---- 二叉树面板 ---- */
    const BL = _tfBinLayout(model);
    const BW = Math.round(_tfPad * 2 + rad * 2 + (BL.cols - 1) * step);
    const BH = Math.round(_tfPad * 2 + rad * 2 + (BL.maxD - 1) * _tfROW);
    const bAt = id => ({ x: _tfPad + rad + nodes[id]._bx * step, y: _tfPad + rad + (nodes[id]._by - 1) * _tfROW });

    const builtL = {}, builtR = {}, builtAll = {}, doneSet = {}, outNo = {};
    s.edges.forEach(e => { builtAll[e.a] = 1; if (e.k === 'L') builtL[e.a] = 1; else builtR[e.a] = 1; });
    s.doneIds.forEach(id => { doneSet[id] = 1; });
    s.out.forEach((id, i) => { outNo[id] = i + 1; });

    /* --- 原森林：父子边 + 结点 --- */
    let fEdges = '', fNodes = '';
    nodes.forEach(nd => {
      const a = fAt(nd.id);
      nd.kids.forEach(cid => {
        const hot = (s.cur === nd.id || s.cur === cid);
        fEdges += _tfLine(a, fAt(cid), hot ? '#f59e0b' : '#cbd5e1', hot ? 3.4 : 2.2, null, 'tf-eF', 1);
      });
    });
    nodes.forEach(nd => {
      const p = fAt(nd.id), isCur = (s.cur === nd.id), hit = outNo[nd.id] !== undefined;
      let fill = '#e2e8f0', txt = '#475569';
      if (isOrder) { if (hit) { fill = '#10b981'; txt = '#fff'; } }
      else if (doneSet[nd.id]) { fill = '#c7d2fe'; txt = '#3730a3'; }
      if (isCur) { fill = '#f59e0b'; txt = '#fff'; }
      fNodes += (isCur ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (rad + 6) +
        '" class="knode-halo" style="stroke:#f59e0b"/>' : '') +
        _tfDot(p.x, p.y, rad, nd.id, nd.label, fill, txt, 'tf-na', hit ? String(outNo[nd.id]) : '');
    });

    /* --- 二叉树：左链（靛蓝实线）/ 右链（琥珀虚线）；未接上的画成浅灰虚线预览 --- */
    let bEdges = '', bNodes = '';
    nodes.forEach(nd => {
      const a = bAt(nd.id);
      if (nd.first !== null) {
        const ok = !!builtL[nd.id], hot = (s.cur === nd.id) && ok;
        bEdges += _tfLine(a, bAt(nd.first), hot ? '#4f46e5' : (ok ? '#6366f1' : '#e2e8f0'),
          hot ? 4.6 : (ok ? 3 : 1.6), ok ? null : '3 5', 'tf-eL', ok ? 1 : 0.85);
      }
      if (nd.next !== null) {
        const ok = !!builtR[nd.id], hot = (s.cur === nd.id) && ok;
        bEdges += _tfLine(a, bAt(nd.next), hot ? '#d97706' : (ok ? '#f59e0b' : '#e2e8f0'),
          hot ? 4.6 : (ok ? 3 : 1.6), '7 5', 'tf-eR', ok ? 1 : 0.85);
      }
    });
    nodes.forEach(nd => {
      const p = bAt(nd.id), isCur = (s.cur === nd.id), hit = outNo[nd.id] !== undefined;
      let fill = '#e2e8f0', txt = '#475569';
      if (isOrder) { if (hit) { fill = '#10b981'; txt = '#fff'; } }
      else if (builtAll[nd.id]) { fill = '#ddd6fe'; txt = '#4c1d95'; }
      else if (isB2T) { fill = '#f1f5f9'; }
      if (isCur) { fill = '#4f46e5'; txt = '#fff'; }
      bNodes += (isCur ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (rad + 6) +
        '" class="knode-halo" style="stroke:#4f46e5"/>' : '') +
        _tfDot(p.x, p.y, rad, nd.id, nd.label, fill, txt, 'tf-nb', hit ? String(outNo[nd.id]) : '');
    });

    /* --- 统计卡（每个数字都挂 data-v，供冒烟与 harness 逐帧核对，§3.8-6） --- */
    const statCard = (key, label, value, sub, cls) =>
      '<div class="tf-stat" data-k="' + key + '" data-v="' + value + '">' +
      RC408.ui.statCard(label, value, sub, cls || 'text-slate-800') + '</div>';
    let stats = statCard('trees', '森林里树的棵数', String(k), '= T 的根右链长度 ' + model.rootChain, 'text-indigo-600') +
      statCard('nodes', '结点总数', String(n), '父子边 ' + (n - k) + ' 条 → T 的 ' + (n - 1) + ' 条边');
    if (isOrder) {
      stats += statCard('visit', '已访问结点', s.out.length + ' / ' + n,
        isOrder && mode === 'pre' ? '先根 ≡ 先序' : '后根 ≡ 中序', 'text-emerald-600') +
        statCard('height', 'T 的高度', String(model.binH), '各棵树转换高度 ' + model.treeH.join('/'), 'text-indigo-600');
    } else {
      stats += statCard('leaf', '叶结点数 / 左孩子为空', model.leafIds.length + ' / ' + model.noLeft.length,
        'F 的叶结点 ↔ T 中左孩子为空（2014-5）', 'text-emerald-600') +
        statCard('height', 'T 的高度', String(model.binH),
          '各棵树转换高度 ' + model.treeH.join('/') + '，最小高度 ' + model.minH, 'text-indigo-600');
    }

    /* --- 当前帧解说 --- */
    const chip = (id, cls) => RC408.ui.chip(_tfEsc(nodes[id].label), cls || '');
    let panel = '';
    if (!isOrder) {
      const cur = s.cur;
      let body;
      if (cur === null) {
        body = '<div style="font-size:13px;color:#475569">' + _tfEsc(s.desc) + '</div>';
      } else {
        const nd = nodes[cur];
        const oneLine = (tag, color, child, kindName) =>
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">' +
          '<span style="font-weight:700;color:' + color + ';min-width:150px">' + tag + '</span>' +
          (child === null
            ? '<span style="color:#94a3b8">没有' + kindName + ' ⟹ 这个指针为空</span>'
            : '<span style="color:#94a3b8">' + kindName + '</span>' + chip(child, 'chip-check') +
            '<span style="color:#94a3b8">⟹ 接到' + tag.slice(0, 1) + '指针</span>') +
          '</div>';
        body = oneLine('左指针 ← 第一个孩子', '#4f46e5', nd.first, '第一个孩子') +
          oneLine('右指针 → 下一个兄弟', '#d97706', nd.next, '下一个兄弟') +
          '<div style="margin-top:8px;font-size:12px;color:#64748b">结点 ' + _tfEsc(nd.label) +
          '：原森林第 ' + nd.tree + ' 棵树、第 ' + nd.depth + ' 层、兄弟序号 ' + nd.sib +
          ' ⟹ 在 T 里是第 ' + nd.bdepth + ' 层</div>';
      }
      panel = '<div class="tf-cur" style="border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px;background:#f8fafc">' +
        '<div style="font-size:12px;font-weight:800;color:#94a3b8;letter-spacing:.08em;margin-bottom:8px">' +
        (cur === null ? '当前帧：' + (s.type === 'done' ? '转换完成' : '就绪')
          : '当前结点：' + _tfEsc(nodes[cur].label) + '（已处理 ' + s.doneIds.length + ' / ' + n + ' 个）') +
        '</div>' + body + '</div>';
    } else {
      const cur = s.cur;
      const pathHtml = cur === null ? '' :
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;margin-bottom:6px">' +
        '<span style="font-weight:700;color:#0f766e">所在树的根到它的路径</span>' +
        s.path.map((id, i) => (i ? '<span style="color:#cbd5e1">→</span>' : '') +
          chip(id, id === cur ? 'chip-check' : '')).join('') + '</div>';
      panel = '<div class="tf-cur" style="border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px;background:#f8fafc">' +
        '<div style="font-size:12px;font-weight:800;color:#94a3b8;letter-spacing:.08em;margin-bottom:8px">' +
        (cur === null ? '当前帧：' + (s.type === 'done' ? '遍历完成' : '就绪')
          : '当前访问：' + _tfEsc(nodes[cur].label) + '（第 ' + s.out.length + ' / ' + n + ' 个）') +
        '</div>' + pathHtml +
        '<div style="font-size:13px;color:#475569">' + _tfEsc(s.desc) + '</div></div>';
    }

    /* --- 序列卡：森林侧 ↔ 二叉树侧，恒等关系一眼可见 --- */
    const chipRow = ids => ids.map(id => chip(id, (isOrder && outNo[id] !== undefined) ? 'chip-mst' : ''))
      .join('<span style="color:#cbd5e1">→</span>');
    const seqCard = (title, ids) =>
      '<div class="tf-seq" data-t="' + title + '" data-seq="' + ids.map(id => nodes[id].label).join(',') + '"' +
      ' style="border:1px solid #e2e8f0;border-radius:14px;padding:9px 12px;background:#fff">' +
      '<div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">' + title + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
      (ids.length ? chipRow(ids) : '<span style="font-size:12px;color:#cbd5e1">（空）</span>') + '</div></div>';
    const seqs = isOrder
      ? seqCard('森林的' + (mode === 'pre' ? '先根遍历' : '后根遍历') + '（= 二叉树' + (mode === 'pre' ? '先序' : '中序') + '遍历）', s.out)
      : seqCard('T 的先序序列 = 森林的先根遍历', model.seqPre) +
      seqCard('T 的中序序列 = 森林的中序遍历（各棵树的后根遍历）', model.seqIn);

    /* --- 末帧结论卡：转换三件套对账 --- */
    let concl = '';
    if (s.type === 'done' && !isOrder) {
      concl = '<div style="border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px;background:#f8fafc;' +
        'font-size:13px;color:#334155;line-height:1.95">' +
        '<div style="font-size:12px;font-weight:800;color:#94a3b8;letter-spacing:.08em;margin-bottom:6px">转换后的三件套对账</div>' +
        '<div>① 结点集合不变：转换前后都是 <b>' + n + '</b> 个结点；原森林 ' + (n - k) + ' 条父子边，二叉树 T 共 <b>' +
        (n - 1) + '</b> 条边 = 左链 ' + model.branch + ' 条（= 分支结点数 ' + model.branch +
        '，一个分支结点只贡献一条左链）+ 右链 ' + (n - 1 - model.branch) + ' 条。</div>' +
        '<div>② 树的棵数 = T 的根右链长度：<b>' + model.rootChain + '</b> ⟹ ' +
        (k === 1 ? '森林只有一棵树，T 的根没有右孩子' : 'T 的根有右孩子，说明它是森林') + '。</div>' +
        '<div>③ 叶结点数 = T 中左孩子为空的结点数：<b>' + model.leafIds.length + '</b>（' + model.noLeft.length +
        ' 个）；无右孩子的结点数 <b>' + model.noRight.length + '</b> = 分支结点数 ' + model.branch + ' + 1（2011-6 的口径）。</div>' +
        '<div>④ T 的高度 = <b>' + model.binH + '</b>（各棵树转换高度 <b>' + model.treeH.join('/') +
        '</b>，按当前次序接右链）；次序任意时把 h 大的树排在前面，最小高度 = <b>' + model.minH +
        '</b>（2026-4 就是按这一步算的）。</div></div>';
    }

    const cap = txt => '<div style="font-size:12px;font-weight:800;color:#64748b;letter-spacing:.06em;margin-bottom:4px">' + txt + '</div>';
    const frameBox = inner => '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:14px;' +
      'background:linear-gradient(#f8fafc,#fff);padding:4px">' + inner + '</div>';

    stage.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px">' + stats + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start">' +
      '<div style="flex:1 1 340px;min-width:0">' + cap('原森林（普通树形：父子连线）') +
      frameBox('<svg viewBox="0 0 ' + FW + ' ' + FH + '" style="width:' + FW + 'px;max-width:100%;height:auto;display:block;margin:0 auto">' +
        fEdges + fNodes + '</svg>') + '</div>' +
      '<div style="flex:1 1 340px;min-width:0">' + cap('对应二叉树 T（实线 = 左链 · 第一个孩子／虚线 = 右链 · 下一个兄弟）') +
      frameBox('<svg viewBox="0 0 ' + BW + ' ' + BH + '" style="width:' + BW + 'px;max-width:100%;height:auto;display:block;margin:0 auto">' +
        bEdges + bNodes + '</svg>') + '</div>' +
      '</div>' +
      panel +
      '<div style="display:' + (isOrder ? 'block' : 'grid') + ';' +
      (isOrder ? '' : 'grid-template-columns:repeat(auto-fit,minmax(280px,1fr));') + 'gap:10px">' + seqs + '</div>' +
      concl +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:10px">' +
      RC408.ui.legend('#6366f1', '左孩子边 = 原第一个孩子（实线）') +
      RC408.ui.legend('#f59e0b', '右孩子边 = 原下一个兄弟（虚线）') +
      RC408.ui.legend('#e2e8f0', '浅灰虚线 = 尚未接上的指针') +
      RC408.ui.legend('#10b981', '遍历模式：已访问（右上角为访问序号）') +
      RC408.ui.legend('#4f46e5', '当前处理的结点（光环）') +
      '</div></div>';
  },
});
