'use strict';
/* ============================================================================
 * framework.js —— 平台核心框架
 * ----------------------------------------------------------------------------
 * 职责：
 *   1. 模块注册表（registerModule）与共享 UI 小部件（RC408.ui）
 *   2. 简易 Markdown 渲染器（RC408.md）——用于理论图文区
 *   3. 快照调度器 Runner —— 平台的心脏：
 *        算法模块把一次完整演示「一次性」计算成 状态快照数组 Snapshot[]，
 *        Runner 只维护一个下标 idx，单步 / 自动播放 / 进度拖动 / 重置
 *        本质上都只是移动 idx 并重绘，从而保证算法与 UI 彻底解耦。
 *   4. 标准控制面板：生成数据 / 重置 / 单步执行 / 自动播放·暂停 / 速度 / 进度
 *
 * 模块定义契约（每个可视化模块一个 JS 文件）：
 *   {
 *     id, mode: 'stepper' | 'instant', title, theory,       // 基本信息
 *     inputs: [ {key,label,type,default,options,...} ],     // 输入表单（数据驱动）
 *     quickActions: [ {label, run(rt)} ],                   // 表单区快捷按钮
 *     bindInputs?(els, rt), syncInputs?(els),               // 可选：表单联动钩子
 *     parse(vals) -> model,                                 // 校验并解析输入（可抛错）
 *     buildSnapshots(model) -> Snapshot[],                  // ★ 纯算法：产出全部快照
 *     render(ctx) -> void                                   // ★ 纯渲染：绘制当前快照
 *   }
 *   - stepper 模式：ctx = { model, snap, idx, total, stage }
 *   - instant 模式：输入变化即刻重算重绘，ctx = { model, inputs, stage }
 * ========================================================================== */

window.RC408 = { modules: {}, books: [], version: '1.0.0' };

/* ------------------------------ 通用工具 ------------------------------ */
RC408.util = {
  /** HTML 转义（日志 / 用户输入回显必须过一遍） */
  esc(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },
  /** [a, b] 闭区间随机整数 */
  rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); },
  /** 整数转二进制并补前导零 */
  bin(v, len) { return (v >>> 0).toString(2).padStart(len, '0'); },
  /** 百分比格式化 */
  pct(x) { return (x * 100).toFixed(1) + '%'; },
};

/* ------------------------------ 共享 UI 小部件 ------------------------------ */
RC408.ui = {
  /** 统计卡片 */
  statCard(label, value, sub = '', valueCls = 'text-slate-800') {
    return `<div class="rounded-xl border border-slate-200 bg-white p-3">
      <div class="text-[11px] font-bold text-slate-400 tracking-wide">${label}</div>
      <div class="text-xl font-extrabold mt-1 ${valueCls}">${value}</div>
      ${sub ? `<div class="text-[11px] text-slate-400 mt-0.5">${sub}</div>` : ''}
    </div>`;
  },
  /** 小徽片（边 / 页面序列等） */
  chip(text, cls = '', title = '') {
    return `<span class="chip ${cls}" ${title ? `title="${RC408.util.esc(title)}"` : ''}>${text}</span>`;
  },
  /** 图例项 */
  legend(color, text) {
    return `<span class="inline-flex items-center gap-1.5">
      <span class="inline-block w-3 h-3 rounded-full" style="background:${color}"></span>${text}
    </span>`;
  },
  /** 章节小标题 */
  sectionTitle(text) {
    return `<div class="text-[11px] font-bold text-slate-400 tracking-widest mb-1.5">${text}</div>`;
  },
};

/* ============================================================================
 * 简易 Markdown 渲染器（支持：标题 / 列表 / 表格 / 引用 / 代码块 / 加粗斜体 / 行内代码 / 分隔线）
 * 说明：先整体 HTML 转义再解析，安全可靠；仅用于渲染平台内部的理论文案。
 * ========================================================================== */
RC408.md = (function () {
  /** 行内元素：转义已在外层完成，这里只做语法替换 */
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  return function md(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 空行
      if (/^\s*$/.test(line)) { i++; continue; }

      // 围栏代码块 ```...```
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过收尾 ```
        out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
        continue;
      }

      // 分隔线 ---
      if (/^\s*-{3,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 标题 # ~ ####
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const lv = h[1].length + 1;               // ## → h3
        out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
        i++; continue;
      }

      // 表格 | a | b | 与 |---|---|
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push('<table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
          + rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }

      // 引用 >
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
        continue;
      }

      // 无序 / 有序列表
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const buf = [];
        while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
          buf.push(inline(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '')));
          i++;
        }
        out.push(ordered ? `<ol><li>${buf.join('</li><li>')}</li></ol>` : `<ul><li>${buf.join('</li><li>')}</li></ul>`);
        continue;
      }

      // 普通段落（连续若干行，空行 / 块级元素终止）
      const buf = [line];
      i++;
      while (
        i < lines.length && !/^\s*$/.test(lines[i]) &&
        !/^```|^#{1,4}\s|^\s*>|^\s*[-*]\s|^\s*\d+\.\s|^\s*\|/.test(lines[i])
      ) { buf.push(lines[i]); i++; }
      out.push(`<p>${inline(buf.join('<br>'))}</p>`);
    }

    return out.join('\n');
  };
})();

/* ============================================================================
 * Runner —— 快照调度器 + 工作区渲染
 * ========================================================================== */
const Runner = {

  /* ---- 运行时状态 ---- */
  def: null,          // 当前模块定义
  model: null,        // parse() 解析后的输入模型
  snaps: [],          // ★ 状态快照数组（由 buildSnapshots 一次性产出）
  idx: 0,             // 当前快照下标
  timer: null,        // 自动播放定时器
  playing: false,
  speedMs: 900,       // 自动播放间隔
  dirty: false,       // 表单是否被修改过而未重新生成
  inputEls: {},       // key -> input 元素
  dom: {},            // 工作区 DOM 引用

  /* ---- 首次挂载：抓取容器引用、绑定一次性事件 ---- */
  mount() {
    const $ = id => document.getElementById(id);
    this.dom = {
      topicHeader: $('topic-header'), theoryBody: $('theory-body'), theoryCard: $('theory-body').parentElement,
      inputArea: $('input-area'), controlArea: $('control-area'), stepDesc: $('step-desc'),
      stage: $('stage'), logBox: $('log-box'),
    };

    // 理论区折叠
    $('theory-toggle').addEventListener('click', () => {
      const hidden = this.dom.theoryBody.classList.toggle('hidden');
      $('theory-arrow').textContent = hidden ? '▶' : '▼';
    });

    // 日志清空
    $('log-clear').addEventListener('click', () => { this.dom.logBox.innerHTML = ''; });

    // 专注模式（目录隐藏：左栏操作 / 右栏图像反馈）
    $('focus-toggle').addEventListener('click', () => this.toggleFocus());
    $('fp-exit').addEventListener('click', () => this.toggleFocus());
    $('fp-topic').addEventListener('change', e => {
      if (e.target.value && RC408.openTopicFromUI) RC408.openTopicFromUI(e.target.value);
    });

    // 展示区缩放（对 #stage 整体生效，跨知识点保持用户偏好）
    this.zoom = 1;
    $('zoom-out').addEventListener('click', () => this.setZoom(this.zoom - 0.1));
    $('zoom-in').addEventListener('click', () => this.setZoom(this.zoom + 0.1));
    $('zoom-reset').addEventListener('click', () => this.setZoom(1));

    // 键盘快捷键（输入框聚焦时不拦截）
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select') || !this.def || this.def.mode !== 'stepper') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.step(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.seek(this.idx - 1); }
      else if (e.key === ' ') { e.preventDefault(); this.playing ? this.stopTimer() : this.play(); }
      else if (e.key.toLowerCase() === 'r') { this.reset(); }
    });
  },

  /* ---------------- 对外入口：打开一个知识点 ---------------- */
  open(topicId) {
    this.stopTimer();
    this.def = RC408.modules[topicId] || null;
    this.snaps = []; this.idx = 0; this.model = null; this.dirty = false;

    const hit = findTopicMeta(topicId);   // 由 app.js 提供书籍元数据查询
    const label = hit ? hit.topic.label : topicId;

    /* ---- 纯理论考点：完全无法（或无必要）可视化的知识点，渲染为速记卡 ---- */
    const theoryOnly = hit && hit.topic.status === 'theory' && hit.topic.note;
    if (theoryOnly) {
      this.dom.topicHeader.innerHTML = this._headerHtml(label, hit, 'theory');
      this.dom.theoryBody.innerHTML = (RC408.examStripHtml(this.def || { id: topicId }) || '') +
        RC408.md(hit.topic.note || '');
      RC408.renderMath(this.dom.theoryBody);
      this.dom.inputArea.innerHTML = '';
      this.dom.controlArea.innerHTML = '';
      this.dom.stepDesc.classList.add('hidden');
      // 整个"交互式可视化"卡片对纯理论考点没有意义，直接隐藏
      document.getElementById('viz-card').classList.add('hidden');
      this.dom.logBox.innerHTML =
        `<div class="log-line log-info"><span class="log-msg">纯理论考点速记卡已展示。</span></div>`;
      return;
    }

    if (!this.def) {
      /* ---- 未实现条目：普通的是"敬请期待"占位页；
              带 legacy 字段的是"考纲外"考点（真题曾考、现行考纲已删），用作旧真题的对照标注 ---- */
      const legacy = hit && hit.topic.legacy;
      this.dom.topicHeader.innerHTML = this._headerHtml(label, hit, legacy ? 'legacy' : true);
      this.dom.theoryBody.innerHTML = RC408.md(legacy
        ? `## 已移出现行考纲\n\n${legacy}\n\n> 💡 复习建议：做 2009–2025 旧真题遇到该考点时，作背景知识了解即可，**不必按重点复习**；真题解析年代较早，个别解法以现行教材表述为准。`
        : `## 建设中\n\n该知识点的可视化正在规划中，敬请期待！\n\n` +
          `**规划中的交互演示**：${(hit && hit.topic.plan) || '待定'}。`
      );
      this.dom.inputArea.innerHTML = '';
      this.dom.controlArea.innerHTML = '';
      this.dom.controlArea.classList.remove('hidden');
      this.dom.stepDesc.classList.add('hidden');
      this.dom.stage.innerHTML = legacy
        ? `<div class="rounded-2xl border-2 border-dashed border-rose-300 bg-rose-50/50 p-10 text-center">
            <div class="text-5xl mb-3">📕</div>
            <h3 class="text-lg font-bold text-slate-700">「${RC408.util.esc(label)}」已从现行考纲删除</h3>
            <p class="text-sm text-slate-500 mt-2">${RC408.util.esc(legacy)}</p>
            <p class="text-xs text-slate-400 mt-4">本条目作为旧真题（2009–2025）的对照标注保留在目录中；以《25 考研 408 大纲》为准。</p>
          </div>`
        : `<div class="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center">
            <div class="text-5xl mb-3">🚧</div>
            <h3 class="text-lg font-bold text-slate-700">「${RC408.util.esc(label)}」可视化正在建设中</h3>
            <p class="text-sm text-slate-500 mt-2">规划中的交互：${RC408.util.esc((hit && hit.topic.plan) || '……')}</p>
            <p class="text-xs text-slate-400 mt-4">扩展提示：在 js/modules/ 下新建模块文件，调用 RC408.registerModule({...})，再到 app.js 目录树中把 status 改为 'ready' 即可上线。</p>
          </div>`;
      this.dom.logBox.innerHTML =
        `<div class="log-line log-warn"><span class="log-msg">${legacy ? '该考点已移出现行考纲（旧真题对照条目）。' : '该知识点尚未实现，敬请期待。'}</span></div>`;
      return;
    }

    /* ---- 正式模块 ---- */
    this.dom.topicHeader.innerHTML = this._headerHtml(this.def.title, hit, false);
    // 理论区 = 历年考察分布条（如有数据） + Markdown 正文
    this.dom.theoryBody.innerHTML = RC408.examStripHtml(this.def) + RC408.md(this.def.theory || '');
    RC408.renderMath(this.dom.theoryBody);
    this.dom.theoryBody.classList.remove('hidden');
    this.dom.theoryCard.querySelector('#theory-arrow').textContent = '▼';
    this.dom.stage.innerHTML = '';
    this.dom.logBox.innerHTML = '';
    this.dom.stepDesc.classList.add('hidden');
    this.dom.stepDesc.innerHTML = '';
    this.renderInputs();
    this.renderControls();
    this.syncTopicSelect();
    // stepper 模式先跑一遍生成快照；instant 模式即时计算
    this.load();
  },

  /** 标题条 HTML（status: true=建设中占位, 'legacy'=考纲外, false/缺省=可交互） */
  _headerHtml(title, hit, wip) {
    const book = hit ? hit.book : null;
    const badge = wip === 'legacy'
      ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">📕 考纲外（已删除）</span>`
      : wip === 'theory'
        ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">📖 纯理论速记卡</span>`
        : wip
          ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">🚧 敬请期待</span>`
          : `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">✓ 可交互</span>`;
    const bookChip = book
      ? `<span class="text-xs font-bold px-2.5 py-1 rounded-md" style="background:${book.accent}1a;color:${book.accent}">${book.icon} ${book.name}</span>`
      : '';
    return `<div class="flex flex-wrap items-center gap-3">
      ${bookChip}
      <h2 class="text-xl md:text-2xl font-extrabold text-slate-800">${RC408.util.esc(title)}</h2>
      ${badge}
    </div>`;
  },

  /* ---------------- 输入表单（数据驱动生成） ---------------- */
  renderInputs() {
    const d = this.def;
    const wrap = this.dom.inputArea;
    wrap.innerHTML = '';
    this.inputEls = {};

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3';

    d.inputs.forEach(inp => {
      const cell = document.createElement('div');
      if (inp.wide) cell.className = 'md:col-span-2';
      let field = '';
      const id = `in-${inp.key}`;
      if (inp.type === 'textarea') {
        field = `<textarea id="${id}" rows="${inp.rows || 3}" placeholder="${inp.ph || ''}" class="fld">${inp.default}</textarea>`;
      } else if (inp.type === 'select') {
        field = `<select id="${id}" class="fld">` + inp.options.map(o =>
          `<option value="${o.v}" ${String(o.v) === String(inp.default) ? 'selected' : ''}>${o.t}</option>`).join('') + `</select>`;
      } else if (inp.type === 'range') {
        field = `<div class="flex items-center gap-3">
            <input id="${id}" type="range" min="${inp.min}" max="${inp.max}" step="${inp.step || 1}" value="${inp.default}" class="flex-1">
            <span id="${id}-val" class="font-mono font-bold text-indigo-600 w-12 text-right">/${inp.default}</span>
          </div>`;
      } else {
        field = `<input id="${id}" type="${inp.type || 'text'}" value="${inp.default}" placeholder="${inp.ph || ''}" class="fld">`;
      }
      cell.innerHTML = `<label class="lbl">${inp.label}</label>${field}${inp.help ? `<p class="help">${inp.help}</p>` : ''}`;
      grid.appendChild(cell);

      const el = cell.querySelector(`#${CSS.escape(id)}`);
      this.inputEls[inp.key] = el;
      // 输入变化：即时模块 / 下拉框 → 立即重新生成；其余（文本框）→ 标记"待重新生成"
      el.addEventListener('input', () => {
        if (inp.type === 'range' && cell.querySelector(`#${CSS.escape(id)}-val`)) {
          cell.querySelector(`#${CSS.escape(id)}-val`).textContent = '/' + el.value;
        }
        if (this.def.mode === 'instant' || inp.type === 'select') this.load();
        else this.markDirty();
      });
    });

    wrap.appendChild(grid);

    // 模块快捷按钮（随机生成 / 预设示例）
    if (d.quickActions && d.quickActions.length) {
      const bar = document.createElement('div');
      bar.className = 'flex flex-wrap gap-2 mt-3';
      d.quickActions.forEach(a => {
        const b = document.createElement('button');
        b.className = 'btn btn-ghost text-xs';
        b.textContent = a.label;
        b.addEventListener('click', () => a.run(this));
        bar.appendChild(b);
      });
      wrap.appendChild(bar);
    }

    if (d.bindInputs) d.bindInputs(this.inputEls, this);
  },

  /** stepper 模式下：表单被修改但尚未「生成数据」 */
  markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    const hint = document.getElementById('dirty-hint');
    if (hint) hint.classList.remove('hidden');
  },

  /** 程序化设置某个输入项的值（随机生成按钮用） */
  setInput(key, value) {
    const el = this.inputEls[key];
    if (!el) return;
    el.value = value;
    const valEl = document.getElementById(`in-${key}-val`);
    if (valEl) valEl.textContent = '/' + value;
    if (this.def && this.def.syncInputs) this.def.syncInputs(this.inputEls);
    this.dirty = true;
  },

  /* ---------------- 专注模式：目录隐藏，左栏操作 / 右栏图像 ---------------- */
  focusMode: false,
  _anchors: null,

  toggleFocus() {
    this.focusMode ? this.exitFocus() : this.enterFocus();
  },

  enterFocus() {
    if (this.focusMode) return;
    this.focusMode = true;
    const $ = id => document.getElementById(id);
    // 记录各节点原位（父节点 + 后继），退出时精确还原
    if (!this._anchors) {
      this._anchors = {};
      ['input-area', 'control-area', 'step-desc', 'stage', 'log-card', 'zoom-bar'].forEach(id => {
        const el = $(id);
        this._anchors[id] = { parent: el.parentElement, next: el.nextSibling };
      });
      // 填充知识点快速切换器（只列可交互模块）
      $('fp-topic').innerHTML = RC408.books.map(b => {
        const ready = [];
        b.chapters.forEach(ch => ch.topics.forEach(t => { if (t.status === 'ready') ready.push({ id: t.id, label: b.icon + ' ' + t.label }); }));
        if (!ready.length) return '';
        return '<optgroup label="' + b.name + '">' + ready.map(t =>
          '<option value="' + t.id + '">' + t.label + '</option>').join('') + '</optgroup>';
      }).join('');
    }
    const move = (id, target) => { $(target).appendChild($(id)); };
    move('input-area', 'fp-form');
    move('control-area', 'fp-ctl');
    move('step-desc', 'fp-desc');
    move('stage', 'fp-stage');
    move('zoom-bar', 'fp-zoom');
    move('log-card', 'fp-log');
    // 隐藏目录与主区（理论卡 / 可视化卡 / 标题条都随主区隐藏）
    $('catalog-aside').style.display = 'none';   // 内联样式：覆盖 md:flex 等响应式类
    $('main-section').style.display = 'none';
    $('control-pane').style.display = 'flex';
    $('focus-pane').style.display = 'flex';
    $('focus-toggle').textContent = '✕ 退出专注';
    this.syncTopicSelect();
    this.paint();   // stage 搬家后重绘一次，确保内容与动画就位
  },

  exitFocus() {
    if (!this.focusMode) return;
    this.focusMode = false;
    const $ = id => document.getElementById(id);
    Object.entries(this._anchors).forEach(([id, a]) => {
      const el = $(id);
      if (el) a.parent.insertBefore(el, a.next);   // 精确放回原位
    });
    $('catalog-aside').style.display = '';
    $('main-section').style.display = '';
    $('control-pane').style.display = 'none';
    $('focus-pane').style.display = 'none';
    $('focus-toggle').textContent = '🎛 专注模式';
    this.paint();
  },

  /** 专注模式下拉选择器与当前知识点保持同步 */
  syncTopicSelect() {
    const sel = document.getElementById('fp-topic');
    if (sel && this.def) sel.value = this.def.id;
  },

  /** 设置展示区缩放比例（0.5 ~ 1.5，步进 0.1） */
  setZoom(z) {
    this.zoom = Math.round(Math.min(1.5, Math.max(0.5, z)) * 10) / 10;
    this.dom.stage.style.zoom = this.zoom;
    document.getElementById('zoom-reset').textContent = Math.round(this.zoom * 100) + '%';
  },

  /* ---------------- 标准控制面板 ---------------- */
  renderControls() {
    const d = this.def;
    const c = this.dom.controlArea;
    c.innerHTML = '';

    if (d.mode === 'instant') {
      /* 即时反馈型模块：无步进概念，输入即结果 */
      c.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-bold">⚡ 即时反馈模式 —— 修改上方任意参数，下方结果实时刷新</span>
        </div>`;
      return;
    }

    /* 步进型模块：完整标准控制面板 */
    c.innerHTML = `
      <div class="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <button id="ctl-load"  class="btn btn-primary">🎲 生成数据</button>
          <button id="ctl-reset" class="btn">⏮ 重置</button>
          <button id="ctl-step"  class="btn btn-accent">▶ 单步执行</button>
          <button id="ctl-play"  class="btn btn-success">▶▶ 自动播放</button>
          <span id="dirty-hint" class="hidden text-xs font-semibold text-amber-600 anim-soft-blink">● 参数已修改，点击「生成数据」应用</span>
          <div class="flex items-center gap-2 sm:ml-auto">
            <label class="text-xs text-slate-500 whitespace-nowrap">速度</label>
            <input id="ctl-speed" type="range" min="1" max="10" value="7" class="w-24 md:w-28">
            <span id="ctl-speed-txt" class="text-xs text-slate-500 w-12 text-right font-mono">0.9s</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span id="ctl-prog" class="text-xs font-mono text-slate-500 whitespace-nowrap">0 / 0</span>
          <input id="ctl-seek" type="range" min="0" max="0" value="0" class="flex-1">
        </div>
      </div>`;

    const $ = id => c.querySelector(`#${id}`);
    $('ctl-load').addEventListener('click', () => this.load());
    $('ctl-reset').addEventListener('click', () => this.reset());
    $('ctl-step').addEventListener('click', () => this.step());
    $('ctl-play').addEventListener('click', () => this.playing ? this.stopTimer() : this.play());
    $('ctl-seek').addEventListener('input', e => this.seek(+e.target.value));
    $('ctl-speed').addEventListener('input', e => {
      this.speedMs = 2300 - (+e.target.value) * 200;   // 1→2.1s … 10→0.3s
      $('ctl-speed-txt').textContent = (this.speedMs / 1000).toFixed(1) + 's';
      if (this.playing) { clearInterval(this.timer); this.timer = setInterval(() => this._tick(), this.speedMs); }
    });
  },

  /* ---------------- 核心调度 ---------------- */

  /** 读取表单 → 解析 → 一次性生成全部快照 → 回到第 0 帧 */
  load() {
    this.stopTimer();
    const hint = document.getElementById('dirty-hint');
    if (hint) hint.classList.add('hidden');
    this.dirty = false;

    try {
      const vals = {};
      this.def.inputs.forEach(inp => { vals[inp.key] = this.inputEls[inp.key].value; });
      this.model = this.def.parse(vals);                       // ① 解析（可抛出校验错误）
      if (this.def.mode === 'instant') { this.runInstant(); return; }
      this.snaps = this.def.buildSnapshots(this.model);        // ② 纯算法产出快照数组
      if (!this.snaps.length) throw { message: '算法未产生任何快照' };
      this.idx = 0;                                            // ③ 回到第 0 帧
      this.paint();
    } catch (e) {
      this.showError(e && e.message ? e.message : String(e));
    }
  },

  /** instant 模式：无快照，直接重算重绘 */
  runInstant() {
    const d = this.def;
    try {
      const vals = {};
      d.inputs.forEach(inp => { vals[inp.key] = this.inputEls[inp.key].value; });
      this.model = d.parse(vals);
      this.dom.stage.innerHTML = '';
      d.render({ model: this.model, inputs: vals, stage: this.dom.stage });
      // 即时模块的日志（可选：def.logs(model) 返回 [{text, type}]）
      const logs = d.logs ? d.logs(this.model) : [];
      this.dom.logBox.innerHTML = logs.map((l, i) =>
        `<div class="log-line log-${l.type || 'info'}"><span class="log-idx">#${String(i + 1).padStart(2, '0')}</span><span class="log-msg">${RC408.util.esc(l.text)}</span></div>`
      ).join('');
    } catch (e) {
      this.showError(e && e.message ? e.message : String(e));
    }
  },

  /** 前进一帧（到达末尾时自动停止播放） */
  step() {
    if (!this.snaps.length) return;
    if (this.idx < this.snaps.length - 1) this.idx++;
    this._tickStopIfEnd();
    this.paint();
  },

  /** 跳转到任意帧（进度条拖动 / 回退） */
  seek(i) {
    if (!this.snaps.length) return;
    this.idx = Math.max(0, Math.min(this.snaps.length - 1, i));
    this._tickStopIfEnd();
    this.paint();
  },

  /** 回到第 0 帧 */
  reset() {
    if (!this.snaps.length) return;
    this.stopTimer();
    this.idx = 0;
    this.paint();
  },

  /** 自动播放（若已在末尾则从头开始） */
  play() {
    if (!this.snaps.length || this.playing) return;
    if (this.idx >= this.snaps.length - 1) this.idx = 0;
    this.playing = true;
    this._updatePlayBtn();
    this.timer = setInterval(() => this._tick(), this.speedMs);
    this.paint();
  },

  /** 停止自动播放 */
  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.playing) { this.playing = false; this._updatePlayBtn(); }
  },

  /** 内部：自动播放的每次心跳 */
  _tick() {
    if (this.idx >= this.snaps.length - 1) { this.stopTimer(); return; }
    this.idx++;
    this.paint();
  },

  _tickStopIfEnd() { if (this.idx >= this.snaps.length - 1) this.stopTimer(); },

  _updatePlayBtn() {
    const btn = document.getElementById('ctl-play');
    if (!btn) return;
    btn.textContent = this.playing ? '⏸ 暂停' : '▶▶ 自动播放';
    btn.classList.toggle('btn-success', !this.playing);
    btn.classList.toggle('btn-danger', this.playing);
  },

  /* ---------------- 渲染管线：把当前快照交给模块绘制 ---------------- */
  paint() {
    const d = this.def;
    if (!d || !this.snaps.length) return;
    const snap = this.snaps[this.idx];

    // ① 模块自渲染当前快照
    this.dom.stage.innerHTML = '';
    d.render({ model: this.model, snap, idx: this.idx, total: this.snaps.length, stage: this.dom.stage });

    // ② 步骤说明条
    if (snap.desc) {
      this.dom.stepDesc.classList.remove('hidden');
      this.dom.stepDesc.innerHTML =
        `<div class="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-2 text-sm text-indigo-900">
           <b>💡 第 ${this.idx}/${this.snaps.length - 1} 步：</b>${RC408.util.esc(snap.desc)}
         </div>`;
    } else {
      this.dom.stepDesc.classList.add('hidden');
    }

    // ③ 进度与按钮状态
    const prog = document.getElementById('ctl-prog');
    const seekEl = document.getElementById('ctl-seek');
    const stepBtn = document.getElementById('ctl-step');
    const resetBtn = document.getElementById('ctl-reset');
    if (prog) prog.textContent = `步骤 ${this.idx} / ${this.snaps.length - 1}`;
    if (seekEl) { seekEl.max = this.snaps.length - 1; seekEl.value = this.idx; }
    if (stepBtn) stepBtn.disabled = this.idx >= this.snaps.length - 1;
    if (resetBtn) resetBtn.disabled = this.idx === 0;

    // ④ 日志：直接由 [0..idx] 区间的快照重建，天然与回退 / 拖动保持一致
    const box = this.dom.logBox;
    const lines = [];
    this.snaps.forEach((s, i) => {
      if (i > this.idx || !s.log) return;
      lines.push(`<div class="log-line log-${s.logType || 'info'}"><span class="log-idx">#${String(i).padStart(2, '0')}</span><span class="log-msg">${RC408.util.esc(s.log)}</span></div>`);
    });
    box.innerHTML = lines.join('') || '<div class="log-line log-info"><span class="log-msg">（暂无日志）</span></div>';
    box.scrollTop = box.scrollHeight;
  },

  /** 输入校验失败：在展示区给出友好错误卡片 */
  showError(msg) {
    this.dom.stage.innerHTML = `
      <div class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <b>⚠️ 输入有误：</b>${RC408.util.esc(msg)}
      </div>`;
    this.dom.logBox.innerHTML =
      `<div class="log-line log-error"><span class="log-idx">✖</span><span class="log-msg">${RC408.util.esc(msg)}</span></div>`;
    this.dom.stepDesc.classList.add('hidden');
    const prog = document.getElementById('ctl-prog');
    if (prog) prog.textContent = '0 / 0';
  },
};

RC408.Runner = Runner;

/* ------------------------------ 数学公式渲染（KaTeX） ------------------------------ */
/* 对容器内的 ( 行内公式 与 $ 块级公式 做 LaTeX 排版；KaTeX 未加载时静默跳过 */
RC408.renderMath = function (el) {
  if (!el || !window.renderMathInElement) return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$', right: '$', display: true },
        { left: '\(', right: '\)', display: false },
      ],
      throwOnError: false,
    });
  } catch (e) { /* 忽略个别公式错误，不影响页面 */ }
};

/* ------------------------------ 模块注册 ------------------------------ */
RC408.registerModule = function (def) {
  RC408.modules[def.id] = def;
};

/* ============================================================================
 * 历年考察分布条：根据 RC408.examHistory[def.id] 渲染 2009–2025 年历格子
 *   蓝色 = 选择题，红色 = 大题（含混合），灰色 = 未考；格内标注题号，悬停看详情。
 * 数据维护在 js/exam-history.js。
 * ========================================================================== */
RC408.examStripHtml = function (def) {
  const data = RC408.examHistory && RC408.examHistory[def.id];
  if (!data || !data.length) return '';
  const map = {};
  data.forEach(e => { map[e.y] = e; });
  const years = [];
  for (let y = 2009; y <= 2026; y++) years.push(y);

  const cells = years.map(y => {
    const e = map[y];
    if (!e) return `<div class="ex-cell ex-off" title="${y} 年未考"><div class="ex-y">${String(y).slice(2)}</div></div>`;
    const kind = e.k.includes('大') ? '大题' : '选择题';
    const cls = e.k.includes('大') ? 'ex-big' : 'ex-sel';
    return `<div class="ex-cell ${cls}" title="${y} 年 第 ${e.n} 题 · ${kind}">
      <div class="ex-y">${String(y).slice(2)}</div>
      <div class="ex-n">T${e.n}</div>
    </div>`;
  }).join('');

  const questionCount = data.reduce((a, e) => a + String(e.n).split('·').length, 0);

  return `<div class="exam-strip">
    <div class="exam-strip-head">
      <span class="exam-strip-title">历年考察分布（2009–2026）</span>
      <span class="exam-strip-sub">考过 <b>${data.length}</b> 年 · 共 <b>${questionCount}</b> 题</span>
      <span class="exam-strip-legend">
        <i class="ex-dot ex-sel"></i>选择题
        <i class="ex-dot ex-big"></i>大题
        <i class="ex-dot ex-off-d"></i>未考
      </span>
    </div>
    <div class="flex flex-wrap gap-0.5">${cells}</div>
  </div>`;
};

/* app.js 提供的目录元数据查询：返回 { book, chapter, topic } */
function findTopicMeta(topicId) {
  for (const book of RC408.books) {
    for (const ch of book.chapters) {
      const topic = ch.topics.find(t => t.id === topicId);
      if (topic) return { book, chapter: ch, topic };
    }
  }
  return null;
}
