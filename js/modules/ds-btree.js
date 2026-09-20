'use strict';
/* ============================================================================
 * ds-btree.js —— 【数据结构】B 树与 B+ 树（插入分裂 · 删除借位/合并 · 高度与关键字数）
 * ----------------------------------------------------------------------------
 * 前缀：_bt（所有顶层函数/变量都带前缀，避免经典 script 全局污染）
 *
 * 快照设计：每个算法动作产生一帧（另加 init / done）：
 *   step: init | search | insert | overflow | split
 *        | replace | remove | underflow | borrow | merge | shrink | done | err
 * 每帧**全量携带**（§1.3 铁律）：
 *   tree   深拷贝的嵌套结构 { id, keys[], kids[], leaf }（id 稳定，供高亮定位）
 *   path   当前查找/调整路径的结点 id 数组
 *   nh     结点级高亮  id → 'overflow'|'underflow'|'borrow'|'merge'|'split'
 *   kh     关键字级高亮 "id:key" → 'new'|'up'|'del'|'over'
 *   insDone / delDone / curKey / phase / 统计量 / 文案
 *
 * 口径（408/严蔚敏，经 2013-10、2018-8、2022-8 三题解析共同印证）：
 *   m 阶 B 树：每个结点最多 m 棵子树、m−1 个关键字；非根结点最少 ⌈m/2⌉ 棵子树、
 *   ⌈m/2⌉−1 个关键字；根至少 1 个关键字；所有叶结点同层。
 *   （注意：第三方 2025-8 解析写作 "[2,4]"，与上述口径矛盾，本模块不采信，见 handover §6.2）
 * ========================================================================== */

/* ------------------------------ 纯工具（_bt 前缀） ------------------------------ */
/** 深拷贝结点（快照必须自包含，回退/跳帧才不出错） */
function _btClone(nd) {
  if (!nd) return null;
  return { id: nd.id, keys: nd.keys.slice(), kids: nd.kids.map(_btClone), leaf: nd.leaf };
}
/** 新建空结点 */
function _btNew(leaf, seq) { return { id: seq.n++, keys: [], kids: [], leaf: leaf }; }
/** 全树关键字总数 */
function _btKeyCount(nd) {
  if (!nd) return 0;
  return nd.keys.length + nd.kids.reduce(function (a, k) { return a + _btKeyCount(k); }, 0);
}
/** 全树结点数 */
function _btNodeCount(nd) {
  if (!nd) return 0;
  return 1 + nd.kids.reduce(function (a, k) { return a + _btNodeCount(k); }, 0);
}
/** 树高（B 树绝对平衡，任取一条到叶的路径即可） */
function _btHeight(nd) {
  if (!nd) return 0;
  let h = 1;
  let cur = nd;
  while (!cur.leaf) { cur = cur.kids[0]; h++; }
  return h;
}
/** 结点内第一个 ≥ k 的下标（= k 的位置或应插入的位置，也是应走的孩子下标） */
function _btLower(keys, k) {
  let i = 0;
  while (i < keys.length && keys[i] < k) i++;
  return i;
}
/** 解析关键字序列 */
function _btParseKeys(raw, name, optional) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s) {
    if (optional) return [];
    throw { message: '请输入' + name + '，例如 5,6,9,13（逗号 / 空格分隔）' };
  }
  const toks = s.split(/[,，、\s]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!/^-?\d+$/.test(t)) {
      throw { message: name + '里有无法识别的项「' + t + '」——只支持整数，用逗号 / 空格分隔' };
    }
    const v = parseInt(t, 10);
    if (v < -999 || v > 9999) throw { message: name + '里的 ' + v + ' 超出范围（−999 ~ 9999）' };
    out.push(v);
  }
  return out;
}
/** 高度上下界：含 N 个关键字的 m 阶 B 树，h ∈ [hMin, hMax] */
function _btBounds(m, N) {
  if (!N) return { hMin: 0, hMax: 0 };
  const half = Math.ceil(m / 2);
  const hMin = Math.ceil(Math.log(N + 1) / Math.log(m) - 1e-9);
  const hMax = Math.floor(Math.log((N + 1) / 2) / Math.log(half) + 1e-9) + 1;
  return { hMin: hMin, hMax: hMax };
}
/** 高度为 h 的 m 阶 B 树，关键字总数的下界 / 上界 */
function _btKeyRangeOfHeight(m, h) {
  const half = Math.ceil(m / 2);
  const lo = h <= 0 ? 0 : 1 + 2 * (Math.pow(half, h - 1) - 1);
  const hi = h <= 0 ? 0 : Math.pow(m, h) - 1;
  return { lo: lo, hi: hi };
}
/** 静态示意：B+ 树（内部结点只作索引、叶结点含全部关键字并有顺序链） */
function _btBplusSvg() {
  const bw = 46, bh = 26, fs = '#334155';
  const box = function (x, y, keys, fill, stroke) {
    const w = keys.length * bw + 12;
    let g = '<rect x="' + (x - w / 2) + '" y="' + y + '" width="' + w + '" height="' + bh +
      '" rx="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.5"/>';
    keys.forEach(function (k, i) {
      if (i > 0) {
        g += '<line x1="' + (x - w / 2 + 6 + i * bw) + '" y1="' + (y + 5) + '" x2="' +
          (x - w / 2 + 6 + i * bw) + '" y2="' + (y + bh - 5) + '" stroke="' + stroke + '" stroke-width="1" opacity=".45"/>';
      }
      g += '<text x="' + (x - w / 2 + 6 + (i + 0.5) * bw) + '" y="' + (y + bh / 2) +
        '" dy="0.35em" class="knode-text" style="fill:' + fs + '">' + k + '</text>';
    });
    return g;
  };
  return '<svg viewBox="0 0 400 176" class="w-full h-auto" style="max-width:400px">' +
    /* 根（索引层） */
    box(200, 8, [15], '#ede9fe', '#7c3aed') +
    '<text x="200" y="52" text-anchor="middle" style="font:700 11px sans-serif;fill:#7c3aed">内部结点只作索引（关键字在叶中重复）</text>' +
    /* 两条索引边 */
    '<line x1="188" y1="34" x2="100" y2="98" class="kedge"/>' +
    '<line x1="212" y1="34" x2="300" y2="98" class="kedge"/>' +
    /* 叶层 */
    box(100, 98, [5, 10, 15], '#d1fae5', '#059669') +
    box(300, 98, [20, 25, 30], '#d1fae5', '#059669') +
    /* 叶链：箭头只画在两个叶框之间的空隙里（叶 1 右边界 175、叶 2 左边界 225），
       否则箭头会压在框上——本窗截图肉眼看出来的，几何断言抓不到 */
    '<path d="M180 111 L212 111" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" marker-end="url(#bparrow)"/>' +
    '<defs><marker id="bparrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
    '<path d="M0 0 L10 5 L0 10 z" fill="#f59e0b"/></marker></defs>' +
    '<text x="200" y="142" text-anchor="middle" style="font:700 11px sans-serif;fill:#b45309">叶结点按序双向链接 → 支持顺序查找 / 范围查询</text>' +
    '<text x="200" y="164" text-anchor="middle" style="font:700 11px sans-serif;fill:#059669">叶结点含全部关键字；非叶结点不存记录指针</text>' +
    '</svg>';
}

/* ============================================================================ */
RC408.registerModule({
  id: 'ds-btree',
  mode: 'stepper',
  title: 'B 树与 B+ 树（插入分裂 · 删除借位/合并 · 高度与关键字数）',

  theory: `
> **真题考情**：18 年中 **12 年**考 B 树 / B+ 树——2009-8（B−树与 B+ 树特点辨析）、2012-9（3 阶 B−树删关键字 78）、2013-10（5 阶，根满 5 个关键字才分裂 → 高 2 时最少 5 个关键字）、2014-9（4 阶 15 个关键字，结点数最多）、2016-10（B+ 树可顺序查找）、2017-9（B+ 树适用于文件 / 数据库索引）、2018-8（m 阶非叶结点最少 ⌈m/2⌉−1 个关键字）、2020-10（4 阶依次插入求根结点）、2021-9（3 阶高度为 3 时的结点数）、2022-8（5 阶删除 260 后的调整）、2023-7（非空 B 树叙述辨析）、2025-8（7 个关键字的 4 阶 B 树结构种数）。**12 年全部是选择题，18 年无一道大题**；考法集中在「关键字数上下界 / 高度上下界 / 插入分裂 / 删除借位与合并 / B+ 树辨析」。

## 定义（m 阶 B 树，408 口径）
- 每个结点**至多 m 棵子树、至多 m−1 个关键字**；
- **非根**结点至少 ⌈m/2⌉ 棵子树、**至少 ⌈m/2⌉−1 个关键字**；根结点至少 1 个关键字（至少 2 棵子树）；
- 结点内关键字有序，子树 kᵢ 的关键字全部落在 kᵢ₋₁ 与 kᵢ 之间；
- **所有叶结点在同一层**——B 树是"绝对平衡"的多路查找树（叶结点是"失败结点"，不含关键字）。

## 必背公式（本模块右侧统计卡实时给出，可自行核对）
| 量 | 公式 |
| --- | --- |
| 结点关键字数 | 非根 \\(\\lceil m/2\\rceil-1\\) ~ \\(m-1\\)；根 1 ~ \\(m-1\\) |
| 含 N 个关键字的高 h | \\(h\\ge \\log_m(N+1)\\)（最矮）；\\(h\\le \\log_{\\lceil m/2\\rceil}\\dfrac{N+1}{2}+1\\)（最高） |
| 高度为 h 的关键字总数 | 最少 \\(1+2(\\lceil m/2\\rceil^{\\,h-1}-1)\\)；最多 \\(m^{h}-1\\) |
| 高度为 h 的最多结点数 | \\(2\\lceil m/2\\rceil^{\\,h-1}-1\\) |

**三个真题口径互证**：2013-10（m=5, h=2 → 最少 1+2(3−1)=5 ✓，预设"5 阶插 1..5"终态正是 [3]([1,2] [4,5])）、2014-9（m=4, 15 个关键字 → 最高 4 层，4 层最多 1+2+4+8=15 个结点 ✓；但预设"4 阶插 1..15"顺序插入只得到 3 层——要撑到 4 层必须每个结点都只放下限个关键字）、2018-8（m=3 → 非根最少 1 个关键字 ✓）。

## 插入：一路下沉，**溢出就分裂**
1. 从根出发，按关键字大小选择分支，**一定插入到最底层的叶结点**；
2. 叶结点关键字数达到 \\(m\\)（> m−1）即**分裂**：取中间位置 \\(\\lfloor m/2\\rfloor\\) 的关键字**上升到父结点**，左右两半各自成结点；
3. 父结点可能因此再溢出 → **分裂向上传播**；若根溢出则产生新根，**树高 +1**（B 树长高的唯一途径）。

## 删除：**先借后合**，只有根空了才降高
- 若删除的关键字在**非叶结点**：用其**前驱**（左子树最右下关键字）或后继顶替，再回到叶结点去删那个前驱 / 后继；
- 叶结点关键字数 < ⌈m/2⌉−1（**下溢**）：
  - **借位**：兄弟结点"富余"（> ⌈m/2⌉−1）时，父结点关键字下移、兄弟最大/最小关键字上移——只搬关键字，**树高不变**；
  - **合并**：兄弟也不富余，就把"左兄弟 + 父关键字 + 本结点"并成一个结点，父结点少一个关键字；父结点若下溢则继续向上传播；
- 根结点被摘空 → 唯一孩子成为新根，**树高 −1**（B 树降高的唯一途径）。

## B 树 vs B+ 树（辨析必考）
| 对比项 | B 树 | B+ 树 |
| --- | --- | --- |
| 关键字分布 | 每个结点都存关键字，**不重复** | 非叶结点只作索引，**关键字在叶结点重复出现** |
| 关键字与子树 | n 个关键字 → **n+1** 棵子树 | n 个关键字 → **n** 棵子树（叶结点除外） |
| 查找终点 | 可能在非叶结点命中 | **必须走到叶结点**才命中 |
| 顺序查找 | 不支持（只能多路查找） | 叶结点按序链接，**支持顺序查找 / 范围查询** |
| 适用场景 | 随机查找为主 | **文件系统、数据库索引** |

## 考点提示
- "**插入一定发生在叶结点**""**删除非叶关键字要用前驱 / 后继顶替**"是 2023-7、2022-8 的直接考法；
- B+ 树支持顺序查找、B 树不支持（2016-10）；磁盘读写代价低、更适合文件索引的是 B+ 树（2017-9）；
- 算"最多 / 最少结点数、关键字数、树高"一律套上面表格的四个公式，别凭感觉画图。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'order', label: 'B 树的阶 m', type: 'select', default: '4',
      options: [
        { v: '3', t: '3 阶（每个结点 1 ~ 2 个关键字）' },
        { v: '4', t: '4 阶（每个结点 1 ~ 3 个关键字）' },
        { v: '5', t: '5 阶（每个结点 2 ~ 4 个关键字）' },
      ],
      help: 'm 阶 = 最多 m 棵子树、m−1 个关键字；非根最少 ⌈m/2⌉−1 个',
    },
    {
      key: 'inserts', label: '依次插入的关键字', type: 'text',
      default: '5,6,9,13,8,2,12,15', wide: true,
      help: '逗号 / 空格分隔，最多 18 个（关键字互不相同）。默认值就是 2020-10 真题原文的插入序列',
    },
    {
      key: 'deletes', label: '依次删除的关键字（可留空）', type: 'text', default: '', wide: true,
      help: '只能删除上面插入过的关键字；留空则只演示插入分裂',
    },
  ],

  quickActions: [
    {
      label: '📌 2020-10 真题（4 阶插入 5,6,9,13,8,2,12,15）', run(rt) {
        rt.setInput('order', '4');
        rt.setInput('inserts', '5,6,9,13,8,2,12,15');
        rt.setInput('deletes', '');
        rt.load();
      },
    },
    {
      label: '📌 2013-10 真题（5 阶：根满 5 个关键字才分裂）', run(rt) {
        rt.setInput('order', '5');
        rt.setInput('inserts', '1,2,3,4,5');
        rt.setInput('deletes', '');
        rt.load();
      },
    },
    {
      label: '📌 2014-9 真题（4 阶，15 个关键字）', run(rt) {
        rt.setInput('order', '4');
        rt.setInput('inserts', '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15');
        rt.setInput('deletes', '');
        rt.load();
      },
    },
    {
      label: '📌 2025-8 真题（4 阶，7 个关键字的结构）', run(rt) {
        rt.setInput('order', '4');
        rt.setInput('inserts', '1,2,3,4,5,6,7');
        rt.setInput('deletes', '');
        rt.load();
      },
    },
    {
      label: '🔎 删除演示（借位 → 合并 → 前驱顶替 → 根降高）', run(rt) {
        rt.setInput('order', '4');
        rt.setInput('inserts', '1,2,3,4,5,6,7,8,9');
        rt.setInput('deletes', '9,8,7,4,2,1,5,6');
        rt.load();
      },
    },
    {
      label: '🎲 随机序列（3~5 阶随机）', run(rt) {
        const m = RC408.util.rnd(3, 5);
        const n = RC408.util.rnd(6, 11);
        const pool = [];
        while (pool.length < n) {
          const v = RC408.util.rnd(1, 99);
          if (pool.indexOf(v) < 0) pool.push(v);
        }
        rt.setInput('order', String(m));
        rt.setInput('inserts', pool.join(','));
        rt.setInput('deletes', '');
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const m = parseInt(vals.order, 10);
    if (!(m >= 3 && m <= 5)) throw { message: 'B 树的阶 m 只能取 3 ~ 5（教学演示范围）' };
    const inserts = _btParseKeys(vals.inserts, '插入序列', false);
    if (!inserts.length) throw { message: '请至少输入 1 个要插入的关键字，如 5,6,9,13' };
    if (inserts.length > 18) throw { message: '插入序列最长 18 个关键字（' + inserts.length + ' 个太宽，画面会挤）' };
    const dupI = [];
    inserts.forEach(function (k, i) { if (inserts.indexOf(k) !== i && dupI.indexOf(k) < 0) dupI.push(k); });
    if (dupI.length) throw { message: '插入序列中关键字重复：' + dupI.join('、') + '（B 树内关键字互不相同）' };
    const deletes = _btParseKeys(vals.deletes, '删除序列', true);
    if (deletes.length > 8) throw { message: '删除序列最长 8 个关键字（当前 ' + deletes.length + ' 个）' };
    const dupD = [];
    deletes.forEach(function (k, i) { if (deletes.indexOf(k) !== i && dupD.indexOf(k) < 0) dupD.push(k); });
    if (dupD.length) throw { message: '删除序列中关键字重复：' + dupD.join('、') };
    const bad = deletes.filter(function (k) { return inserts.indexOf(k) < 0; });
    if (bad.length) {
      throw {
        message: '删除的关键字 ' + bad.join('、') + ' 不在插入序列中——本模块用插入序列建树，' +
          '只能删除已插入过的关键字（删除不存在的关键字属于"查找失败"，不是删空结点）',
      };
    }
    return {
      m: m, maxKeys: m - 1, minKeys: Math.ceil(m / 2) - 1, half: Math.ceil(m / 2),
      inserts: inserts, deletes: deletes,
    };
  },

  /* ---------------- ② 纯算法：插入分裂 + 删除借位/合并 全量快照 ---------------- */
  buildSnapshots(model) {
    const m = model.m, maxKeys = model.maxKeys, minKeys = model.minKeys, half = model.half;
    const inserts = model.inserts, deletes = model.deletes;
    const seq = { n: 0 };
    let root = _btNew(true, seq);

    const snaps = [];
    const st = { insDone: 0, delDone: 0, curKey: null, phase: 'insert' };
    const nh = {};                       // 结点级高亮
    const kh = {};                       // 关键字级高亮："id:key"
    let path = [];                       // 结点引用数组（push 时转成 id）

    const clearHot = function () {
      Object.keys(nh).forEach(function (k) { delete nh[k]; });
      Object.keys(kh).forEach(function (k) { delete kh[k]; });
    };
    const push = function (step, o) {
      const base = {
        step: step,
        tree: _btClone(root),
        path: path.map(function (n) { return n.id; }),
        nh: Object.assign({}, nh),
        kh: Object.assign({}, kh),
        insDone: st.insDone, delDone: st.delDone, curKey: st.curKey, phase: st.phase,
        insAll: inserts.slice(), delAll: deletes.slice(),
        m: m, maxKeys: maxKeys, minKeys: minKeys, half: half,
        keyCount: _btKeyCount(root), nodeCount: _btNodeCount(root), height: _btHeight(root),
        msg: '', log: '', logType: 'info', desc: '',
      };
      snaps.push(Object.assign(base, o || {}));
    };
    /** 关键字级高亮的 key */
    const kk = function (nd, k) { return nd.id + ':' + k; };
    const keysOf = function (nd) { return '[' + nd.keys.join(' , ') + ']'; };

    /* ---------------- init ---------------- */
    push('init', {
      msg: '空树。' + m + ' 阶 B 树：每个结点最多 ' + maxKeys + ' 个关键字、非根最少 ' + minKeys +
        ' 个（根可只有 1 个）；插入一律落在叶结点，叶结点溢出就分裂。',
      log: '就绪：' + m + ' 阶 B 树（关键字上限 ' + maxKeys + ' / 非根下限 ' + minKeys + '）',
      desc: '插入序列：' + inserts.join(' → ') + (deletes.length ? '；删除序列：' + deletes.join(' → ') : '（只插入）'),
    });

    /* ---------------- 插入 ---------------- */
    inserts.forEach(function (k, ii) {
      st.phase = 'insert';
      st.curKey = k;
      clearHot();

      /* ① 从根下沉，找插入位置 */
      const dpath = [];
      let nd = root;
      let ci = 0;
      for (;;) {
        dpath.push(nd);
        ci = _btLower(nd.keys, k);
        path = dpath;
        push('search', {
          msg: '在第 ' + dpath.length + ' 层结点 ' + (nd.keys.length ? keysOf(nd) : '（空）') +
            ' 中比较：' + k + (nd.leaf ? ' → 落到叶结点，准备插入' :
              ' → 落在第 ' + (ci + 1) + ' 个分支（' + (ci === 0 ? '＜' + nd.keys[0] : '＞' + nd.keys[ci - 1]) + '）'),
          log: '查找 ' + k + '：访问结点 ' + keysOf(nd) + '，走第 ' + (ci + 1) + ' 个分支',
          desc: '插入第 ' + (ii + 1) + ' 个关键字 ' + k + '：B 树插入一定发生在最底层叶结点',
        });
        if (nd.leaf) break;
        nd = nd.kids[ci];
      }

      /* ② 插入到叶结点 */
      nd.keys.splice(ci, 0, k);
      kh[kk(nd, k)] = 'new';
      path = dpath;
      push('insert', {
        msg: '把 ' + k + ' 插入叶结点 → ' + keysOf(nd) + '（当前 ' + nd.keys.length +
          ' 个关键字，上限 ' + maxKeys + '）',
        log: '插入 ' + k + ' 到叶结点 → ' + keysOf(nd),
        logType: 'success',
        desc: nd.keys.length > maxKeys ? '关键字数达到 ' + nd.keys.length + '，超过上限 ' + maxKeys + ' → 下一步必须分裂'
          : '未超上限，本趟插入结束',
      });

      /* ③ 溢出 → 分裂，向上传播 */
      let di = dpath.length - 1;
      while (dpath[di].keys.length > maxKeys) {
        const cur = dpath[di];
        clearHot();
        nh[cur.id] = 'overflow';
        cur.keys.forEach(function (kv) { kh[kk(cur, kv)] = 'over'; });
        path = dpath.slice(0, di + 1);
        push('overflow', {
          msg: '结点 ' + keysOf(cur) + ' 有 ' + cur.keys.length + ' 个关键字 > 上限 ' + maxKeys +
            '，溢出，必须分裂',
          log: '溢出：结点 ' + keysOf(cur) + '（' + cur.keys.length + ' 个关键字）',
          logType: 'warn',
          desc: '分裂规则：取第 ⌊m/2⌋+1 个关键字（下标 ⌊m/2⌋=' + Math.floor(m / 2) + '）上升到父结点',
        });

        const mid = Math.floor(m / 2);
        const up = cur.keys[mid];
        const right = {
          id: seq.n++, keys: cur.keys.slice(mid + 1),
          kids: cur.leaf ? [] : cur.kids.slice(mid + 1), leaf: cur.leaf,
        };
        cur.keys = cur.keys.slice(0, mid);
        if (!cur.leaf) cur.kids = cur.kids.slice(0, mid + 1);

        const par = di > 0 ? dpath[di - 1] : null;
        clearHot();
        nh[cur.id] = 'split';
        nh[right.id] = 'split';
        if (par) {
          const pi = par.kids.indexOf(cur);
          par.keys.splice(pi, 0, up);
          par.kids.splice(pi + 1, 0, right);
          kh[kk(par, up)] = 'up';
          path = dpath.slice(0, di + 1);
          push('split', {
            msg: '分裂：中间关键字 ' + up + ' 上升到父结点 → 父结点 ' + keysOf(par) +
              '；左右两半成为 ' + keysOf(cur) + ' 与 ' + keysOf(right),
            log: '分裂：' + up + ' 上升到父结点 ' + keysOf(par),
            logType: 'warn',
            desc: par.keys.length > maxKeys ? '父结点也达到 ' + par.keys.length + ' 个关键字 → 分裂继续向上传播'
              : '父结点未溢出，分裂结束',
          });
        } else {
          const nr = { id: seq.n++, keys: [up], kids: [cur, right], leaf: false };
          root = nr;
          dpath.unshift(nr);
          di = 0;
          kh[kk(nr, up)] = 'up';
          path = [nr];
          push('split', {
            msg: '根结点分裂：' + up + ' 成为新的根 → 新根 ' + keysOf(nr) + '，树高 +1',
            log: '根分裂：' + up + ' 上升为新根，树高 +1（B 树长高的唯一途径）',
            logType: 'warn',
            desc: 'B 树长高的唯一途径就是"根溢出后分裂产生新根"',
          });
          break;
        }
        di--;
      }
      st.insDone = ii + 1;
      clearHot();
      path = [];
      push('settled', {
        msg: '关键字 ' + k + ' 插入完成。当前：' + _btKeyCount(root) + ' 个关键字、' +
          _btNodeCount(root) + ' 个结点、树高 ' + _btHeight(root),
        log: '第 ' + (ii + 1) + ' 个关键字 ' + k + ' 插入完成',
        logType: 'info',
        desc: '已插入 ' + (ii + 1) + ' / ' + inserts.length + ' 个关键字',
      });
    });

    /* ---------------- 删除 ---------------- */
    deletes.forEach(function (k, ii) {
      st.phase = 'delete';
      st.curKey = k;
      clearHot();

      /* ① 查找关键字所在结点 */
      const dpath = [];
      let nd = root;
      let ci = 0;
      let found = false;
      for (;;) {
        dpath.push(nd);
        ci = _btLower(nd.keys, k);
        path = dpath;
        push('search', {
          msg: '查找待删关键字 ' + k + '：在第 ' + dpath.length + ' 层结点 ' +
            (nd.keys.length ? keysOf(nd) : '（空）') + ' 中比较' +
            (nd.keys[ci] === k ? ' → 命中' : nd.leaf ? ' → 未命中' : ' → 继续下沉'),
          log: '删除 ' + k + '：查找经过结点 ' + keysOf(nd),
          desc: '删除时若关键字在非叶结点，要先拿前驱 / 后继顶替，再回到叶结点去删',
        });
        if (nd.keys[ci] === k) { found = true; break; }
        if (nd.leaf) break;
        nd = nd.kids[ci];
      }
      if (!found) {
        clearHot();
        path = [];
        push('err', {
          msg: '关键字 ' + k + ' 不在树中（查找失败），跳过本次删除',
          log: '删除 ' + k + ' 失败：树中没有该关键字',
          logType: 'error',
          desc: '删除不存在的关键字属于"查找失败"，不会影响 B 树结构',
        });
        return;
      }

      /* ② 非叶结点：用前驱（左子树最右下关键字）顶替。★ 先摘叶、再顶替，
       *    同一个快照里绝不出现"一个关键字两处"（否则树暂时不满足范围约束，看着像 bug） */
      let tpath = dpath.slice();
      if (!nd.leaf) {
        let t = nd.kids[ci];
        const cp = dpath.concat([t]);
        while (!t.leaf) { t = t.kids[t.kids.length - 1]; cp.push(t); }
        const pred = t.keys[t.keys.length - 1];
        t.keys.pop();
        nd.keys[ci] = pred;
        tpath = cp;
        clearHot();
        nh[nd.id] = 'borrow';
        if (t.keys.length < minKeys) nh[t.id] = 'underflow';
        kh[kk(nd, pred)] = 'up';
        path = cp;
        push('replace', {
          msg: '关键字 ' + k + ' 在非叶结点上：把左子树的最大关键字（前驱）' + pred + ' 搬到它的位置 → ' +
            keysOf(nd) + '；叶结点同时摘掉 ' + pred + ' → ' + (t.keys.length ? keysOf(t) : '（空结点）'),
          log: '非叶关键字 ' + k + ' → 用前驱 ' + pred + ' 顶替（前驱已从叶结点摘除）',
          logType: 'warn',
          desc: t.keys.length < minKeys
            ? '前驱所在叶结点只剩 ' + t.keys.length + ' 个关键字（下限 ' + minKeys + '）→ 下溢，接着借位或合并'
            : '前驱 = 左子树中最大的关键字；顶替后问题转化为"删叶结点关键字"',
        });
      } else {
        /* ③ 关键字就在叶结点：直接摘除 */
        const ki = nd.keys.indexOf(k);
        nd.keys.splice(ki, 1);
        clearHot();
        nh[nd.id] = nd.keys.length < minKeys ? 'underflow' : 'merge';
        path = tpath;
        push('remove', {
          msg: '从叶结点删除 ' + k + ' → ' + (nd.keys.length ? keysOf(nd) : '（空结点）') +
            '，当前 ' + nd.keys.length + ' 个关键字（下限 ' + minKeys + '）',
          log: '删除叶结点关键字 ' + k + ' → ' + (nd.keys.length ? keysOf(nd) : '（空）'),
          logType: 'success',
          desc: nd.keys.length < minKeys ? '关键字数低于下限 ' + minKeys + ' → 下溢，需要借位或合并'
            : '未下溢，删除结束',
        });
      }

      /* ④ 下溢修复：先借后合，向上传播 */
      let p = tpath.slice();
      for (;;) {
        const node = p[p.length - 1];
        if (node.keys.length >= minKeys) break;
        const par = p.length > 1 ? p[p.length - 2] : null;
        if (!par) {
          if (!node.leaf && node.keys.length === 0) {
            root = node.kids[0];
            clearHot();
            path = [root];
            push('shrink', {
              msg: '根结点被摘空 → 唯一的孩子 ' + keysOf(root) + ' 成为新根，树高 −1',
              log: '根被摘空：树高 −1（B 树降高的唯一途径）',
              logType: 'warn',
              desc: 'B 树降高的唯一途径就是"根空了，让孩子当根"',
            });
          }
          break;
        }
        clearHot();
        nh[node.id] = 'underflow';
        path = p;
        push('underflow', {
          msg: '结点 ' + (node.keys.length ? keysOf(node) : '（空）') + ' 只有 ' + node.keys.length +
            ' 个关键字 < 下限 ' + minKeys + '，下溢，需要向兄弟借或与兄弟合并',
          log: '下溢：结点 ' + (node.keys.length ? keysOf(node) : '（空）') + '（' + node.keys.length + ' 个关键字）',
          logType: 'warn',
          desc: '修复顺序：① 兄弟富余 → 借；② 兄弟也不富余 → 与兄弟合并，父结点关键字下移',
        });

        clearHot();
        const pidx = par.kids.indexOf(node);
        const L = pidx > 0 ? par.kids[pidx - 1] : null;
        const R = pidx + 1 < par.kids.length ? par.kids[pidx + 1] : null;

        if (L && L.keys.length > minKeys) {
          const down = par.keys[pidx - 1];
          par.keys[pidx - 1] = L.keys.pop();
          node.keys.unshift(down);
          if (!node.leaf) node.kids.unshift(L.kids.pop());
          nh[L.id] = 'borrow';
          nh[par.id] = 'borrow';
          nh[node.id] = 'borrow';
          kh[kk(node, down)] = 'up';
          path = p;
          push('borrow', {
            msg: '向左兄弟借：父关键字 ' + down + ' 下移到本结点，左兄弟最大关键字 ' + par.keys[pidx - 1] +
              ' 上移到父结点 → 本结点 ' + keysOf(node) + '，父结点 ' + keysOf(par),
            log: '借位（向左兄弟）：' + down + ' 下移，' + par.keys[pidx - 1] + ' 上移',
            logType: 'success',
            desc: '借位只搬运关键字，不改变结点个数，树高不变',
          });
          break;
        }
        if (R && R.keys.length > minKeys) {
          const down2 = par.keys[pidx];
          par.keys[pidx] = R.keys.shift();
          node.keys.push(down2);
          if (!node.leaf) node.kids.push(R.kids.shift());
          nh[R.id] = 'borrow';
          nh[par.id] = 'borrow';
          nh[node.id] = 'borrow';
          kh[kk(node, down2)] = 'up';
          path = p;
          push('borrow', {
            msg: '向右兄弟借：父关键字 ' + down2 + ' 下移到本结点，右兄弟最小关键字 ' + par.keys[pidx] +
              ' 上移到父结点 → 本结点 ' + keysOf(node) + '，父结点 ' + keysOf(par),
            log: '借位（向右兄弟）：' + down2 + ' 下移，' + par.keys[pidx] + ' 上移',
            logType: 'success',
            desc: '借位只搬运关键字，不改变结点个数，树高不变',
          });
          break;
        }

        let leftN, rightN, sepi;
        if (L) { leftN = L; rightN = node; sepi = pidx - 1; }
        else { leftN = node; rightN = R; sepi = pidx; }
        const sep = par.keys[sepi];
        leftN.keys = leftN.keys.concat([sep], rightN.keys);
        leftN.kids = leftN.kids.concat(rightN.kids);
        par.keys.splice(sepi, 1);
        par.kids.splice(sepi + 1, 1);
        clearHot();
        nh[leftN.id] = 'merge';
        nh[par.id] = 'merge';
        path = p.slice(0, -1).concat([leftN]);
        push('merge', {
          msg: '兄弟也不富余 → 合并：父关键字 ' + sep + ' 下移，与' + (L ? '左' : '右') +
            '兄弟并成一个结点 ' + keysOf(leftN) + '；父结点变为 ' + keysOf(par),
          log: '合并：父关键字 ' + sep + ' 下移，合并后 ' + keysOf(leftN),
          logType: 'warn',
          desc: '合并会让父结点少一个关键字——父结点可能因此下溢，修复继续向上传播',
        });
        p = p.slice(0, -1);
      }
      st.delDone = ii + 1;
      clearHot();
      path = [];
      push('settled', {
        msg: '关键字 ' + k + ' 删除完成。当前：' + _btKeyCount(root) + ' 个关键字、' +
          _btNodeCount(root) + ' 个结点、树高 ' + _btHeight(root),
        log: '第 ' + (ii + 1) + ' 个关键字 ' + k + ' 删除完成',
        logType: 'info',
        desc: '已删除 ' + (ii + 1) + ' / ' + deletes.length + ' 个关键字',
      });
    });

    /* ---------------- done ---------------- */
    clearHot();
    path = [];
    const N = _btKeyCount(root);
    const h = _btHeight(root);
    const bd = _btBounds(m, N);
    push('done', {
      msg: '全部操作完成：' + N + ' 个关键字、' + _btNodeCount(root) + ' 个结点、树高 ' + h +
        '（' + m + ' 阶 B 树含 ' + N + ' 个关键字时高度只能是 ' + bd.hMin + ' ~ ' + bd.hMax + ' 层）',
      log: '完成：' + N + ' 个关键字，树高 ' + h + '，高度允许范围 ' + bd.hMin + ' ~ ' + bd.hMax,
      logType: 'success',
      desc: '叶结点全部在第 ' + h + ' 层——无论怎么插删，B 树始终保持"绝对平衡"',
      final: true,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const s = ctx.snap;
    const stage = ctx.stage;
    const m = s.m, maxKeys = s.maxKeys, minKeys = s.minKeys;
    const tree = s.tree;
    const empty = !tree || (tree.keys.length === 0 && tree.kids.length === 0);

    /* ---------- 布局：叶结点依次排开，内部结点居中于其孩子 ---------- */
    const CELL = 44, NH = 36, PAD = 12, VGAP = 86, HGAP = 20, TOP = 30;
    const recs = new Map();
    const order = [];
    let cursor = 0;
    (function place(nd, depth) {
      const w = Math.max(nd.keys.length, 1) * CELL + PAD * 2;
      const rec = { id: nd.id, keys: nd.keys, leaf: nd.leaf, depth: depth, w: w, x: 0, y: 0 };
      recs.set(nd, rec);
      order.push(rec);
      if (nd.leaf) {
        rec.x = cursor + w / 2;
        cursor += w + HGAP;
      } else {
        nd.kids.forEach(function (c) { place(c, depth + 1); });
        const f = recs.get(nd.kids[0]);
        const l = recs.get(nd.kids[nd.kids.length - 1]);
        rec.x = (f.x + l.x) / 2;
      }
      rec.y = NH / 2 + TOP + depth * VGAP;
    })(tree, 0);

    let minL = Infinity, maxR = -Infinity, maxD = 0;
    order.forEach(function (r) {
      minL = Math.min(minL, r.x - r.w / 2);
      maxR = Math.max(maxR, r.x + r.w / 2);
      maxD = Math.max(maxD, r.depth);
    });
    const shift = 16 - minL;
    order.forEach(function (r) { r.x += shift; });
    const W = Math.max(maxR + shift + 16, 320);
    /* 顶部留 TOP（"根"字标签画在根结点上方 12px，基线在 y0−12，其 bbox 顶部 ≈ y0−24.7，
       所以 TOP 至少 26 才不越出 viewBox——本窗实测 TOP=20 时越界 4.7px） */
    const H = TOP + NH + 14 + VGAP * maxD;

    const pathSet = new Set(s.path || []);
    const byId = new Map();
    order.forEach(function (r) { byId.set(r.id, r); });

    /* ---------- 边：父 → 子，锚点落在"关键字之间的缝"上 ---------- */
    let edgeSvg = '';
    (function edges(nd) {
      const pr = recs.get(nd);
      if (!nd.leaf) {
        nd.kids.forEach(function (c, j) {
          const cr = recs.get(c);
          const ax = pr.x - pr.w / 2 + PAD + j * CELL;
          const hot = pathSet.has(nd.id) && pathSet.has(c.id);
          edgeSvg += '<line x1="' + ax + '" y1="' + (pr.y + NH / 2) + '" x2="' + cr.x + '" y2="' +
            (cr.y - NH / 2) + '" class="' + (hot ? 'kedge-checking' : 'kedge') + '"/>';
        });
      }
      nd.kids.forEach(edges);
    })(tree);

    /* ---------- 结点 + 关键字高亮 ---------- */
    let nodeSvg = '';
    order.forEach(function (r) {
      const st2 = s.nh[r.id];
      const inPath = pathSet.has(r.id);
      let fill = '#e2e8f0', stroke = '#94a3b8', tw = '#334155';
      if (st2 === 'overflow' || st2 === 'underflow') { fill = '#fee2e2'; stroke = '#ef4444'; tw = '#991b1b'; }
      else if (st2 === 'borrow') { fill = '#dbeafe'; stroke = '#2563eb'; tw = '#1e40af'; }
      else if (st2 === 'merge') { fill = '#fef3c7'; stroke = '#d97706'; tw = '#92400e'; }
      else if (st2 === 'split') { fill = '#d1fae5'; stroke = '#059669'; tw = '#065f46'; }
      else if (inPath) { fill = '#fef9c3'; stroke = '#f59e0b'; tw = '#92400e'; }

      const x0 = r.x - r.w / 2, y0 = r.y - NH / 2;
      if (inPath || st2) {
        const hc = st2 === 'overflow' || st2 === 'underflow' ? '#ef4444'
          : st2 === 'borrow' ? '#2563eb' : st2 === 'merge' ? '#d97706' : st2 === 'split' ? '#059669' : '#f59e0b';
        nodeSvg += '<rect x="' + (x0 - 3) + '" y="' + (y0 - 3) + '" width="' + (r.w + 6) + '" height="' +
          (NH + 6) + '" rx="11" class="knode-halo" style="stroke:' + hc + '"/>';
      }
      nodeSvg += '<rect x="' + x0 + '" y="' + y0 + '" width="' + r.w + '" height="' + NH +
        '" rx="8" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.5"/>';
      r.keys.forEach(function (k, i) {
        const cx = x0 + PAD + i * CELL;
        if (i > 0) {
          nodeSvg += '<line x1="' + cx + '" y1="' + (y0 + 5) + '" x2="' + cx + '" y2="' + (y0 + NH - 5) +
            '" stroke="' + stroke + '" stroke-width="1.2" opacity=".45"/>';
        }
        const khot = s.kh[r.id + ':' + k];
        if (khot) {
          const kc = khot === 'new' ? '#86efac' : khot === 'up' ? '#fcd34d' : khot === 'del' ? '#fca5a5' : '#fecaca';
          nodeSvg += '<rect x="' + (cx + 1.5) + '" y="' + (y0 + 3) + '" width="' + (CELL - 3) + '" height="' +
            (NH - 6) + '" rx="4" fill="' + kc + '" opacity=".85"/>';
        }
        nodeSvg += '<text x="' + (cx + CELL / 2) + '" y="' + r.y + '" dy="0.35em" class="knode-text" style="fill:' +
          (khot ? '#1e293b' : tw) + ';font-size:15px">' + k + '</text>';
      });
      if (!r.keys.length) {
        nodeSvg += '<text x="' + r.x + '" y="' + r.y + '" dy="0.35em" class="knode-text" style="fill:#94a3b8;font-size:12px">空</text>';
      }
      if (r.depth === 0 && order.length > 1) {
        nodeSvg += '<text x="' + r.x + '" y="' + (y0 - 12) + '" text-anchor="middle" style="font:700 11px sans-serif;fill:#7c3aed">根</text>';
      }
    });

    /* ---------- 统计（全部可由公式独立核对） ---------- */
    const N = s.keyCount, h = s.height;
    const bd = _btBounds(m, N);
    const kr = _btKeyRangeOfHeight(m, h);
    const maxNodesOfH = h <= 0 ? 0 : 2 * Math.pow(Math.ceil(m / 2), h - 1) - 1;
    const stats =
      RC408.ui.statCard('关键字数 / 结点数', N + ' / ' + s.nodeCount,
        m + ' 阶 · 非根关键字数 ' + minKeys + ' ~ ' + maxKeys + '（根 ≥ 1）') +
      RC408.ui.statCard('当前树高 h', empty ? '—' : String(h),
        empty ? '空树' : '含 ' + N + ' 个关键字时 h 只能是 ' + bd.hMin + ' ~ ' + bd.hMax + ' 层', 'text-indigo-600') +
      RC408.ui.statCard('h 层关键字数范围', empty ? '—' : '[' + kr.lo + ' , ' + kr.hi + ']',
        empty ? '空树' : '下限 1+2(⌈m/2⌉^' + (h - 1) + '−1)，上限 m^' + h + '−1', 'text-emerald-600') +
      RC408.ui.statCard('h 层最多结点数', empty ? '—' : String(maxNodesOfH),
        empty ? '空树' : '2⌈m/2⌉^' + (h - 1) + '−1（每个结点只放下限个关键字）', 'text-amber-600');

    /* ---------- 操作序列芯片 ---------- */
    const chipRun = function (arr, doneCount, curKey) {
      if (!arr.length) return '<span class="text-xs text-slate-400">（无）</span>';
      return arr.map(function (k, i) {
        const isCur = curKey !== null && curKey !== undefined && k === curKey;
        const cls = i < doneCount ? 'chip-mst' : isCur ? 'chip-cur' : 'chip-future';
        return RC408.ui.chip(k, cls, i < doneCount ? '已完成' : isCur ? '正在处理' : '待处理');
      }).join('<span class="text-slate-300 self-center">→</span>');
    };
    const insHtml = RC408.ui.sectionTitle('插入序列（已完成 ' + s.insDone + ' / ' + s.insAll.length + '）') +
      '<div class="flex flex-wrap gap-1.5 items-center">' +
      chipRun(s.insAll, s.insDone, s.phase === 'insert' ? s.curKey : null) + '</div>';
    const delHtml = s.delAll.length ? RC408.ui.sectionTitle('删除序列（已完成 ' + s.delDone + ' / ' + s.delAll.length + '）') +
      '<div class="flex flex-wrap gap-1.5 items-center">' +
      chipRun(s.delAll, s.delDone, s.phase === 'delete' ? s.curKey : null) + '</div>' : '';

    /* ---------- 当前动作提示 ---------- */
    const tone = {
      init: ['bg-slate-50 border-slate-200', 'text-slate-700'],
      search: ['bg-amber-50 border-amber-200', 'text-amber-800'],
      insert: ['bg-emerald-50 border-emerald-200', 'text-emerald-800'],
      overflow: ['bg-rose-50 border-rose-200', 'text-rose-800'],
      split: ['bg-emerald-50 border-emerald-200', 'text-emerald-800'],
      replace: ['bg-amber-50 border-amber-200', 'text-amber-800'],
      remove: ['bg-emerald-50 border-emerald-200', 'text-emerald-800'],
      underflow: ['bg-rose-50 border-rose-200', 'text-rose-800'],
      borrow: ['bg-blue-50 border-blue-200', 'text-blue-800'],
      merge: ['bg-amber-50 border-amber-200', 'text-amber-800'],
      shrink: ['bg-violet-50 border-violet-200', 'text-violet-800'],
      settled: ['bg-slate-50 border-slate-200', 'text-slate-700'],
      done: ['bg-emerald-50 border-emerald-200', 'text-emerald-800'],
      err: ['bg-rose-50 border-rose-200', 'text-rose-800'],
    }[s.step] || ['bg-slate-50 border-slate-200', 'text-slate-700'];
    const banner = '<div class="rounded-xl border ' + tone[0] + ' px-3 py-2.5 text-sm ' + tone[1] +
      '"><span class="font-bold mr-1.5">' + s.step.toUpperCase() + '</span>' + s.msg + '</div>';

    /* ---------- 阶段要点 ---------- */
    const tipMap = {
      search: '下沉选择分支时，比较次数 = 经过的结点数（不是关键字数）；插入的落点永远是叶结点。',
      insert: '插入后若关键字数 > m−1 就要分裂；未超上限则本趟结束。',
      overflow: '分裂位置固定：第 ⌊m/2⌋+1 个关键字上升（下标 ⌊m/2⌋），左右各成一半。',
      split: '分裂向上传播；只有"根溢出"才会产生新根并使树高 +1。',
      replace: '非叶结点删除：先用前驱（左子树最右下）或后继顶替，问题转化为"删叶结点关键字"。',
      remove: '叶结点删完若关键字数 < ⌈m/2⌉−1 就是下溢，必须借位或合并。',
      underflow: '先看左右兄弟：有富余就借；都没有富余才合并（合并会把父关键字拉下来）。',
      borrow: '借位移动关键字与孩子指针，结点个数不变 → 树高不变。',
      merge: '合并使父结点少一个关键字，可能连锁下溢；根被摘空时树高 −1。',
      shrink: '降高的唯一途径：根空了，让唯一的孩子当新根。',
      settled: '一个关键字处理完毕；留意右侧"关键字数 / 树高"的变化，再用公式核对一遍。',
      done: '无论怎么插删，所有叶结点始终在同一层（绝对平衡）。',
      init: '先想清楚 m 阶 B 树的关键字上下限，再动手插入。',
      err: '查找失败不改变结构。',
    };

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        ${banner}

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          ${empty
        ? '<div class="text-center text-slate-400 text-sm py-12">（空树：' + m + ' 阶 B 树的根结点最多 ' + maxKeys + ' 个关键字；插入第 1 个关键字即可开始）</div>'
        : '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full h-auto mx-auto" style="max-width:' + Math.max(W, 480) + 'px">' +
        edgeSvg + nodeSvg + '</svg>'}
        </div>

        ${insHtml}
        ${delHtml}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '查找路径经过的结点')}
          ${RC408.ui.legend('#ef4444', '溢出 / 下溢（超限，必须分裂或调整）')}
          ${RC408.ui.legend('#10b981', '分裂产生的新结点')}
          ${RC408.ui.legend('#2563eb', '参与借位的结点')}
          ${RC408.ui.legend('#d97706', '参与合并的结点')}
        </div>

        <div class="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-600">
          <span class="font-bold text-slate-700">本步要点：</span>${tipMap[s.step] || ''}
        </div>

        <div class="rounded-2xl border border-violet-200 bg-violet-50/40 p-3">
          <div class="text-[11px] font-bold text-violet-500 tracking-widest mb-2">B+ 树结构示意（与上面的 B 树对照）</div>
          ${_btBplusSvg()}
        </div>
      </div>`;
  },
});
