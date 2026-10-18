'use strict';
/* ============================================================================
 * bintree.js —— 【数据结构】二叉树的遍历（前序 / 中序 / 后序 / 层序）
 * ----------------------------------------------------------------------------
 * 考情：18 年中 9 年考（全为选择题：2009-3、2013-5 后序线索、2014-4 中序线索、
 *   2019-2、2020-4、2022-3、2024-3 中序前驱后继、2025-4 森林转二叉树、2026-3）。
 * 快照设计：遍历的每个动作产生一帧（另加 init / done）：
 *   { type:'init'|'enter'|'visit'|'exit'|'enqueue'|'done',
 *     node     当前动作涉及的结点 id
 *     stack    递归栈（DFS 时），元素为结点 id
 *     output   已得到的遍历序列（结点 id）
 *     queue    层序遍历时的队列
 *     visitNo  {结点id: 访问序号} }
 * 教学重点：前/中/后序的唯一区别是"访问根结点"发生在递归栈轨迹的哪个阶段。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-bintree-traversal',
  mode: 'stepper',
  title: '二叉树的遍历（前序 · 中序 · 后序 · 层序）',

  theory: `
> **为什么要有它**：树是递归结构，要找父/子、判同构、做线索化，都得先"按某种次序把每个结点走一遍"——**遍历**就是给树规定一条线性次序。
> **怎么实现**：三种深度优先遍历的差别只在**访问根结点发生在递归轨迹的哪个位置**（前 DLR / 中 LDR / 后 LRD）；层序不用递归，靠**队列**逐层扩展。
> **记住什么**：递归栈轨迹 ↔ 遍历序列 + **中序 + 先序/后序/层序可唯一确定一棵二叉树**（先序 + 后序不行）+ \\(n_0=n_2+1\\)。

## 三种遍历的差别只在"访问根"的位置

| 遍历 | 次序 | 递归栈上"访问根"发生在 |
| --- | --- | --- |
| 先序 DLR | 根 → 左 → 右 | 进入子树时 |
| 中序 LDR | 左 → 根 → 右 | 左子树处理完之后 |
| 后序 LRD | 左 → 右 → 根 | 左右子树都处理完之后 |

- **层序**：根入队 → 队首出队并访问 → 其左、右孩子依次入队（"出队访问"与"孩子入队"的先后不能乱）；
- 单步时盯住右侧**递归栈**：入栈 = 进入子树，出栈 = 子树处理完毕。

## 必背结论

| 结论 | 说明 |
| --- | --- |
| n 个结点有 n+1 个空链域 | 线索二叉树正是拿它存前驱 / 后继 |
| \\(n_0=n_2+1\\) | 叶结点数 = 度为 2 的结点数 + 1 |
| 中序 + 先序 / 后序 / 层序 | 可唯一确定一棵二叉树（先序 + 后序**不能**） |
| 先序序列中祖先必在后代之前 | 后序相反；层序按层从左到右 |

## 非递归实现（考点）

- 先序 / 中序：指针一路向左入栈，到底后出栈——中序出栈即访问，先序出栈后再进右子树；
- 后序：需要额外标记"右子树是否已访问"（或用双栈、或判断前驱）。

## 由两个序列还原二叉树：能定与不能定

| 给的两个序列 | 能否唯一确定 | 怎么还原 |
| --- | --- | --- |
| 先序 + 中序 | 能 | 先序第一个是根，在中序里切开左右子树，递归下去 |
| 后序 + 中序 | 能 | 后序最后一个是根，其余同上 |
| 层序 + 中序 | 能 | 层序第一个是根，在中序里切开；左右子树的根各取层序中最先出现的那个 |
| 先序 + 后序 | **不能** | 只能定**祖先关系**：X 在前序中排在 Y 之前、在后序中排在 Y 之后 ⟹ X 是 Y 的祖先（2012-3）；只有"每个结点至多一个孩子"时才唯一 |

- **先序与后序互为逆序 ⟺ 每个结点至多一个孩子**：此时树退化成"左右不分"的一条链，高度等于结点数，中序怎么排都说得通（2011-5）；
- 反过来，**右单支**（每个结点只有右孩子）时先序与中序**完全相同**（2017-4）；左单支时先序与中序互为逆序。

## 完全二叉树：结点数、高度与叶子数

- 高度为 h 的二叉树**最多** \\(2^{h}-1\\) 个结点（满二叉树），第 i 层最多 \\(2^{i-1}\\) 个；
- **完全二叉树的高度** \\(h=\\lfloor \\log_2 n\\rfloor+1\\)；n 个结点按层序从 1 编号后，父子关系与堆的顺序存储完全相同；
- **叶子数**：由 \\(n=n_0+n_1+n_2\\) 与 \\(n_0=n_2+1\\) 得 \\(n=2n_0-1+n_1\\)；完全二叉树里度为 1 的结点**至多一个**，于是 n 为偶数时 \\(n_1=1\\)、\\(n_0=n/2\\)，n 为奇数时 \\(n_1=0\\)、\\(n_0=(n+1)/2\\)（2011-4：768 个结点 ⟹ 384 个叶结点）；
- **满二叉树**：高度 h 时结点 \\(2^h-1\\)、叶结点 \\(2^{h-1}\\)（2018-4：叶结点数为 k 时总结点数是 \\(2k-1\\)）；
- **2009-5 型**：第 6 层已有叶结点 ⟹ 高度只能是 6 或 7；高度 7 时前 6 层是满的（63 个），第 7 层要比满树少 \\(2\\times\\)（第 6 层叶结点数）个 ⟹ 结点数 \\(127-16=111\\) 为最多。

## 顺序存储：空结点必须占位（2020-3 · 2025-3）

- 顺序存储按**完全二叉树的编号**给结点编号：i 的左孩子是 2i、右孩子是 2i+1——所以"某个位置有结点、它的父位置却是空的"这种数组**不合法**；
- 高度为 h 的二叉树要 \\(2^h-1\\) 个单元才能覆盖"任意形状"（2020-3：高度 5、只有 10 个结点，也要 31 个单元）；
- **2025-3 的判法**：数组里用 −1 表示空位时，判"是否为一棵合法二叉树"要看**每个非空结点的父位置是否也非空**（{15,40,10,18,35,−1,−1,12} 里下标 7 的父是下标 3、值为 18 非空 ⟹ 合法），而不是看数组长度是否等于结点数。

## 变体遍历：题面给的次序就是标准（2009-3）

- 题面出现的 RNL、NRL 这类次序**不是**标准遍历的别名，必须**逐结点按它给的次序走**（2009-3 的"根在中间、右子树在左子树之前"就是 RNL）；
- 判据：先写清题面次序（根排第几、左右谁先），再把这棵树的结点按该次序排一遍；别看到"根在中间"就默认中序。

## 二叉树的 WPL（2014-41）

- \\(\\text{WPL}=\\sum\\)（每个叶结点的权 × 它到根的路径长度），只有**叶结点**带权；
- **递归写法**：把深度当参数往下传，到叶子时累加"权 × 深度"，否则分别递归左右子树——时间 \\(O(n)\\)、空间 \\(O(h)\\)；
- **层次写法**：用队列逐层遍历并记下每个结点的层号，到叶子时累加；
- 判据：这里的 WPL 只是**算给定树**（2014-41），与"哈夫曼树的 WPL 最小"是两个不同的考点，不要去构造哈夫曼树。

## 中序序列里相邻的两个结点（2022-3 · 2024-3）

- 中序里"p 紧挨在 q 前面"**不能**只从树形看：若 q 是 p 的右兄弟，中序必然先 p、再它们的父结点、最后 q，两者不可能相邻（2022-3 举一个反例即可推翻选项）；
- 中序片段为 p, v, q 且 v 是 p、q 的父结点时：p 是左子树中最后访问的结点 ⟹ **p 没有右孩子**；q 是右子树中最先访问的结点 ⟹ **q 没有左孩子**（2024-3）。

## 考点提醒（易错点）

1. **给中序 + 另一种序列画树**是最高频大题：先由先序 / 后序定根，再用中序切左右子树，递归下去；
2. 遍历时间 \\(O(n)\\)、空间 \\(O(h)\\)（h 为树高，单支链最坏 \\(O(n)\\)）；
3. **森林 / 树的遍历与二叉树遍历有对应关系**（树的前根遍历 = 二叉树先序、树的后根遍历 = 二叉树中序），转换题的题眼就在这里；
4. 线索化只是把空链域指向前驱 / 后继：**线索指向的是"该遍历序列"里的前驱后继**，先写出序列再连，不要凭树形猜。

> **真题考情**：**12/18 年（选 14 + 大 1，共 15 题）**：选 2009-3·5、2011-4·5、2012-3、2017-4·5、2018-4、
> 2020-3、2022-3、2023-5、2024-3、2025-3、2026-3（中序 + 层序求树形）；大 2014-41（求二叉树的 WPL）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'tree', label: '二叉树（层序序列，# 表示空指针）', type: 'textarea', rows: 2, wide: true,
      default: 'A,B,C,D,E,#,F,G,H,#,#,I,J',
      help: '自上而下、从左到右逐个给出结点；每个结点依次跟上左右孩子，空的写 #（# 不占后续位置）；最多 15 个结点',
    },
    {
      key: 'order', label: '遍历方式', type: 'select', default: 'in',
      options: [
        { v: 'pre', t: '前序遍历 DLR（根 → 左 → 右）' },
        { v: 'in', t: '中序遍历 LDR（左 → 根 → 右）' },
        { v: 'post', t: '后序遍历 LRD（左 → 右 → 根）' },
        { v: 'level', t: '层序遍历（自上而下，借助队列）' },
      ],
    },
  ],

  quickActions: [
    {
      label: '🎲 随机二叉树', run(rt) {
        // 按紧凑层序随机生成：每个结点随机决定左右孩子是否出现
        const pool = 'ABCDEFGHIJKLMNO'.split('').sort(() => Math.random() - 0.5);
        const toks = []; const q = [];
        toks.push(pool.pop()); q.push(1); let count = 1, qi = 0;
        const budget = RC408.util.rnd(8, 12);
        while (qi < q.length && count < budget) {
          qi++;
          for (let side = 0; side < 2; side++) {
            if (count >= budget || pool.length === 0 || Math.random() < 0.32) { toks.push('#'); continue; }
            toks.push(pool.pop()); q.push(1); count++;
          }
        }
        if (count < 5) { rt.load(); return; }   // 太稀疏就重掷
        rt.setInput('tree', toks.join(','));
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入（紧凑层序约定：# 不占孩子槽位） ---------------- */
  parse(vals) {
    const toks = vals.tree.split(/[,，\s、]+/).filter(Boolean);
    if (!toks.length) throw { message: '请输入层序序列，如 A,B,C,#,D' };
    if (toks.length > 40) throw { message: '序列最长 40 项（便于展示）' };
    let idc = 0;
    const mk = (label, depth) => ({ id: idc++, label: label.slice(0, 3), depth, left: null, right: null, parent: null });

    if (toks[0] === '#' || /^null$/i.test(toks[0])) throw { message: '序列第一项（根结点）不能为 #' };
    const root = mk(toks[0], 0);
    const all = [root];
    const q = [root];
    let ti = 1;
    while (ti < toks.length && q.length) {
      const nd = q.shift();
      for (const side of ['left', 'right']) {
        if (ti >= toks.length) break;
        const t = toks[ti++];
        if (t !== '#' && !/^null$/i.test(t)) {
          const c = mk(t, nd.depth + 1);
          nd[side] = c; c.parent = nd;
          all.push(c); q.push(c);
        }
      }
    }
    const real = all;
    if (real.length > 15) throw { message: '结点数最多 15 个（便于展示）' };
    return { nodes: all, root, real, maxDepth: Math.max(...real.map(n => n.depth)), order: vals.order };
  },

  /* ---------------- ② 纯算法：遍历过程快照 ---------------- */
  buildSnapshots(model) {
    const { root, real, order, nodes } = model;
    const orderName = { pre: '前序', in: '中序', post: '后序', level: '层序' }[order];
    const snaps = [];
    let visitCount = 0;
    const S = { stack: [], output: [], queue: [], visitNo: {} };
    const snap = (type, node, desc, log, logType) => snaps.push({
      type, node: node ? node.id : null,
      stack: [...S.stack], output: [...S.output], queue: [...S.queue],
      visitNo: { ...S.visitNo }, desc, log, logType,
    });

    snaps.push({
      type: 'init', node: null, stack: [], output: [], queue: [], visitNo: {},
      log: `就绪：${real.length} 个结点，按「${orderName}」开始遍历。`, logType: 'info',
      desc: order === 'level'
        ? '层序：根入队 → 队首出队并访问 → 其孩子依次入队'
        : '递归遍历：盯住递归栈的进出，以及"访问"发生在入栈后 / 出栈前的哪个位置',
    });

    if (order === 'level') {
      /* ---- 层序：队列 ---- */
      const q = [root]; S.queue.push(root.id);
      snap('enqueue', root, `根结点 ${root.label} 入队`, `根结点 ${root.label} 入队，遍历开始`, 'info');
      while (q.length) {
        const nd = q.shift(); S.queue.shift();
        visitCount++; S.output.push(nd.id); S.visitNo[nd.id] = visitCount;
        snap('visit', nd, `队首 ${nd.label} 出队并访问（第 ${visitCount} 个）`,
          `队首 ${nd.label} 出队 → 访问 ✓（第 ${visitCount} 个）`, 'success');
        const kids = [nd.left, nd.right].filter(Boolean);
        if (kids.length) {
          kids.forEach(k => { q.push(k); S.queue.push(k.id); });
          snap('enqueue', nd, `${nd.label} 的孩子（${kids.map(k => k.label).join('、')}）依次入队`,
            `${nd.label} 的孩子（${kids.map(k => k.label).join('、')}）依次入队`, 'info');
        }
      }
    } else {
      /* ---- 深度优先：显式栈模拟递归 ---- */
      const visit = nd => {
        visitCount++; S.output.push(nd.id); S.visitNo[nd.id] = visitCount;
        const where = order === 'pre' ? '（根最先：进入即访问）' : order === 'in' ? '（左子树归来后访问）' : '（两棵子树都归来才访问）';
        snap('visit', nd, `访问 ${nd.label}（第 ${visitCount} 个）${where}`,
          `访问结点 ${nd.label} —— 第 ${visitCount} 个被访问`, 'success');
      };
      const go = nd => {
        if (!nd) return;
        S.stack.push(nd.id);
        snap('enter', nd, `${nd.label} 入栈（进入其子树）`, `递归进入 ${nd.label}（入栈）`, 'info');
        if (order === 'pre') visit(nd);
        go(nd.left);
        if (order === 'in') visit(nd);
        go(nd.right);
        if (order === 'post') visit(nd);
        S.stack.pop();
        snap('exit', nd, `${nd.label} 出栈（其子树遍历完毕）`, `${nd.label} 的子树处理完毕，出栈返回上层`, 'info');
      };
      go(root);
    }

    snaps.push({
      type: 'done', node: null, stack: [], output: [...S.output], queue: [], visitNo: { ...S.visitNo },
      log: `遍历完成！${orderName}序列：${S.output.map(id => nodes[id].label).join(' → ')}`,
      logType: 'success',
      desc: `遍历完成，共访问 ${visitCount} 个结点`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { nodes, real, order } = model;
    const isLevel = order === 'level';

    /* 布局：x = 中序次序，y = 层深（标准二叉树画法，无交叉） */
    let ix = 0;
    (function walk(nd, d) {
      if (!nd) return;
      walk(nd.left, d + 1);
      nd._x = ix++; nd._y = d;
      walk(nd.right, d + 1);
    })(model.root, 0);
    const W = Math.max(real.length * 96 + 80, 420);
    const H = (model.maxDepth + 1) * 92 + 36;
    const gap = real.length > 1 ? (W - 92) / (real.length - 1) : 0;
    const P = {};
    real.forEach(n => { P[n.id] = { x: real.length > 1 ? 46 + n._x * gap : W / 2, y: 44 + n._y * 92 }; });

    /* 当前结点 → 根的祖先链（递归路径高亮） */
    const pathIds = new Set();
    if (s.node !== null) {
      let p = nodes[s.node];
      while (p) { pathIds.add(p.id); p = p.parent; }
    }

    /* 边：递归路径上的边加粗高亮 */
    const edgeSvg = real.map(nd => [nd.left, nd.right].filter(Boolean).map(ch => {
      const a = P[nd.id], b = P[ch.id];
      const hot = pathIds.has(ch.id) && s.node !== null;
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${hot ? '#f59e0b' : '#cbd5e1'}" stroke-width="${hot ? 3.5 : 2.5}"/>`;
    }).join('')).join('');

    /* 结点：默认灰 / 在栈中琥珀 / 已访问绿（标访问序号）/ 当前结点光环 */
    const nodeSvg = real.map(nd => {
      const p = P[nd.id];
      const visited = s.visitNo[nd.id] !== undefined;
      const inStack = s.stack.includes(nd.id);
      const isCur = s.node === nd.id;
      const fill = visited ? '#10b981' : inStack ? '#f59e0b' : '#e2e8f0';
      const txt = visited || inStack ? '#fff' : '#475569';
      const haloColor = isCur ? (s.type === 'visit' ? '#10b981' : s.type === 'exit' ? '#94a3b8' : '#f59e0b') : null;
      return `${haloColor ? `<circle cx="${p.x}" cy="${p.y}" r="27" class="knode-halo" style="stroke:${haloColor}"/>` : ''}
        <circle cx="${p.x}" cy="${p.y}" r="21" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${txt}">${nd.label}</text>
        ${visited ? `<text x="${p.x + 15}" y="${p.y - 16}" style="font:800 11px Consolas,monospace;fill:#059669;text-anchor:middle">${s.visitNo[nd.id]}</text>` : ''}`;
    }).join('');

    /* 递归栈 / 队列 / 输出序列 */
    const stackHtml = isLevel ? '' : `
      <div>
        ${RC408.ui.sectionTitle('递归栈（右端 = 栈顶；琥珀色结点在栈中）')}
        <div class="flex flex-wrap gap-1.5 items-center">
          ${s.stack.length ? s.stack.map(id => RC408.ui.chip(nodes[id].label, 'chip-check')).join('<span class="text-slate-300 self-center">←</span>') : '<span class="text-xs text-slate-400">（空栈）</span>'}
        </div>
      </div>`;
    const queueHtml = !isLevel ? '' : `
      <div>
        ${RC408.ui.sectionTitle('队列（左端 = 队首，出队即访问）')}
        <div class="flex flex-wrap gap-1.5 items-center">
          ${s.queue.length ? s.queue.map(id => RC408.ui.chip(nodes[id].label, 'chip-check')).join('<span class="text-slate-300 self-center">→</span>') : '<span class="text-xs text-slate-400">（空队列）</span>'}
        </div>
      </div>`;
    const outputHtml = `
      <div>
        ${RC408.ui.sectionTitle('遍历输出序列（结点上方数字 = 访问次序）')}
        <div class="flex flex-wrap gap-1.5 items-center">
          ${s.output.length ? s.output.map((id, i) => RC408.ui.chip(nodes[id].label, 'chip-mst', `第 ${i + 1} 个访问`)).join('<span class="text-slate-300 self-center">→</span>') : '<span class="text-xs text-slate-400">（尚未访问任何结点）</span>'}
        </div>
      </div>`;

    const stats =
      RC408.ui.statCard('已访问结点', `${s.output.length} / ${real.length}`, `遍历方式：${{ pre: '前序 DLR', in: '中序 LDR', post: '后序 LRD', level: '层序' }[order]}`) +
      RC408.ui.statCard(isLevel ? '队列长度' : '栈深度', isLevel ? s.queue.length : s.stack.length, isLevel ? '队列中待访问结点' : '递归调用层数', 'text-amber-600') +
      RC408.ui.statCard('空间复杂度', 'O(h)', 'h = 树高，辅助结构大小', 'text-indigo-600') +
      RC408.ui.statCard('时间复杂度', 'O(n)', '每个结点恰好访问一次', 'text-indigo-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${Math.max(W, 520)}px">
            ${edgeSvg}${nodeSvg}
          </svg>
        </div>

        ${stackHtml}
        ${queueHtml}
        ${outputHtml}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#10b981', '已访问（绿色，右上角为访问序号）')}
          ${RC408.ui.legend('#f59e0b', '在递归栈 / 队列中等待')}
          ${RC408.ui.legend('#fbbf24', '橙色路径 = 根到当前结点的递归路径')}
        </div>
      </div>`;
  },
});
