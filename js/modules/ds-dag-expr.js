'use strict';
/* ============================================================================
 * ds-dag-expr.js —— 【数据结构】用有向无环图描述表达式（共享子表达式） 前缀 _dx
 * ----------------------------------------------------------------------------
 * 为什么单开一条（窗50 用户拍板）：`2019-6`「用有向无环图描述表达式 (x+y)*((x+y)/x)，需要的顶点
 *   个数至少是」在窗37 被**临时**归给 `ds-topo`（脚本原文写着"建议，待复核"），窗42 沿用未复核；
 *   但教材里「有向无环图描述表达式」与「拓扑排序」「关键路径」是**图的应用下并列的三个小节**，
 *   考点不同（这一条考"共享子表达式 → 最少顶点数"，不考 ve/vl、也不考入度消减）。
 *   ⟹ 新开条目，`2019-6` 改挂过来（`ds-topo` 13 年/选 12 → 13 年/选 11，2019 那年仍有 2019-5）。
 *
 * ★ 数据模型
 *   parse 的产物 = { expr, src, root, nodes, letters }
 *     · `nodes` = 表达式树的**逐出现位置**结点：{ id, op, name, left, right, depth }（重复子表达式各占一个结点）
 *     · 结点 id 按**后序**编号（1 起），便于"逐结点认领"时按序讲
 *
 * ★ 不变量（tmp_t50_smoke.js 逐条断言）
 *   ① **最少顶点数 = 不同子表达式的个数**（把每个结点按 (运算符, 左, 右) 或 (操作数名) 去重后的唯一结点数）；
 *      **操作数也共享** —— 同一个 x 出现三次仍只算一个顶点；
 *   ② 唯一化**不改变求值结果**：对同一组操作数取值，原表达式树与合并后的 DAG 求值必须逐位相等
 *      （最强的"语义不变"判据，用随机取值验）；
 *   ③ DAG 顶点数 ≤ 树结点数；每个唯一结点的出现次数之和 = 树结点数；
 *   ④ 括号只影响**树的形状写法**、不改变结构 ⟹ 多余括号不改变最少顶点数；
 *   ⑤ 锚点：`(x+y)*((x+y)/x)` → **5**（2019-6 官方答案 A）；
 *      `(a+b)*(a+b)` → 4（a、b、+、*）；`x*x*x` → 3（x、x*x、(x*x)*x —— **共享的不是内层 *，而是 x**）；
 *      `(a+b)*(b+c)` → 6（a、b、c、+(a,b)、+(b,c)、*）；`(x+y)*(y+x)` → **仍 5**
 *      （不认交换律 ⟹ +(x,y) 与 +(y,x) 是两个顶点，但总数还是 x、y、+、+、× 五个）。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-dag-expr',
  mode: 'stepper',
  title: '有向无环图描述表达式（共享子表达式）',

  theory: `
> **为什么要有它**：同一个子表达式在式子里出现多次时，**照样画两遍表达式树就是浪费**——用**有向无环图（DAG）**描述表达式，把相同的子表达式**合并成一个顶点**（多条入边指向同一个顶点），顶点数就是这个表达式"最省"的表示规模。2019-6 问的"需要的顶点个数至少是"就是这个数。
> **怎么实现**：先按运算优先级把表达式建成**表达式树**；再**后序**逐结点"认领"——叶子按操作数名、内部结点按 (运算符, 左子结点, 右子结点) 做键，键已存在就**共享**已有顶点，否则新建一个顶点。
> **记住什么**：**最少顶点数 = 不同子表达式的个数**（不只合并运算符结点，**相同的操作数也只留一个**）+ DAG 里一个顶点可以有多条入边 + 合并**不改变求值结果**。

## 从表达式树到 DAG（后序唯一化）

1. 先建**表达式树**：按优先级（乘除高于加减）与括号递归下降解析；同一个子表达式出现两次就有两棵相同的子树；
2. **后序**遍历每个结点，按下表取"键"：
   - 叶子（操作数）：键 = 操作数本身（\\(x\\) 出现三次仍是同一个键）；
   - 内部结点：键 = (运算符, 左子结点的**顶点号**, 右子结点的**顶点号**)；
3. 键**已存在** ⟹ 这个结点**共享**已有顶点（不新增）；键**不存在** ⟹ 新建一个顶点；
4. 遍历完，**顶点数 = 不同键的个数 = 最少顶点数**。
- 举例 \\((x+y)\\times((x+y)/x)\\)：键依次为 \\(x\\)、\\(y\\)、\\(+(x,y)\\)、\\(x\\)（重复）、\\(/(+(x,y),x)\\)、\\(\\times(+(x,y),/(...))\\) ⟹ 不同键 **5 个** ⟹ **最少顶点数 = 5**（2019-6 答案 A）。

## 考点提醒（易错点）

1. **操作数要合并**：只合并"运算符结点"、把每个 \\(x\\) 各画一个顶点，是这类题最典型的错法（\\((x+y)\\times((x+y)/x)\\) 会数成 8）；
2. **同一个子表达式必须"逐级相同"**：\\(x+y\\) 与 \\(y+x\\) 不是同一个键（DAG 不认交换律），题目给什么就算什么；
3. **括号不改变结构**：\\(a+b+c\\) 与 \\((a+b)+c\\) 都是 \\(+((a+b),c)\\)；多加括号不会让顶点数变化（但 \\(a+(b+c)\\) 是另一个结构）；
4. **DAG 与树的区别就在"入边条数"**：树里每个非根结点恰一条入边，DAG 里可以多条 —— 共享正是靠这一点实现的；
5. 这类题**只问顶点个数**，不问边数；但要知道边数也随之减少（相同子表达式的两条入边并成一条"汇聚"）。

## 与本章其他模块的分工

| 模块 | 解决什么 | 与本题的关系 |
| --- | --- | --- |
| 表达式求值（中缀 → 后缀） | **栈的应用**：转后缀、求值 | 也要先理解表达式结构，但那是"顺序求值"，不涉及共享 |
| 二叉树的遍历 | 先/中/后/层序 | 本模块的"后序逐结点认领"就是后序遍历的应用 |
| **本模块（DAG 描述表达式）** | **表达式的 DAG 表示与最少顶点数** | 直接对应 2019-6 |
| 拓扑排序 / 关键路径 | DAG 的**次序**与最长路 | 同样建立在 DAG 上，但考的是入度消减与 ve/vl，不是共享 |

> **真题考情**：**1/18 年（选 1、无大题）**：2019-6（用有向无环图描述表达式 \\((x+y)\\times((x+y)/x)\\)，最少顶点数 = **5**，答案 A）。
> ⚠ 教材里它与"拓扑排序""关键路径"并列属**图的应用**，但考点是"共享子表达式 → 最少顶点数"，与 ve/vl 无关。
`,

  inputs: [
    { key: 'expr', label: '表达式（操作数为单个字母；支持 + - * / 与括号）', type: 'text', wide: true,
      default: '(x+y)*((x+y)/x)' },
  ],

  quickActions: [
    { label: '★ 2019-6 真题：(x+y)*((x+y)/x) → 5 个顶点', run(rt) { rt.setInput('expr', '(x+y)*((x+y)/x)'); rt.load(); } },
    { label: '📘 最简共享：(a+b)*(a+b) → 4 个顶点', run(rt) { rt.setInput('expr', '(a+b)*(a+b)'); rt.load(); } },
    { label: '📘 操作数也要合并：x*x*x → 3 个顶点（x、x*x、(x*x)*x）', run(rt) { rt.setInput('expr', 'x*x*x'); rt.load(); } },
    { label: '⚠ 易错例：(x+y)*(y+x) → 不认交换律，但总数仍是 5', run(rt) { rt.setInput('expr', '(x+y)*(y+x)'); rt.load(); } },
    { label: '📘 三个操作数：(a+b)*(b+c) → 6 个顶点', run(rt) { rt.setInput('expr', '(a+b)*(b+c)'); rt.load(); } },
  ],

  parse(vals) {
    const src = String(vals.expr || '').trim();
    if (!src) throw { message: '表达式不能为空' };
    if (/[^A-Za-z0-9+\-*/()\s]/.test(src)) throw { message: '只支持 字母 / 数字 / + - * / 与括号（发现非法字符）' };
    const s = src.replace(/\s+/g, '');
    let i = 0;
    const peek = () => s[i];
    const eat = (ch) => { if (s[i] === ch) { i++; return true; } return false; };
    let nextId = 0;
    const nodes = [];
    /* 每个结点给一个**唯一**的 id（= 创建次序，仅作调试标识）；跨帧的身份一律用后序的 `seq` */
    const mk = (op, name, left, right) => {
      const n = { id: nodes.length, op: op, name: name, left: left || null, right: right || null };
      nodes.push(n);
      return n;
    };
    /* 递归下降：expr → term (('+'|'-') term)* ; term → factor (('*'|'/') factor)* ; factor → 字母/数字 | '(' expr ')' */
    function parseExpr() {
      let left = parseTerm();
      for (;;) {
        if (eat('+')) { const r = parseTerm(); left = mk('+', null, left, r); }
        else if (eat('-')) { const r = parseTerm(); left = mk('-', null, left, r); }
        else return left;
      }
    }
    function parseTerm() {
      let left = parseFactor();
      for (;;) {
        if (eat('*')) { const r = parseFactor(); left = mk('*', null, left, r); }
        else if (eat('/')) { const r = parseFactor(); left = mk('/', null, left, r); }
        else return left;
      }
    }
    function parseFactor() {
      if (eat('(')) {
        const inner = parseExpr();
        if (!eat(')')) throw { message: '括号不配对：缺少右括号' };
        return inner;
      }
      const ch = peek();
      if (ch && /[A-Za-z0-9]/.test(ch)) {
        i++;
        /* 连续的数字按一个操作数读（如 12），字母只取单个（408 的表达式题都是单字母） */
        let name = ch;
        if (/[0-9]/.test(ch)) { while (i < s.length && /[0-9]/.test(s[i])) { name += s[i]; i++; } }
        return mk(null, name, null, null);
      }
      throw { message: '表达式在第 ' + (i + 1) + ' 个字符处看不懂（应为操作数或左括号）' };
    }
    const root = parseExpr();
    if (i < s.length) throw { message: '表达式在第 ' + (i + 1) + ' 个字符处多出内容（' + s.slice(i) + '）' };
    if (nodes.length > 15) throw { message: '结点数 ' + nodes.length + ' 太多（限 15 个以内，图才画得清）' };
    const letters = [...new Set(nodes.filter(n => !n.op).map(n => n.name))].sort();
    if (letters.length > 6) throw { message: '不同操作数 ' + letters.length + ' 个太多（限 6 个以内）' };
    if (!letters.length) throw { message: '表达式里没有操作数' };
    /* 后序编号：讲"逐结点认领"时按这个次序 */
    let seq = 0;
    (function post(n) { if (!n) return; post(n.left); post(n.right); n.seq = ++seq; n.depth = depthOf(n); })(root);
    function depthOf(n) { return n.op ? 1 + Math.max(depthOf(n.left), depthOf(n.right)) : 0; }
    return { expr: s, src: src, root: root, nodes: nodes, letters: letters, size: nodes.length };
  },

  buildSnapshots(model) {
    const { root, nodes, expr, size } = model;
    const snaps = [];
    const clone = o => JSON.parse(JSON.stringify(o));
    /* 唯一结点表：key → { uid, label, op, left, right, count } */
    const table = new Map();
    const uidOf = new Map();          /* 树结点 id → 顶点号（认领后写入；用 seq 作树结点标识） */
    const order = [];                 /* 顶点按创建次序 */
    const fmtNode = n => n.op ? '(' + (n.left.op ? '…' : n.left.name) + n.op + (n.right.op ? '…' : n.right.name) + ')' : n.name;
    const tableList = () => order.map(u => ({ uid: u.uid, label: u.label, op: u.op, left: u.left, right: u.right, count: u.count }));

    snaps.push({ step: 'init', seq: 0, table: [], order: [], treeState: {}, cur: null, action: null,
      expr: expr, model: { nodes: clone(nodes), root: clone(root), letters: model.letters },
      log: '就绪：先把表达式建成二叉表达式树（共 ' + size + ' 个结点，重复的子表达式各占一个结点）。接下来**后序**逐结点认领。',
      logType: 'info', desc: '点击「单步执行」：每帧认领一个结点 —— 键没见过就新建顶点，见过就共享' });

    /* 后序逐结点认领 */
    const walk = [];
    (function post(n) { if (!n) return; post(n.left); post(n.right); walk.push(n); })(root);
    walk.forEach((n, k) => {
      const leftUid = n.left ? uidOf.get(n.left.seq) : null;
      const rightUid = n.right ? uidOf.get(n.right.seq) : null;
      const key = n.op ? ('N|' + n.op + '|' + leftUid + '|' + rightUid) : ('L|' + n.name);
      let act;
      if (table.has(key)) {
        const u = table.get(key);
        u.count++;
        uidOf.set(n.seq, u.uid);
        act = { kind: 'share', seq: n.seq, uid: u.uid, key: key,
          label: n.op ? (n.op + '(#' + leftUid + ',#' + rightUid + ')') : n.name };
      } else {
        const u = { uid: order.length + 1, label: n.op ? (n.op + '(#' + leftUid + ',#' + rightUid + ')') : n.name,
          op: n.op, left: leftUid, right: rightUid, count: 1, name: n.name };
        table.set(key, u);
        order.push(u);
        uidOf.set(n.seq, u.uid);
        act = { kind: 'create', seq: n.seq, uid: u.uid, key: key, label: u.label };
      }
      const treeState = {};
      nodes.forEach(x => { if (uidOf.has(x.seq)) treeState[x.seq] = uidOf.get(x.seq); });
      snaps.push({ step: act.kind, seq: n.seq, cur: n.seq, action: act, table: clone(tableList()), order: clone(order),
        treeState: treeState, expr: expr, model: { nodes: clone(nodes), root: clone(root), letters: model.letters },
        log: '第 ' + (k + 1) + '/' + walk.length + ' 个结点：' + (n.op ? ('运算符 ' + n.op) : ('操作数 ' + n.name)) +
          '『' + (n.op ? ('#' + leftUid + ' ' + n.op + ' #' + rightUid) : n.name) + '』⟹ ' +
          (act.kind === 'create' ? ('键没见过，新建顶点 #' + act.uid) : ('键已存在，共享已有顶点 #' + act.uid)),
        logType: act.kind === 'create' ? 'success' : 'warn',
        desc: (act.kind === 'create' ? '新建顶点 #' + act.uid : '共享顶点 #' + act.uid + '（相同子表达式只留一个）') });
    });

    const total = order.length;
    snaps.push({ step: 'done', seq: 0, cur: null, action: null, table: clone(tableList()), order: clone(order),
      treeState: (function () { const o = {}; nodes.forEach(x => { o[x.seq] = uidOf.get(x.seq); }); return o; })(),
      expr: expr, size: size, total: total,
      model: { nodes: clone(nodes), root: clone(root), letters: model.letters },
      log: '完成！表达式树 ' + size + ' 个结点 ⟹ 合并后 ' + total + ' 个顶点（= 不同子表达式的个数）= 最少顶点数。' +
        (size === total ? '本例没有重复子表达式，所以没有减少。' : '共省下 ' + (size - total) + ' 个顶点。'),
      logType: 'success', desc: '最少顶点数 = ' + total + '（原表达式树 ' + size + ' 个结点）' });
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    const m = s.model;
    const nodes = m.nodes || [];
    const treeState = s.treeState || {};
    const isOp = n => !!n.op;

    /* ---- 表达式树布局：**后序**递归（左右子树都摆好再摆自己），x = 中序叶序位，y = 层次 ---- */
    let leafX = 0;
    const pos = {};
    const maxDepth = (function d(n) { return n && n.op ? 1 + Math.max(d(n.left), d(n.right)) : 0; })(m.root);
    const yOf = n => 34 + (maxDepth - (function d(x) { return x && x.op ? 1 + Math.max(d(x.left), d(x.right)) : 0; })(n)) * 62;
    (function layout(n) {
      if (!n) return;
      layout(n.left);
      layout(n.right);
      if (!n.op) { pos[n.seq] = { x: 40 + leafX * 72, y: yOf(n) }; leafX++; }
      else {
        const l = pos[n.left.seq], r = pos[n.right.seq] || l;
        pos[n.seq] = { x: (l.x + r.x) / 2, y: yOf(n) };
      }
    })(m.root);
    const treeEdges = [], treeNodes = [];
    nodes.forEach(n => {
      const p = pos[n.seq];
      if (!p) return;
      const uid = treeState[n.seq];
      const isCur = s.cur === n.seq;
      const seen = uid !== undefined;
      const color = isCur ? '#f59e0b' : (seen ? '#10b981' : '#cbd5e1');
      const fill = isCur ? '#fef3c7' : (seen ? '#dcfce7' : '#f8fafc');
      if (n.left) treeEdges.push('<line x1="' + p.x + '" y1="' + (p.y + 17) + '" x2="' + pos[n.left.seq].x + '" y2="' + (pos[n.left.seq].y - 17) + '" stroke="' + color + '" stroke-width="2"/>');
      if (n.right) treeEdges.push('<line x1="' + p.x + '" y1="' + (p.y + 17) + '" x2="' + pos[n.right.seq].x + '" y2="' + (pos[n.right.seq].y - 17) + '" stroke="' + color + '" stroke-width="2"/>');
      treeNodes.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="17" fill="' + fill + '" stroke="' + color + '" stroke-width="2"/>' +
        '<text x="' + p.x + '" y="' + p.y + '" dy="0.35em" text-anchor="middle" style="font:800 14px Consolas;fill:#334155">' + (n.op || n.name) + '</text>' +
        (seen ? '<text x="' + p.x + '" y="' + (p.y - 22) + '" text-anchor="middle" style="font:700 10px Consolas;fill:#059669">#' + uid + '</text>' : ''));
    });
    const treeW = Math.max(320, 80 + leafX * 72);
    const treeH = 60 + maxDepth * 62 + 30;

    /* ---- 合并后的 DAG 布局：按"高度"分层，层内按创建次序铺开 ---- */
    const dagNodes = s.order || [];
    const heightOf = (uid) => { const u = dagNodes.find(x => x.uid === uid); if (!u) return 0; if (!u.op) return 0; return 1 + Math.max(heightOf(u.left), heightOf(u.right)); };
    const layers = {};
    dagNodes.forEach(u => { const h = heightOf(u.uid); (layers[h] = layers[h] || []).push(u); });
    const dagPos = {};
    Object.keys(layers).forEach(h => layers[h].forEach((u, i) => {
      dagPos[u.uid] = { x: 50 + i * 66, y: 30 + (Number(h)) * 58 };
    }));
    const dagEdges = [], dagDots = [];
    dagNodes.forEach(u => {
      const p = dagPos[u.uid];
      /* ⚠ 窗50 目视修：原来画直线，**共享顶点的第二条入边会和同列的边重叠**（看不出"多条入边"）⟹
         改成左右各自外弓的二次贝塞尔（左孩子向左弓、右孩子向右弓），两条入边当场分得开。 */
      [u.left, u.right].forEach((c, side) => {
        if (!c || !dagPos[c]) return;
        const q = dagPos[c];
        const mx = (p.x + q.x) / 2 + (side === 0 ? -16 : 16), my = (p.y + q.y) / 2;
        dagEdges.push('<path d="M ' + p.x + ' ' + (p.y - 15) + ' Q ' + mx + ' ' + my + ' ' + q.x + ' ' + (q.y + 15) +
          '" fill="none" stroke="#94a3b8" stroke-width="2"/>');
      });
      dagDots.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="16" fill="#eef2ff" stroke="#6366f1" stroke-width="2"/>' +
        '<text x="' + p.x + '" y="' + p.y + '" dy="0.35em" text-anchor="middle" style="font:800 13px Consolas;fill:#3730a3">' + (u.op || u.name) + '</text>' +
        '<text x="' + p.x + '" y="' + (p.y - 21) + '" text-anchor="middle" style="font:700 10px Consolas;fill:#6366f1">#' + u.uid + '</text>');
    });
    const dagW = Math.max(320, 70 + Math.max.apply(null, [0].concat(Object.keys(layers).map(h => layers[h].length))) * 66);
    const dagH = 40 + (Object.keys(layers).length) * 58 + 24;

    const isDone = s.step === 'done';
    const total = isDone ? s.total : 0;
    const stats =
      RC408.ui.statCard('表达式树结点', String(s.size || m.nodes.length), '每个出现位置各一个结点', 'text-slate-600') +
      RC408.ui.statCard('已认领顶点', String((s.order || []).length), '键不同的才新建', 'text-indigo-600') +
      RC408.ui.statCard('共享次数', String((s.table || []).reduce((a, b) => a + (b.count - 1), 0)), '重复子表达式被合并的次数', 'text-emerald-600') +
      RC408.ui.statCard('最少顶点数', isDone ? String(total) : '—', isDone ? '= 不同子表达式的个数' : '走到末帧给出', isDone ? 'text-rose-600' : 'text-slate-400');

    const tableRows = (s.table || []).map(u => '<tr' + (s.action && s.action.uid === u.uid ? ' style="background:#fef3c7"' : '') + '>' +
      '<td class="font-mono font-bold">#' + u.uid + '</td>' +
      '<td class="font-mono">' + (u.op ? ('#' + u.left + ' ' + u.op + ' #' + u.right) : ('操作数 ' + u.label)) + '</td>' +
      '<td>' + (u.op ? ('运算符 ' + u.op) : '操作数') + '</td>' +
      '<td class="font-mono">' + u.count + '</td></tr>').join('');

    stage.innerHTML =
      '<div class="space-y-4">' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + stats + '</div>' +
        '<div class="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm font-mono">表达式：' + expr2html(s.expr || '') + '</div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
          '<div>' + RC408.ui.sectionTitle('① 表达式树（原样，逐个认领）') +
            '<div class="rounded-2xl border border-slate-200 bg-white overflow-x-auto p-2">' +
              '<svg viewBox="0 0 ' + treeW + ' ' + treeH + '" class="w-full h-auto" style="max-width:' + treeW + 'px">' + treeEdges.join('') + treeNodes.join('') + '</svg>' +
            '</div>' +
            '<p class="text-xs text-slate-500 mt-1">绿 = 已认领（左上角 #n 是它的顶点号）；琥珀 = 本帧正在认领；灰 = 还没走到。</p>' +
          '</div>' +
          '<div>' + RC408.ui.sectionTitle('② 唯一子表达式表（键 → 顶点）') +
            ((s.table || []).length
              ? '<table class="tbl w-full"><thead><tr><th>顶点</th><th>子表达式</th><th>种类</th><th>出现次数</th></tr></thead><tbody>' + tableRows + '</tbody></table>'
              : '<p class="text-sm text-slate-500">（还没认领任何结点）</p>') +
            (isDone ? '<p class="text-sm mt-2 text-emerald-700 font-bold">最少顶点数 = ' + total + '（原表达式树 ' + (s.size || m.nodes.length) + ' 个结点）</p>'
                    : '<p class="text-xs text-slate-500 mt-1">走到末帧，顶点数就是这道题的答案。</p>') +
          '</div>' +
        '</div>' +
        '<div>' + RC408.ui.sectionTitle('③ 合并后的有向无环图（一个顶点可以有多条入边）') +
          '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white overflow-x-auto p-2">' +
            '<svg viewBox="0 0 ' + dagW + ' ' + dagH + '" class="w-full h-auto" style="max-width:' + Math.max(420, dagW) + 'px">' + dagEdges.join('') + dagDots.join('') + '</svg>' +
          '</div>' +
          '<p class="text-xs text-slate-500 mt-1">每个顶点 = 一个"不同的子表达式"；相同子表达式只留一个顶点、被多条边共同指向 —— 这就是 DAG 比树省的地方。</p>' +
        '</div>' +
        '<div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">' +
          RC408.ui.legend('#10b981', '已认领（新建顶点）') +
          RC408.ui.legend('#f59e0b', '本帧正在处理的结点') +
          RC408.ui.legend('#6366f1', 'DAG 顶点（编号 = 认领次序）') +
        '</div>' +
      '</div>';

    /* 表达式里的运算符加粗（只做展示，不写 Markdown） */
    function expr2html(t) {
      return String(t).replace(/[+\-*/()]/g, c => '<b style="color:#4f46e5">' + c + '</b>');
    }
  },
});
