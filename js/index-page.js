'use strict';
/* ============================================================================
 * index-page.js —— 「真题总览（题目-模块索引）」页（窗41 新建）
 * ----------------------------------------------------------------------------
 * 用户需求（2026-10-05）：仿照市面 408 真题系统的"年份 × 题号"矩阵，但**美术风格沿用本平台**，
 *   为网站做一个**题目 → 模块**的索引：点某道题对应的方块，就跳到演示该考点的那一个（几个）模块。
 *   入口是一个**新页签，放在「数据结构」左边**；每次打开网站仍默认显示数据结构的第一个模块。
 *
 * 数据来自两处（都不新造事实）：
 *   ① `js/exam-index-data.js`（生成物）：每年卷面出现过哪些题号 —— 见 `tmp_t41_gen.js`；
 *   ② `js/exam-history.js`（唯一事实源）：每道题**被哪些条目登记过** ⟹ 这就是"点它跳去哪"的映射。
 *      同一道题被 2 个以上条目登记时（实测 72 处）**不替用户选**，弹一个小浮层让他挑。
 *
 * 与平台既有语言的对应关系（**不新造一套配色**）：
 *   · 蓝 = 选择题、红 = 大题 —— 与 `framework.js` 的「历年考察分布条」(`.ex-sel` / `.ex-big`) 同色系；
 *   · 灰色 = 该题不在本年卷面（对应帧的"未考"格）；
 *   · **虚线描边** = 该题还没有模块（与"未登记"同义，点开只给提示，不假装能跳）。
 *
 * 结构：本文件只做三件事 —— prepare()（纯函数，Node 可测）→ render()（拼 HTML）→ mount()（绑交互）。
 *   `RC408.examIndexPage.prepare(D, H, books)` 不碰 DOM，冒烟脚本直接调它。
 * ========================================================================== */

(function () {
  /* 五组列：前四组是固定的选择题题号段（卷面事实），最后是 41–47 的大题。
     组名用平台既有的科目缩写（README / 侧栏 / 理论区都在用），不另起名字。 */
  const GROUPS = [
    { key: 'DS', label: 'DS', full: '数据结构', range: [1, 11] },
    { key: 'COA', label: 'COA', full: '计算机组成原理', range: [12, 22] },
    { key: 'OS', label: 'OS', full: '操作系统', range: [23, 32] },
    { key: 'NET', label: 'NET', full: '计算机网络', range: [33, 40] },
    { key: 'BIG', label: '大题', full: '综合应用题', range: [41, 47] },
  ];
  const SUBJ_OF_BOOK = { ds: 'DS', coa: 'COA', os: 'OS', net: 'NET' };

  /* 考纲外标记：格子中央一个粗红 ×（用户 2026-10-05 给的样式：**无底、笔画粗、圆头**）。
     画成**内联 SVG**（不依赖字体里的 ✕ 字形，也不依赖 Tailwind）：viewBox 24×24 等比铺满格子。
     叉臂两端在 viewBox 内留 3 个单位，靠 CSS 把 SVG 放大到 104% 就刚好铺满格子（见 .ix-x）。 */
  const LEGACY_X = '<svg class="ix-x" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M3.4 3.4 L20.6 20.6 M20.6 3.4 L3.4 20.6" stroke="#e11d48" stroke-width="3.2"'
    + ' stroke-linecap="round" fill="none"/>'
    + '</svg>';
  /* 图例里用的小号红 ×（同样内联 SVG，尺寸交给 CSS） */
  const X_ICON_SMALL = '<svg class="ix-x-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M6 6 L18 18 M18 6 L6 18" stroke="#e11d48" stroke-width="4" stroke-linecap="round" fill="none"/>'
    + '</svg>';

  /* ------------------------------------------------------------------ *
   * prepare —— 纯函数：把"题面数据 + 考情登记 + 目录树"整理成渲染用的模型
   * 入参 D = RC408.examIndex、H = RC408.examHistory、books = RC408.books
   * ------------------------------------------------------------------ */
  function prepare(D, H, books) {
    /* ① 条目登记 → 逐题映射。顺序 = exam-history 里出现的顺序（稳定，不排序）。 */    const qmap = new Map();          // 'y-n' -> [{ id, label, status, bookId }]
    const labelOf = new Map();       // id -> label
    const statusOf = new Map();      // id -> status
    const bookOf = new Map();        // id -> bookId
    (books || []).forEach(b => (b.chapters || []).forEach(c => (c.topics || []).forEach(t => {
      labelOf.set(t.id, t.label);
      statusOf.set(t.id, t.status);
      bookOf.set(t.id, b.id);
    })));
    Object.keys(H || {}).forEach(id => {
      const arr = H[id];
      if (!Array.isArray(arr)) return;
      arr.forEach(e => {
        if (!e || typeof e.y !== 'number' || e.y < 2009 || e.y > 2026) return;
        const nums = String(e.n == null ? '' : e.n).split('·').map(s => s.trim()).filter(Boolean);
        const kinds = String(e.k == null ? '' : e.k).split('');
        nums.forEach((num, i) => {
          if (!/^\d{1,2}$/.test(num)) return;     // 非枚举写法（如"选32 + 大45"）本页不认，跳过
          const kind = kinds.length === nums.length ? kinds[i] : (kinds.length === 1 ? kinds[0] : '选');
          const key = e.y + '-' + num;
          if (!qmap.has(key)) qmap.set(key, []);
          const list = qmap.get(key);
          if (list.some(x => x.id === id)) return;   // 同一条目重复登记同题只留一条
          const bId = bookOf.get(id);
          list.push({
            id,
            label: labelOf.get(id) || id,
            status: statusOf.get(id) || 'unknown',
            bookId: bId,
            bookName: bId ? ((books || []).find(b => b.id === bId) || {}).name || bId : '',
            kind: kind || '选',
          });
        });
      });
    });

    /* ② 逐行（年）构建格子 */
    /* 现行考纲已删的题（生成物里的 RC408.examIndexLegacy）——页面画红 ×（用户 2026-10-05 要求），仍可点击 */
    const legacySet = new Set((RC408.examIndexLegacy || []).map(String));
    const legacyWhy = RC408.examIndexLegacyWhy || {};
    const rows = [];
    const years = [];
    let total = 0, mapped = 0, empty = 0, unknownSubj = 0, multi = 0, legacy = 0;
    (D || []).forEach(raw => {
      const present = new Set(raw.q || []);
      const miss = new Set(raw.miss || []);
      const reverse = new Map();       // n -> subj
      Object.keys(raw.subj || {}).forEach(k => {
        const code = SUBJ_OF_BOOK[k] || k;         // 生成器可能写出 'ds' 这种小写（投票来源是 book id）
        (raw.subj[k] || []).forEach(n => reverse.set(n, code));
      });
      const cells = [];
      const byGroup = {};
      let rowMapped = 0;
      GROUPS.forEach(g => {
        const list = [];
        for (let n = g.range[0]; n <= g.range[1]; n++) {
          const subj = reverse.get(n) || '?';
          const mods = qmap.get(raw.y + '-' + n) || [];
          const exists = present.has(n);
          if (subj === '?') unknownSubj++;
          const isLegacy = legacySet.has(raw.y + '-' + n);
          if (isLegacy) legacy++;
          const cell = {
            y: raw.y, n, subj, mods, exists, absent: !exists && miss.has(n),
            legacy: isLegacy, legacyWhy: legacyWhy[raw.y + '-' + n] || '',
          };
          if (mods.length) { mapped++; rowMapped++; }
          else empty++;
          if (mods.length > 1) multi++;
          total++;
          list.push(cell);
          cells.push(cell);
        }
        byGroup[g.key] = list;
      });
      years.push(raw.y);
      rows.push({ y: raw.y, cells, byGroup, mapped: rowMapped, present: present.size, miss: (raw.miss || []).slice() });
    });

    return {
      groups: GROUPS, years, rows,
      stats: { total, mapped, empty, multi, unknownSubj, legacy, years: years.length },
      qmapSize: qmap.size,
    };
  }

  /* ------------------------------------------------------------------ *
   * render —— 拼 HTML（纯字符串；不依赖 Tailwind，离线 harness 与联网同形）
   * ------------------------------------------------------------------ */
  function render(model) {
    const esc = s => RC408.util.esc(s);
    const stat = model.stats;

    /* 表头：上行 = 科目组名（跨该组所有列），下行 = 题号 */
    let headSubj = '<th class="ix-corner" rowspan="2"><span class="ix-corner-t">年份</span></th>';
    let headNums = '';
    model.groups.forEach(g => {
      headSubj += '<th class="ix-g" colspan="' + (g.range[1] - g.range[0] + 1) + '" title="' + esc(g.full + '（第 ' + g.range[0] + '–' + g.range[1] + ' 题）') + '">' + esc(g.label) + '</th>';
      for (let n = g.range[0]; n <= g.range[1]; n++) headNums += '<th class="ix-n">' + n + '</th>';
    });

    /* 表体 */
    const body = model.rows.map(r => {
      const cells = r.cells.map(c => {
        const mods = c.mods;
        const primary = mods[0];
        /* ⚠ **窗43 就地改正**：原来 `subj === '?'` 一律写"科目不明"，而这 22 格（`miss` 里、多为无文本层年份）
           其实是**卷面未记录该题号** —— "科目查不到"与"卷面压根没有这题"是两回事；旧写法还会把
           `科目不明 · 科目不明` 连写两遍（`SUBJ_NAME('?')` 与 `kindTxt` 都是它）。
           现改成：**不在卷面** ⟹ 只写"卷面未记录该题号"；**在卷面却查不到科目**才叫"科目不明"
           （窗43 修完 2014-41/42/43/47 四格后，后者现算 **0** 格）。 */
        const subjTxt = c.exists ? SUBJ_NAME(c.subj) : '卷面未记录该题号';
        const kindTxt = c.subj === '?' ? '' : (c.n >= 41 ? '大题' : '选择题');
        let tip = c.y + ' 年 第 ' + c.n + ' 题 · ' + subjTxt + (kindTxt ? ' · ' + kindTxt : '');
        if (c.legacy) tip += '\n⛔ 现行考纲已删（' + (c.legacyWhy || '已移出考查范围') + '）';
        if (mods.length === 1) tip += '\n演示模块：' + primary.label + '（点击跳转）';
        else if (mods.length > 1) tip += '\n共 ' + mods.length + ' 个相关模块（点击选择）\n' + mods.map(m => '· ' + m.label).join('\n');
        else tip += '\n' + (c.legacy ? '（考纲已删，平台按约定不给模块；点击看说明）'
          : c.exists ? '（暂无对应模块）' : '（该年卷面未记录此题，缓存无文本层）');
        const cls = ['ix-cell'];
        cls.push(c.n >= 41 ? 'ix-big' : 'ix-sel');
        if (c.subj !== '?') cls.push('ix-s-' + c.subj.toLowerCase());   // 主体色按**科目**（大题那 7 列要靠它区分）
        if (!mods.length) cls.push('ix-nomod');
        if (!c.exists && !mods.length) cls.push('ix-void');
        if (mods.length > 1) cls.push('ix-multi');                      // 多条目：加一条底部粗线（不压题号）
        if (c.legacy) cls.push('ix-legacy');                            // 考纲外：画红 ×（仍可点）
        return '<td class="' + cls.join(' ') + '" data-y="' + c.y + '" data-n="' + c.n + '"'
          + ' title="' + esc(tip) + '" tabindex="0" role="button"'
          + ' aria-label="' + esc(c.y + ' 年第 ' + c.n + ' 题'
            + (c.legacy ? '（现行考纲已删）' : '') + (mods.length > 1 ? '（' + mods.length + ' 个模块）' : '')) + '">'
          + '<span class="ix-num">' + c.n + '</span>'
          + (c.legacy ? LEGACY_X : '')
          + '</td>';
      }).join('');
      const missTxt = r.miss.length ? '缺 ' + r.miss.length + ' 格' : '完整';
      return '<tr id="ix-row-' + r.y + '" class="ix-row">'
        + '<th class="ix-year" scope="row"><span class="ix-year-n">' + r.y + '</span>'
        + '<span class="ix-year-s" title="该年已记录 ' + r.present + ' 个题位；有模块的 ' + r.mapped + ' 个；' + missTxt + '">'
        + r.present + ' 题 · 模块 ' + r.mapped + '</span></th>'
        + cells + '</tr>';
    }).join('');

    /* 覆盖不全的年份（生成器给的 miss 非空）：底部明写，不假装画满 */
    const partial = model.rows.filter(r => r.miss.length)
      .map(r => r.y + '（缺 ' + r.miss.join('、') + '）').join('；');

    return ''
      + '<div class="ix-head">'
      + '<div class="ix-head-row">'
      + '<div>'
      + '<div class="ix-eyebrow">真题总览</div>'
      + '<h2 class="ix-title">题目 · 模块索引</h2>'
      + '<p class="ix-sub">2009–2026 共 ' + stat.years + ' 年真题，按「年份 × 题号」铺成一览表（<b>最新年份在最上</b>）。'
      + '方块里是题号，<b>点一下</b>就跳到演示这道题考点的模块；同题多个条目时让你挑一个。</p>'
      + '</div>'
      + '<div class="ix-legend">'
      + '<span class="ix-lg"><i class="ix-sw ix-sel"></i>选择题（蓝底）</span>'
      + '<span class="ix-lg"><i class="ix-sw ix-big"></i>大题（彩色底 = 该题的科目）</span>'
      + '<span class="ix-lg"><i class="ix-sw ix-legacy"></i>' + X_ICON_SMALL + '考纲外</span>'
      + '<span class="ix-lg"><i class="ix-sw ix-nomod"></i>暂无模块</span>'
      + '<span class="ix-lg"><i class="ix-sw ix-void"></i>当年未记录</span>'
      + '</div>'
      + '</div>'
      + '<div class="ix-stats">'
      + '<span class="ix-stat"><b>' + stat.total + '</b> 个题位</span>'
      + '<span class="ix-stat"><b>' + stat.mapped + '</b> 个已接模块</span>'
      + '<span class="ix-stat"><b>' + stat.empty + '</b> 个暂无模块</span>'
      + '<span class="ix-stat"><b>' + stat.legacy + '</b> 个考纲外</span>'
      + '<span class="ix-stat"><b>' + stat.multi + '</b> 个多条目</span>'
      + '<span class="ix-stat">覆盖 ' + stat.years + ' 个年份</span>'
      + '</div>'
      + '</div>'
      + '<div class="ix-tablewrap">'
      + '<table class="ix-table">'
      + '<thead><tr>' + headSubj + '</tr><tr>' + headNums + '</tr></thead>'
      + '<tbody>' + body + '</tbody>'
      + '</table>'
      + '</div>'
      + '<div class="ix-foot">'
      + '<p><b>怎么用</b>：方块 = 一道题。有色 = 该题被至少一个模块登记过（点击跳转）；'
      + '<span class="ix-dash-sample"></span> 虚线 = 这道题还没有对应模块；灰色 = 该年卷面没有这个题号。</p>'
      + '<p><b>' + X_ICON_SMALL + ' 红 ×＝这道题考的知识点已从现行考纲删除</b>（如海明码、总线标准、管程、HDLC、RAID），'
      + '平台按约定不再为它建模块 —— 但方块仍可点击，会告诉你它已删、以及在哪一年考过。</p>'
      + '<p><b>大题那 7 列的颜色 = 该题的科目</b>：'
      + '<i class="ix-sw ix-key ix-key-ds"></i>数据结构 '
      + '<i class="ix-sw ix-key ix-key-coa"></i>计组 '
      + '<i class="ix-sw ix-key ix-key-os"></i>操作系统 '
      + '<i class="ix-sw ix-key ix-key-net"></i>计网 '
      + '（选择题的科目看它所在的组名即可，故统一用蓝色）。</p>'
      + '<p><b>覆盖说明</b>：' + (partial
        ? '以下年份的真题卷 / 解析卷没有文本层，题号无法全部从卷面取到，表格里只画了能证实的那些：' + esc(partial) + '。'
        : '18 年题号均已从卷面取到。') + '</p>'
      + '<p class="ix-foot-dim">数据源：卷面题号取自真题 / 解析文本层（<code>js/exam-index-data.js</code>，生成器 <code>tmp_t41_gen.js</code>）；'
      + '题目 ↔ 模块的对应关系取自各模块的历年考察登记（<code>js/exam-history.js</code>），'
      + '一处登记即一处跳转，平台不替考点"合并同类项"。</p>'
      + '</div>';
  }

  function SUBJ_NAME(code) {
    return code === 'DS' ? '数据结构' : code === 'COA' ? '计算机组成原理'
      : code === 'OS' ? '操作系统' : code === 'NET' ? '计算机网络' : '科目不明';
  }

  /* ------------------------------------------------------------------ *
   * 浮层：同题多个模块时让用户挑一个（不替用户决定）
   * ------------------------------------------------------------------ */
  let pop = null;
  function closePop() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
  }
  function showPop(cellEl, mods) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'ix-pop';
    pop.innerHTML = '<div class="ix-pop-h">' + cellEl.dataset.y + ' 年 第 ' + cellEl.dataset.n + ' 题 · 登记了 '
      + mods.length + ' 个条目，选一个跳转：</div>'
      + mods.map(m => '<button class="ix-pop-i" data-topic="' + RC408.util.esc(m.id) + '">'
        + '<span class="ix-pop-t">' + RC408.util.esc(m.label) + '</span>'
        + '<span class="ix-pop-b">' + RC408.util.esc(m.bookName) + (m.status === 'theory' ? ' · 纯理论卡' : '') + '</span>'
        + '</button>').join('');
    document.body.appendChild(pop);
    const r = cellEl.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.left + window.scrollX + r.width / 2 - w / 2;
    left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
    let top = r.bottom + window.scrollY + 6;
    if (r.bottom + h + 12 > document.documentElement.clientHeight) top = r.top + window.scrollY - h - 6;
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(Math.max(8 + window.scrollY, top)) + 'px';
    pop.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        closePop();
        jump(btn.dataset.topic, cellEl);
      });
    });
  }

  /** 跳到某个模块：先退出专注模式（索引页本不该在专注模式里，但用户可能在切换前就开着） */
  function jump(topicId, cellEl) {
    if (RC408.Runner && RC408.Runner.focusMode) RC408.Runner.exitFocus();
    if (cellEl) {
      cellEl.classList.add('ix-hit');
      setTimeout(() => cellEl.classList.remove('ix-hit'), 1400);
    }
    if (typeof RC408.openTopicFromUI === 'function') RC408.openTopicFromUI(topicId);
    else if (RC408.Runner) RC408.Runner.open(topicId);
  }

  /* ------------------------------------------------------------------ *
   * mount —— 绑事件（只绑一次）+ 滚动到某年
   * ------------------------------------------------------------------ */
  let mounted = false;
  let modelRef = null;
  function mount(model) {
    modelRef = model;
    /* 容器由本页自己建（index.html 只给一个空 <section>）：这样"页面结构"只有一处真相 */
    let host = document.getElementById('exam-index-body');
    const section = document.getElementById('exam-index-section');
    if (!host && section) {
      host = document.createElement('div');
      host.id = 'exam-index-body';
      section.innerHTML = '';
      section.appendChild(host);
    }
    if (!host) return;
    host.innerHTML = render(model);
    if (mounted) return;
    mounted = true;

    host.addEventListener('click', ev => {
      const cell = ev.target.closest ? ev.target.closest('.ix-cell') : null;
      if (!cell) { closePop(); return; }
      ev.stopPropagation();
      const y = +cell.dataset.y, n = +cell.dataset.n;
      const row = modelRef.rows.find(r => r.y === y);
      const c = row && row.cells.find(x => x.n === n);
      const mods = (c && c.mods) || [];
      if (!mods.length) {
        /* 没有模块：给一句话说明，不跳（也不弹空浮层）。考纲外的题先说"已删"这件事。 */
        closePop();
        const lg = c && c.legacy;
        pop = document.createElement('div');
        pop.className = 'ix-pop';
        pop.innerHTML = '<div class="ix-pop-h">' + y + ' 年 第 ' + n + ' 题'
          + (lg ? ' · <span class="ix-pop-bad">⛔ 考纲外</span>' : '') + '</div>'
          + '<div class="ix-pop-empty">' + RC408.util.esc(lg
            ? ('这道题考的知识点已从现行考纲删除（' + (c.legacyWhy || '已移出考查范围') + '）⟹ 平台按约定不再为它建模块。做旧真题时了解即可，不必按重点复习。')
            : (c && c.exists ? '这道题在卷面上有，但还没有任何模块登记它 ⟹ 暂无跳转目标。' : '该年卷面未记录这个题号（真题卷 / 解析卷缺文本层）。')) + '</div>';
        document.body.appendChild(pop);
        const r = cell.getBoundingClientRect();
        pop.style.left = Math.round(Math.max(8 + window.scrollX, r.left + window.scrollX - 20)) + 'px';
        pop.style.top = Math.round(r.bottom + window.scrollY + 6) + 'px';
        return;
      }
      if (mods.length === 1) { closePop(); jump(mods[0].id, cell); return; }
      showPop(cell, mods);
    });
    host.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const cell = ev.target.closest ? ev.target.closest('.ix-cell') : null;
      if (cell) { ev.preventDefault(); cell.click(); }
    });
    document.addEventListener('click', () => closePop());
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePop(); });
    window.addEventListener('scroll', () => closePop(), true);
  }

  /** 侧栏年份按钮 → 滚到那一行并闪一下 */
  function scrollToYear(y) {
    const row = document.getElementById('ix-row-' + y);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('ix-row-hit');
    setTimeout(() => row.classList.remove('ix-row-hit'), 1400);
  }

  RC408.examIndexPage = { prepare, render, mount, scrollToYear, closePop, SUBJ_NAME, GROUPS };
})();
