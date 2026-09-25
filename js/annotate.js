'use strict';
/* ============================================================================
 * annotate.js —— 理论区「手动标注」（用户 2026-09-25 窗24 要求）
 * ----------------------------------------------------------------------------
 * 交互（用户原话）：理论卡头部有个按钮，**单击开启标注模式**；开启后用**鼠标左键拖选**
 *   文本，**松开左键**后选中的文字变红；**红色文字被再选一次则恢复原色**（开关式）。
 *   另有一个「清空标注」（两击确认）入口，清空**当前知识点**的全部标注。
 *
 * ★ 数据模型（唯一事实源，存 localStorage 的 `rc408.anno.v1`）：
 *     { '<知识点id>': [ { b, s, e }, ... ] }
 *   · b = `#theory-body` **直接子元素**的下标（**跳过 `.exam-strip` 分布条**，它不参与标注）
 *   · s / e = 该块内**文本字符区间** [s, e)（半开区间）
 *   ⟹ 只要"块结构 + 文字内容"不变，偏移量就一直有效。
 *
 * ★ 三条不变量（本模块全部断言都围着它们写，见 tmp_t24_anno_smoke.js / tmp_t24_anno_harness.js）：
 *   ① **只加/去 `<span class="kp-anno">`，绝不增删文字**：标注与取消都会复原
 *      `block.textContent`（长度与内容逐字不变）⟹ 偏移量永不失效、反复标注幂等；
 *   ② **只改颜色、不写字重**（`.kp-anno` 的 CSS 里只有 `color`）⟹ 原本在 `**加粗**`
 *      里的字标红后**仍是粗体**（用户明确要求"粗细和原先一致"）；
 *   ③ **公式子树不参与**（KaTeX 的 `.katex` 与离线兜底的 `.md-math` 在"测量/应用"两侧
 *      都跳过）——否则会把公式内部切开、显示崩掉；中文不进数学环境（`doc_check` 保证）。
 *
 * ★ 为什么用"块下标 + 字符偏移"而不是直接搬 DOM：
 *   `Range.extractContents()` 在跨 `<td>` / 跨 `<li>` 时会克隆出非法嵌套（表格里套表格）。
 *   这里改用"只遍历文本节点、就地 splitText 包一层 span"，**永不产生非法结构**。
 *
 * ⚠ 已知边界（都写进手册，别当 bug）：
 *   · 分布条（`.exam-strip`）与公式（`.katex` / `.md-math`）**标不上**——拖过它们时那一段跳过；
 *   · 触屏点选不产生 `mouseup`-选区，故不生效（键盘 Shift 选择同理，本版不做）；
 *   · 标注模式**不持久化**（刷新后默认关闭），标注内容持久化；
 *   · `localStorage` 不可用（隐私模式 / 某些 `file://` 策略）时**自动退化为"仅当次会话"**，
 *     读写都 try/catch 兜底，绝不抛错打断渲染。
 *
 * ★ 知识点 id 从哪来（窗24 收尾修掉的一个真 bug）：**一律取 `RC408.Runner.topicId`**
 *   （`framework.js` 的 `open()` 每次都写），**不要只信本模块记住的 `currentId`**——
 *   它只在"渲染后调过 `apply()` 的分支"里更新；若某个渲染路径没调，在那一页标注就会**挂到
 *   上一个知识点的 id 上**（等于污染另一张卡的红字）。见 `curId()`。
 * ========================================================================== */

RC408.anno = (function () {
  const KEY = 'rc408.anno.v1';
  const CLASS = 'kp-anno';

  /* ======================= 一、纯函数：区间运算（Node 侧可单独冒烟） ======================= */

  /** 规范化：丢掉空区间、按 (块, 起点) 排序、把同块内相接/重叠的区间并起来 */
  function normalize(list) {
    const arr = (list || [])
      .filter(r => r && typeof r.b === 'number' && typeof r.s === 'number' && typeof r.e === 'number')
      .filter(r => r.e > r.s && r.b >= 0)
      .map(r => ({ b: r.b, s: r.s, e: r.e }))
      .sort((x, y) => (x.b - y.b) || (x.s - y.s));
    const out = [];
    for (const r of arr) {
      const last = out[out.length - 1];
      if (last && last.b === r.b && r.s <= last.e) { if (r.e > last.e) last.e = r.e; }
      else out.push({ b: r.b, s: r.s, e: r.e });
    }
    return out;
  }

  /** 并：把 seg 加进去 */
  function union(list, seg) { return normalize(normalize(list).concat([seg])); }

  /** 差：从 list 里抠掉 seg（seg 落在区间中间时会拆成两条） */
  function subtract(list, seg) {
    const out = [];
    for (const r of normalize(list)) {
      if (r.b !== seg.b || r.e <= seg.s || r.s >= seg.e) { out.push(r); continue; }
      if (r.s < seg.s) out.push({ b: r.b, s: r.s, e: seg.s });
      if (r.e > seg.e) out.push({ b: r.b, s: seg.e, e: r.e });
    }
    return normalize(out);
  }

  /** 整段是否已被标红（用户说的"红色文本被再选一次"就是它） */
  function isCovered(list, seg) {
    for (const r of normalize(list)) {
      if (r.b === seg.b && r.s <= seg.s && r.e >= seg.e) return true;
    }
    return false;
  }

  /** 一次拖选的最终结果：**逐段**判断——整段已红则抠掉，否则涂红
   *  ★ 混合选区的口径（窗24 定，写在代码里免得下一窗当 bug 改）：选中的一段里
   *    **只要不是全红**（含"半红半黑"）就**整段涂红** —— 这样用户才能靠拖选把已有标注**扩长**；
   *    扩长之后再整段选一次才会全部恢复。若改成"混合就削红"，标注就永远只能变小、扩不动。 */
  function plan(existing, segs) {
    let out = normalize(existing);
    for (const seg of segs) out = isCovered(out, seg) ? subtract(out, seg) : union(out, seg);
    return out;
  }

  /* ======================= 二、存储（读写都兜底，坏数据一律当空） ======================= */

  function store() { try { return window.localStorage; } catch (e) { return null; } }

  function loadAll() {
    const s = store();
    if (!s) return {};
    let o = null;
    try { o = JSON.parse(s.getItem(KEY) || '{}'); } catch (e) { o = null; }
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  }

  function saveAll(o) {
    const s = store();
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }

  function getRanges(id) { const o = loadAll(); return Array.isArray(o[id]) ? normalize(o[id]) : []; }

  function setRanges(id, list) {
    if (!id) return;
    const o = loadAll();
    const clean = normalize(list);
    if (clean.length) o[id] = clean; else delete o[id];
    saveAll(o);
  }

  /* ======================= 三、DOM 侧：块枚举 / 偏移测量 / 应用 ======================= */

  /** 参与标注的块 = `#theory-body` 的直接子元素，**排除分布条** */
  function blocks(body) {
    const out = [];
    const kids = (body && body.children) || [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains('exam-strip')) continue;
      out.push(kids[i]);
    }
    return out;
  }

  /** 不参与标注的子树：公式（两种产物）与分布条 */
  function isSkip(el) {
    const c = el && el.classList;
    return !!(c && (c.contains('katex') || c.contains('md-math') || c.contains('exam-strip')));
  }

  /** 块内全部"可标注文本节点"（文档顺序，跳过公式子树） */
  function textNodes(block) {
    const out = [];
    (function walk(node) {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 3) { if (ch.nodeValue) out.push(ch); continue; }
        if (ch.nodeType !== 1 || isSkip(ch)) continue;
        walk(ch);
      }
    })(block);
    return out;
  }

  /** 节点/片段里"可标注文字"的总长度（与 textNodes 同一口径，必须一致） */
  function textLen(root) {
    if (!root) return 0;
    if (root.nodeType === 3) return root.nodeValue ? root.nodeValue.length : 0;
    if (root.nodeType !== 1 && root.nodeType !== 11) return 0;
    if (root.nodeType === 1 && isSkip(root)) return 0;
    let n = 0;
    for (let ch = root.firstChild; ch; ch = ch.nextSibling) n += textLen(ch);
    return n;
  }

  /** 端点 (node, offset) 在 block 内的字符偏移；不在这个块里返回 -1 */
  function offsetOfPoint(block, node, offset) {
    if (!node) return -1;
    if (node.nodeType === 3) {
      const list = textNodes(block);
      let acc = 0;
      for (const t of list) {
        if (t === node) return acc + Math.min(offset, t.nodeValue.length);
        acc += t.nodeValue.length;
      }
      return -1;
    }
    if (node === block || block.contains(node)) {
      const r = document.createRange();
      r.selectNodeContents(block);
      try { r.setEnd(node, offset); } catch (e) { return -1; }
      return textLen(r.cloneContents());
    }
    return -1;
  }

  /** 端点所在的块下标（相对 blocks() 数组；分布条 / 块外一律 -1） */
  function blockIndexOf(body, node) {
    if (!node || node === body) return -1;
    let el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el.parentNode !== body) el = el.parentNode;
    if (!el) return -1;
    return blocks(body).indexOf(el);
  }

  /** 把一次选区翻译成 [{b,s,e}]（跨块自动逐块切分） */
  function measure(body, range) {
    const bs = blocks(body);
    if (!bs.length || !range) return [];
    const startAtBody = range.startContainer === body;
    const endAtBody = range.endContainer === body;
    const sb = startAtBody ? 0 : blockIndexOf(body, range.startContainer);
    const eb = endAtBody ? bs.length - 1 : blockIndexOf(body, range.endContainer);
    if (sb < 0 || eb < 0 || eb < sb) return [];
    const out = [];
    for (let i = sb; i <= eb; i++) {
      const blk = bs[i];
      const full = textLen(blk);
      let s = (i === sb) ? (startAtBody ? 0 : offsetOfPoint(blk, range.startContainer, range.startOffset)) : 0;
      let e = (i === eb) ? (endAtBody ? full : offsetOfPoint(blk, range.endContainer, range.endOffset)) : full;
      if (s < 0) s = 0;
      if (e < 0 || e > full) e = full;
      if (e > s) out.push({ b: i, s: s, e: e });
    }
    return out;
  }

  /** 把一个文本节点里的 [from,to) 就地包一层 span（右段先 split，左侧偏移不受影响） */
  function wrapPart(node, from, to) {
    const t = node.splitText(from);
    t.splitText(to - from);
    const span = document.createElement('span');
    span.className = CLASS;
    t.parentNode.insertBefore(span, t);
    span.appendChild(t);
  }

  /** 在块内给 [s,e) 上色；跨多个文本节点时逐节点包（文字一字不动） */
  function wrapRange(block, s, e) {
    let acc = 0, made = 0;
    for (const node of textNodes(block)) {
      const len = node.nodeValue.length;
      const a = Math.max(s, acc), b = Math.min(e, acc + len);
      acc += len;
      if (b > a) { wrapPart(node, a - (acc - len), b - (acc - len)); made++; }
    }
    return made;
  }

  /** 拆掉块内所有标注 span（把子节点搬回原位），并合并相邻文本节点 */
  function unwrap(block) {
    const spans = [].slice.call(block.querySelectorAll('.' + CLASS));
    for (const sp of spans) {
      const p = sp.parentNode;
      if (!p) continue;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp);
    }
    if (block.normalize) block.normalize();
  }

  /** 按数据重画：先全拆、再按区间重包（幂等；这是"取消标注"唯一的还原路径） */
  function apply(id, bodyEl) {
    if (id) currentId = id;
    const body = bodyEl || document.getElementById('theory-body');
    if (!body) return 0;
    const tid = curId();                 // ★ 用真源 id（见下端 curId 的说明）
    const bs = blocks(body);
    for (const b of bs) unwrap(b);
    let n = 0;
    for (const r of getRanges(tid)) {
      const blk = bs[r.b];
      if (blk) n += wrapRange(blk, r.s, r.e);
    }
    syncClear();
    return n;
  }

  /* ======================= 四、交互：模式开关 / 拖选变红 / 清空 ======================= */

  let on = false;          // 标注模式（不持久化：刷新后默认关闭）
  let currentId = null;    // 最近一次渲染的知识点 id（由 framework 的 hook 每次渲染时写入）
  let armed = false;       // "清空标注"的两击确认中间态

  /** ★ 当前知识点 id 的**真源**：框架的 `Runner.topicId`（每次 `open()` 都写）。
   *  只用 `currentId` 不够——它只在"调过 `apply()` 的分支"里更新；某个渲染路径若没调，
   *  在那一页标注就会**挂到上一个知识点的 id 上**（污染另一张卡的红字）。
   *  窗24 收尾时发现并修掉：`Runner.topicId` + 占位页也调 `apply()`，双保险。 */
  function curId() {
    const R = (typeof RC408 !== 'undefined' && RC408.Runner) || null;
    return (R && R.topicId) || currentId;
  }

  function el(id) { return document.getElementById(id); }

  function syncHint() {
    const hint = el('anno-hint');
    const btn = el('anno-toggle');
    if (btn) btn.classList.toggle('anno-on', on);
    if (btn) btn.textContent = on ? '✏️ 标注中' : '✏️ 标注';
    if (hint) hint.classList.toggle('hidden', !on);
    const card = el('theory-body');
    if (card) card.classList.toggle('anno-mode', on);
  }

  function syncClear() {
    const btn = el('anno-clear');
    if (!btn) return;
    const has = getRanges(curId()).length > 0;
    btn.classList.toggle('hidden', !has);
    if (!armed) btn.textContent = '清空本卡';
  }

  function setOn(v) {
    on = !!v;
    armed = false;
    syncHint();
    syncClear();
    if (!on) {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
  }

  /** 松开左键：把当前选区按"已红则还原、否则涂红"应用，然后取消浏览器自身的蓝底选中 */
  function onMouseUp() {
    if (!on) return;
    const body = el('theory-body');
    if (!body) return;
    const tid = curId();
    if (!tid) return;                      // 没有当前知识点就什么都不做（宁可不动，也不写错 id）
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const segs = measure(body, sel.getRangeAt(0));
    if (!segs.length) return;
    setRanges(tid, plan(getRanges(tid), segs));
    apply(tid, body);
    if (sel.removeAllRanges) sel.removeAllRanges();
  }

  function init() {
    const btn = el('anno-toggle');
    if (!btn || btn.dataset.annoBound === '1') return false;
    btn.dataset.annoBound = '1';
    /* 头部整行是"折叠/展开"的点击区 ⟹ 两个按钮都必须 stopPropagation */
    btn.addEventListener('click', e => { e.stopPropagation(); setOn(!on); });
    const clear = el('anno-clear');
    if (clear) clear.addEventListener('click', e => {
      e.stopPropagation();
      const tid = curId();
      if (!tid) return;
      if (!armed) {
        armed = true;
        clear.textContent = '确认清空？';
        setTimeout(() => { armed = false; syncClear(); }, 3000);
        return;
      }
      armed = false;
      setRanges(tid, []);
      apply(tid);
    });
    document.addEventListener('mouseup', onMouseUp);
    syncHint();
    syncClear();
    return true;
  }

  const api = {
    KEY: KEY, CLASS: CLASS,
    /* 纯函数（Node 冒烟直接用） */
    normalize: normalize, union: union, subtract: subtract, isCovered: isCovered, plan: plan,
    /* 存储 */
    loadAll: loadAll, saveAll: saveAll, getRanges: getRanges, setRanges: setRanges,
    /* DOM */
    blocks: blocks, textNodes: textNodes, textLen: textLen, offsetOfPoint: offsetOfPoint,
    measure: measure, apply: apply, unwrap: unwrap, wrapRange: wrapRange,
    /* 交互 */
    init: init, setOn: setOn, isOn: function () { return on; },
    current: function () { return curId(); },
    syncClear: syncClear,
  };

  /* 浏览器里自启（框架的 hook 只负责"每次渲染后重画"，按钮绑定在这里做一次） */
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return api;
})();
