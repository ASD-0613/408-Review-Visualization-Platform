'use strict';
/* ============================================================================
 * ds-huffman.js —— 【数据结构】哈夫曼树与哈夫曼编码（前缀 _hf）
 * 考情：18 年中 **13 年**考（选 12 题：2010-6、2013-4、2014-6、2015-3、2017-6、2018-5、
 * 2019-3、2021-5、2022-5、2023-4、2025-5、2026-5；大 2012-41 归并 + 哈夫曼/最佳归并树）。
 * （窗14 勘误：原写"12 年"且把 2010-4 当哈夫曼题——2010 只有 6 题是本考点，已按现算改正）
 * 快照：每次合并权值最小的两棵树一帧；最后给出 WPL 与编码表。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-huffman',
  mode: 'stepper',
  title: '哈夫曼树与哈夫曼编码',

  theory: `
> **为什么要有它**：等长编码不管字符出现频次高低都占同样位数，很浪费——**让频繁出现的字符用短码**就能压缩，哈夫曼树给出的正是 WPL 最小的最优前缀码。
> **怎么实现**：n 个权值各成一棵单结点树，每步**取出权值最小的两棵合并**（新根权值 = 两者之和）再放回，重复 n−1 次。
> **记住什么**：**WPL = Σ 权值 × 到根的路径长度**（哈夫曼树使它最小）+ 共 **2n−1** 个结点、**没有度为 1 的结点** + 编码必为**前缀码**。

## 构造算法（贪心）
1. n 个权值看作 n 棵单结点树；
2. 每步取**权值最小的两棵**合并，新根权值 = 两者之和；
3. 把新树放回集合，重复直到只剩一棵。
- 共 **2n−1 个结点**，**没有度为 1 的结点**；权值相同的合并顺序可任选，树形可能不同。

## WPL 与编码
- **WPL**（带权路径长度）= Σ 权值 × 该叶到根的路径长度；**哈夫曼树的 WPL 最小**（同权值集合 WPL 唯一，树形可能不唯一）；
- 左分支记 **0**、右分支记 **1**（约定可互换，编码长度不变）；**频率越大的字符编码越短**；
- **前缀码**：任何编码都不是另一编码的前缀 → 译码无歧义（哈夫曼编码必为前缀码）。

## 高频结论
- 译码：从根出发按 0 / 1 往下走，走到叶子还原一个字符，再回到根继续；
- 判断"某编码集是否为哈夫曼编码 / 前缀码"：画树或逐个查前缀关系（**哈夫曼树中左右孩子权值之和 = 父结点权值**）；
- 三叉（k 叉）哈夫曼树要补**权值 0 的虚结点**：补 \\((k-1)-((n-1)\\bmod (k-1))\\) 个。

## 考点提醒（易错点）
1. 合并时**每次都要重新取当前最小的两棵**（合并出的新树要放回参与比较），不能一次排好序就不再取；
2. **WPL 唯一、树形不唯一**——选项里出现"唯一确定"要小心；
3. 问"与某结点同深度的结点"：先把树按规则画出来，再看层号；
4. k 叉哈夫曼树的虚结点数必须补对，否则最底层不满、WPL 不是最小。

> **真题考情**：**13/18 年（选 12 题 + 大 1 道）**：选 2010-6、2013-4、2014-6、2015-3、2017-6、
> 2018-5、2019-3、2021-5、2022-5、2023-4、2025-5、2026-5；大 2012-41（归并 + 哈夫曼 / 最佳归并树）。
`,

  inputs: [
    { key: 'weights', label: '字符权值（逗号分隔，4~8 个；自动按 A、B、C… 命名）', type: 'textarea', rows: 2, wide: true,
      default: '5, 2, 6, 3, 1, 4' },
    { key: 'leftSmall', label: '合并时较小权值放', type: 'select', default: 'left',
      options: [{ v: 'left', t: '左子树（编码 0）' }, { v: 'right', t: '右子树（编码 1）' }] },
  ],

  quickActions: [
    { label: '2013 真题权值', run(rt) { rt.setInput('weights', '3, 4, 5, 6, 8, 10'); rt.load(); } },
    { label: '2023 真题权值', run(rt) { rt.setInput('weights', '2, 3, 4, 6, 10, 11'); rt.load(); } },
  ],

  parse(vals) {
    const ws = vals.weights.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (ws.length < 3 || ws.length > 8) throw { message: '权值个数请控制在 3 ~ 8 个' };
    if (ws.some(w => w <= 0)) throw { message: '权值须为正整数' };
    return { ws, leftSmall: vals.leftSmall !== 'right' };
  },

  buildSnapshots(model) {
    const { ws, leftSmall } = model;
    const names = 'ABCDEFGHIJ'.split('');
    let nodes = ws.map((w, i) => ({ id: i, name: names[i], w, leaf: true, left: null, right: null, root: true }));
    const snaps = [];
    let wplDone = false;
    const roots = () => nodes.filter(n => n.root);
    const push = (step, merged, log, logType, desc) => snaps.push({
      step, nodes: JSON.parse(JSON.stringify(nodes.map(n => ({ ...n, root: n.root })))),
      merged: merged || [], wplDone,
      log, logType, desc,
    });

    push('init', null, `就绪：${ws.length} 个叶子权值 ${ws.join(', ')}（${ws.map((w, i) => names[i] + '=' + w).join(' ')}）。每步合并权值最小的两棵树。`, 'info',
      '点击「单步执行」观察贪心合并过程');

    let sum = 0;
    while (roots().length > 1) {
      roots().sort((a, b) => a.w - b.w || a.id - b.id);
      const s1 = roots()[0], s2 = roots()[1];
      s1.root = s2.root = false;
      const node = { id: nodes.length, name: '', w: s1.w + s2.w, leaf: false, left: leftSmall ? s1 : s2, right: leftSmall ? s2 : s1, root: true };
      nodes.push(node);
      push('merge', [s1.id, s2.id],
        `取出最小两棵：${s1.leaf ? s1.name : '结点'}(${s1.w}) 与 ${s2.leaf ? s2.name : '结点'}(${s2.w}) → 合并为新结点（权 ${node.w}），放回集合`,
        'success', `合并 ${s1.w} + ${s2.w} → ${node.w}`);
      sum = node.w;
    }
    const root = roots()[0];

    /* 编码：DFS，左 0 右 1 */
    const codes = {};
    (function enc(n, code) {
      if (n.leaf) { codes[n.id] = code || '0'; return; }
      enc(n.left, code + '0'); enc(n.right, code + '1');
    })(root, '');
    let wpl = 0;
    nodes.filter(n => n.leaf).forEach(n => { n.code = codes[n.id]; wpl += n.w * n.code.length; });
    push('codes', null, `编码完成（左 0 右 1）：${nodes.filter(n => n.leaf).map(n => `${n.name}=${n.code}(${n.code.length} 位)`).join('，')}`, 'info',
      'WPL = Σ 权值 × 编码长度');
    push('done', null,
      `WPL = ${nodes.filter(n => n.leaf).map(n => `${n.w}×${n.code.length}`).join(' + ')} = ${wpl}。共 ${2 * ws.length - 1} 个结点，无度 1 结点。`,
      'success', `完成！最小 WPL = ${wpl}`);
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    const nodes = s.nodes || [];
    const roots = nodes.filter(n => n.root);
    const leaves = nodes.filter(n => n.leaf);

    /* 森林布局：每棵根树按叶子数分配水平段；深度自适应，防止越界 */
    const allLeaves = leaves.length || 1;
    let maxDepth = 1;
    roots.forEach(r => { (function depth(n, d) { if (!n) return; maxDepth = Math.max(maxDepth, d); depth(n.left, d + 1); depth(n.right, d + 1); })(r, 0); });
    const W = Math.max(allLeaves * 78 + 60, 460);
    const H = 70 + (maxDepth + 1) * 58;
    const P = {};
    if (roots.length) {
      let cursor = 0;
      roots.forEach(r => {
        const lf = []; (function gather(n) { if (n.leaf) lf.push(n); else { gather(n.left); gather(n.right); } })(r);
        const segW = (W - 40) * (lf.length / allLeaves);
        const s0 = cursor, s1 = cursor + segW; cursor = s1;
        (function place2(n, depth, ss, se) {
          if (n.leaf) { P[n.id] = { x: (ss + se) / 2, y: 56 + depth * 58, d: depth }; return; }
          const mid = (ss + se) / 2;
          place2(n.left, depth + 1, ss, mid); place2(n.right, depth + 1, mid, se);
          P[n.id] = { x: mid, y: 56 + depth * 58, d: depth };
        })(r, 0, s0 + 4, s1 - 4);
      });
    }
    let edges = '', circles = '';
    nodes.forEach(n => {
      const p = P[n.id]; if (!p) return;
      [['left', 0], ['right', 1]].forEach(([side, bit]) => {
        const c = n[side]; if (!c || !P[c.id]) return;
        const cp = P[c.id];
        const hot = (s.merged || []).includes(c.id);
        edges += `<line x1="${p.x}" y1="${p.y}" x2="${cp.x}" y2="${cp.y}" stroke="${hot ? '#f59e0b' : '#cbd5e1'}" stroke-width="${hot ? 3.5 : 2}"/>
          <text x="${(p.x + cp.x) / 2 + (bit ? 9 : -9)}" y="${(p.y + cp.y) / 2}" text-anchor="middle" style="font:700 11px Consolas" fill="${hot ? '#b45309' : '#94a3b8'}">${bit}</text>`;
      });
      const isMergedRoot = s.merged && s.merged.includes(n.id) && n.root;
      const fill = n.leaf ? '#6366f1' : isMergedRoot ? '#f59e0b' : '#fbbf24';
      circles += `<circle cx="${p.x}" cy="${p.y}" r="19" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="font-size:12px">${n.leaf ? n.name : n.w}</text>`;
    });

    const codeRows = leaves.filter(l => l.code).map(l =>
      `<tr><td class="font-bold">${l.name}</td><td class="font-mono">${l.w}</td><td class="font-mono font-bold" style="color:#4338ca">${l.code}</td><td class="font-mono">${l.code.length}</td><td class="font-mono">${l.w * l.code.length}</td></tr>`).join('');
    const wpl = leaves.filter(l => l.code).reduce((a, l) => a + l.w * l.code.length, 0);

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${RC408.ui.statCard('叶结点数', leaves.length, '内部结点 = ' + (leaves.length - 1)) +
          RC408.ui.statCard('总结点数', s.wplDone ? 2 * leaves.length - 1 : '…', '2n − 1，无度 1 结点', 'text-indigo-600') +
          RC408.ui.statCard('最小 WPL', s.wplDone ? wpl : '…', 'Σ 权值×路径长度', 'text-emerald-600') +
          RC408.ui.statCard('剩余根树', roots.length, '合并至 1 棵为止', 'text-amber-600')}
        </div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">${edges}${circles}</svg>
        </div>
        ${codeRows ? `<div>${RC408.ui.sectionTitle('哈夫曼编码表（左 0 右 1；前缀码，任何编码都不是另一个的前缀）')}
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="tbl w-full"><thead><tr><th>字符</th><th>权值</th><th>编码</th><th>长度</th><th>权×长</th></tr></thead><tbody>${codeRows}</tbody></table>
          </div>
          <p class="text-xs text-slate-500 mt-2 font-mono">WPL = ${leaves.filter(l => l.code).map(l => l.w + '×' + l.code.length).join(' + ')} = <b>${wpl}</b></p>
        </div>` : ''}
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#6366f1', '叶结点（字符权值）')}
          ${RC408.ui.legend('#f59e0b', '本帧新合并的结点')}
          ${RC408.ui.legend('#94a3b8', '边上 0/1 = 编码位')}
        </div>
      </div>`;
  },
});
