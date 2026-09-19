'use strict';
/* ============================================================================
 * bintree.js —— 【数据结构】二叉树的遍历（前序 / 中序 / 后序 / 层序）
 * ----------------------------------------------------------------------------
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
> **真题考情**：18 年中 8 年考遍历相关（2009 非常规遍历 RNL、2013/2014 线索化中的遍历序列、2019/2020/2025 树/森林转换后的遍历对应、2022 中序相邻结点关系、2024 中序前驱后继），此外几乎每年还有二叉树性质选择题——中序是三种遍历中最重要的"锚"。

## 遍历 = 按某条规则"访问"每个结点一次
二叉树是递归定义的，三种深度优先遍历的唯一区别是：**访问根结点发生在递归轨迹的哪个位置**。

\`\`\`text
先序 DLR：访问根 → 递归左子树 → 递归右子树
中序 LDR：递归左子树 → 访问根 → 递归右子树
后序 LRD：递归左子树 → 递归右子树 → 访问根
\`\`\`
- 单步执行时盯住右侧**递归栈**：入栈 = "进入子树"，出栈 = "子树处理完毕"；
- **层序遍历**不用递归，借助**队列**：根入队 → 队首出队并访问 → 其左右孩子依次入队。

## 必背结论
| 结论 | 说明 |
| --- | --- |
| n 个结点 n+1 个空指针 | n+1 个空链域（可用来构造线索二叉树） |
| n₀ = n₂ + 1 | 叶结点数 = 度为2结点数 + 1 |
| 中序 + 先序 / 中序 + 后序 / 中序 + 层序 | 可唯一确定一棵二叉树（先序+后序不能） |
| 先序序列中，祖先一定在后代之前 | 后序相反；层序按层从左到右 |

## 非递归实现思想（考点）
- 先序/中序：指针一路向左入栈，到底后出栈访问（中序）/ 出栈后再进右子树（先序）；
- 后序：需要额外标记"右子树是否已访问"（或用双栈 / 前驱判断）。

## 考点提示
- 给**中序 + 另一种**序列画树 / 求第三种序列，是最高频的大题；
- 层序遍历必须用**队列**，且"出队访问"与"孩子入队"的先后次序不能乱；
- 遍历时间复杂度 O(n)、空间复杂度 O(h)（h 为树高，最坏 O(n)）。
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
