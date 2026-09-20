'use strict';
/* ============================================================================
 * ds-expression.js —— 【数据结构】表达式求值：中缀转后缀 与 后缀计算（前缀 _ex）
 * 考情：表达式求值是栈的典型应用，2009–2026 共考 4 年——
 *   2012-2（a+b-a*((c+d)/e-f)+g 转后缀）、2014-2（a/b+(c*d-e*f)/g 问扫描到 f 时栈内
 *   元素）、2024-2（x+(y*(z-u))/v 求后缀式）、2017-41 大题（表达式树求中缀式）。
 * 快照：每一步「输出操作数 / 运算符入栈 / 弹栈输出 / 括号出栈」各一帧，全量携带
 *   运算符栈与后缀式副本；转换模式结束帧给出后缀式与栈最大深度（高频考点）。
 * ========================================================================== */

/* 运算符优先级（'(' 不入此表：仅当栈顶为运算符时才参与弹出比较） */
const _EX_PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };
const _EX_OPS = '+-*/';

RC408.registerModule({
  id: 'ds-expression',
  mode: 'stepper',
  title: '表达式求值：中缀转后缀与后缀计算',

  theory: `
> **真题考情**：表达式求值是**栈的典型应用**，2009–2026 共考 4 年：2012-2、2014-2、
> 2024-2（选择题），2017-41（大题：表达式树转中缀式）。固定问法：给出中缀式，问
> **扫描到某符号时栈内的元素依次是**（2014-2）、问**等价的后缀表达式**（2012-2、2024-2）。

## 中缀 → 后缀转换规则（运算符栈，从左向右扫描）
| 当前符号 | 动作 |
| --- | --- |
| 操作数 | 直接加入后缀式 |
| 「(」 | 运算符栈入栈 |
| 「)」 | 依次弹栈并输出，直到弹出「(」（**左括号出栈但不输出**） |
| 运算符 | 弹出栈顶所有**优先级 ≥ 当前**的运算符并输出（「*」「/」高于「+」「-」），再把当前运算符入栈 |
| 扫描结束 | 栈内剩余运算符依次弹出输出 |

## 后缀表达式求值（操作数栈）
从左向右扫描：操作数入栈；遇运算符弹出两个操作数——**先弹出的是右操作数**，
计算 \\(a \\; op \\; b\\) 后把结果压回；扫描结束时栈中唯一元素即表达式值。

## 必背结论
- 后缀式中运算符的顺序即**实际计算顺序**，且**不含括号**；中缀转后缀后操作数相对顺序不变。
- **增减括号速算法**（2024-2 官方解法）：按运算优先级为中缀式全部加上括号 → 把运算符移到
  对应括号的外面（后缀）/ 前面（前缀）→ 去掉全部括号即得。
- 同级运算符**左结合**：先入栈者先弹出（如 \\(a-b-c \\Rightarrow ab-c-\\)，而非 \\(abc--\\)）。
- 转换过程中**运算符栈的最大深度**、"某时刻栈内元素依次是什么"都只需按规则逐符号模拟。
`,

  inputs: [
    {
      key: 'mode', label: '演示内容', type: 'select',
      options: [ { v: 'toPost', t: '中缀 → 后缀（运算符栈转换）' }, { v: 'eval', t: '后缀表达式求值（操作数栈）' } ],
      default: 'toPost',
    },
    {
      key: 'expr', label: '表达式', type: 'text', default: 'a+b-a*((c+d)/e-f)+g', wide: true,
      help: '转换模式：中缀式，操作数用单字符（字母/数字）；求值模式：后缀式，记号用空格或逗号分隔',
    },
  ],

  /* 切换演示模式时，表达式示例一并切到对应形态，避免旧输入在新模式下报错 */
  bindInputs(els, rt) {
    const seeds = { toPost: 'a+b-a*((c+d)/e-f)+g', eval: '6,3,2,-,*,4,2,/,+' };
    els.mode.addEventListener('change', () => {
      rt.setInput('expr', seeds[els.mode.value] || seeds.toPost);
      rt.load();
    });
  },

  quickActions: [
    {
      label: '🎲 随机中缀式',
      run(rt) {
        const ops = _EX_OPS;
        const n = RC408.util.rnd(4, 6);                       // 操作数个数
        let toks = [];
        for (let i = 0; i < n; i++) {
          toks.push(String.fromCharCode(97 + RC408.util.rnd(0, 9)));   // a~j
          if (i < n - 1) toks.push(ops[RC408.util.rnd(0, 3)]);
        }
        if (Math.random() < 0.6) {                            // 六成概率给某相邻操作数对加括号
          const k = RC408.util.rnd(1, n - 2) * 2;             // 操作数在偶数位
          toks.splice(k, 0, '(');
          toks.splice(k + 2, 0, ')');
        }
        rt.setInput('mode', 'toPost');
        rt.setInput('expr', toks.join(''));
        rt.load();
      },
    },
    { label: '2012 真题', run(rt) { rt.setInput('mode', 'toPost'); rt.setInput('expr', 'a+b-a*((c+d)/e-f)+g'); rt.load(); } },
    { label: '2014 真题', run(rt) { rt.setInput('mode', 'toPost'); rt.setInput('expr', 'a/b+(c*d-e*f)/g'); rt.load(); } },
    { label: '2024 真题', run(rt) { rt.setInput('mode', 'toPost'); rt.setInput('expr', 'x+(y*(z-u))/v'); rt.load(); } },
    { label: '后缀求值示例', run(rt) { rt.setInput('mode', 'eval'); rt.setInput('expr', '6,3,2,-,*,4,2,/,+'); rt.load(); } },
  ],

  /* ------------------------------ 解析 ------------------------------ */
  parse(vals) {
    if (vals.mode === 'eval') {
      const tokens = String(vals.expr).split(/[\s,，]+/).filter(Boolean);
      if (tokens.length < 3) throw { message: '后缀式至少需要 3 个记号（用空格或逗号分隔）' };
      if (tokens.length > 24) throw { message: '记号过多（≤ 24 个），演示看不清' };
      let nums = 0, ops = 0;
      for (const t of tokens) {
        if (_EX_OPS.includes(t) && t.length === 1) { ops++; continue; }
        if (/^\d+(\.\d+)?$/.test(t)) { nums++; continue; }
        throw { message: `记号「${t}」不是正数或四则运算符（暂不支持负数/一元负号）` };
      }
      if (nums !== ops + 1) throw { message: `操作数 ${nums} 个、运算符 ${ops} 个——四则运算应满足 操作数 = 运算符 + 1` };
      /* 记号顺序校验：模拟操作数栈深度，运算符弹出时须有两个操作数 */
      let d = 0;
      for (const t of tokens) {
        if (_EX_OPS.includes(t)) {
          if (d < 2) throw { message: `运算符「${t}」处栈内操作数不足——后缀式记号顺序有误` };
          d--;
        } else d++;
      }
      return { mode: 'eval', tokens };
    }

    /* ---- 中缀 → 后缀 ---- */
    const src = String(vals.expr).replace(/\s+/g, '');
    if (!src) throw { message: '请输入中缀表达式' };
    if (src.length > 24) throw { message: '表达式过长（≤ 24 个字符），演示看不清' };
    const tokens = [];
    let i = 0, operands = 0, operators = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/[0-9a-zA-Z]/.test(ch)) {
        let j = i;
        while (j < src.length && /[0-9a-zA-Z]/.test(src[j])) j++;
        tokens.push(src.slice(i, j)); operands++; i = j;
      } else if (_EX_OPS.includes(ch)) {
        tokens.push(ch); operators++; i++;
      } else if (ch === '(' || ch === ')') {
        tokens.push(ch); i++;
      } else {
        throw { message: `存在无法识别的字符「${ch}」（只支持操作数、+ - * / 和括号）` };
      }
    }
    /* 结构校验先行（比长度/数量检查定位更准） */
    let expectOperand = true, depth = 0;
    for (const t of tokens) {
      if (t === '(') {
        if (!expectOperand) throw { message: '左括号「(」不能紧跟在操作数或右括号之后（如 a(b+c) 应写成 a*(b+c)）' };
        depth++; continue;
      }
      if (t === ')') {
        if (expectOperand) throw { message: '右括号「)」前缺少操作数（或空括号）' };
        if (depth === 0) throw { message: '括号不匹配：多余的右括号「)」' };
        depth--; continue;
      }
      if (expectOperand && _EX_OPS.includes(t)) throw { message: `运算符「${t}」缺少左操作数` };
      if (!expectOperand && !_EX_OPS.includes(t)) throw { message: `操作数「${t}」前缺少运算符` };
      expectOperand = !expectOperand;
    }
    if (depth !== 0) throw { message: '括号不匹配：左括号「(」未闭合' };
    if (expectOperand) throw { message: '表达式以运算符结尾，缺少右操作数' };
    if (tokens.length < 3) throw { message: '表达式太短，至少形如 a+b' };
    if (operands !== operators + 1) throw { message: `操作数 ${operands} 个、运算符 ${operators} 个——数量不匹配，请检查表达式` };
    return { mode: 'toPost', tokens };
  },

  /* ------------------------------ 快照生成（纯算法，零 DOM） ------------------------------ */
  buildSnapshots(model) {
    return model.mode === 'eval' ? this._snapEval(model) : this._snapToPost(model);
  },

  /* 中缀 → 后缀：每步全量携带 运算符栈 / 已生成后缀式 的副本 */
  _snapToPost(model) {
    const T = model.tokens;
    const opStack = [], out = [];
    let i = -1, maxDepth = 0;
    const snaps = [];
    const push = (action, o) => snaps.push({
      mode: 'toPost', action, step: action, tokens: [...T], i, opStack: [...opStack], out: [...out], maxDepth,
      cur: i >= 0 && i < T.length ? T[i] : '', popped: '',
      log: '', logType: 'info', desc: '', ...o,
    });

    push('init', { log: `就绪：中缀式 ${T.join(' ')}。规则：操作数直接输出；运算符弹出栈顶优先级 ≥ 自己的再入栈。`, desc: '点击「单步执行」逐符号扫描' });

    for (i = 0; i < T.length; i++) {
      const t = T[i];
      if (!_EX_OPS.includes(t) && t !== '(' && t !== ')') {          // 操作数
        out.push(t);
        push('operand', { log: `操作数「${t}」→ 直接加入后缀式（操作数相对顺序不变）`, logType: 'info', desc: `输出操作数 ${t}` });
      } else if (t === '(') {
        opStack.push(t);
        maxDepth = Math.max(maxDepth, opStack.length);
        push('push', { log: `「(」入栈（左括号只起隔离作用，等待配对的「)」）`, desc: `左括号入栈，栈深 ${opStack.length}` });
      } else if (t === ')') {
        while (opStack[opStack.length - 1] !== '(') {
          const p = opStack.pop();
          out.push(p);
          push('pop', { popped: p, log: `遇到「)」→ 弹出「${p}」加入后缀式`, logType: 'info', desc: `弹栈输出 ${p}` });
        }
        opStack.pop();
        push('paren', { popped: '(', log: `弹出「(」——左括号出栈但**不**加入后缀式`, logType: 'info', desc: '丢弃左括号' });
      } else {
        while (opStack.length && opStack[opStack.length - 1] !== '(' && _EX_PREC[opStack[opStack.length - 1]] >= _EX_PREC[t]) {
          const p = opStack.pop();
          out.push(p);
          push('pop', { popped: p, log: `栈顶「${p}」优先级 ≥ 「${t}」→ 弹出加入后缀式（同级左结合，先入栈先弹）`, logType: 'info', desc: `弹栈输出 ${p}` });
        }
        opStack.push(t);
        const record = opStack.length > maxDepth;
        maxDepth = Math.max(maxDepth, opStack.length);
        push('push', { log: `「${t}」入栈（栈深 ${opStack.length}${record ? '，创最大深度新高！' : ''}）`,
          logType: record ? 'success' : 'info', desc: `${t} 入栈，栈深 ${opStack.length}` });
      }
    }
    while (opStack.length) {
      const p = opStack.pop();
      out.push(p);
      i = T.length;                                                  // 结束阶段：扫描指针停在末尾
      push('pop', { popped: p, log: `扫描结束 → 弹出栈内剩余「${p}」加入后缀式`, logType: 'info', desc: `清栈输出 ${p}` });
    }
    i = T.length;
    push('done', { log: `✓ 转换完成！后缀式：${out.join(' ')}；过程中运算符栈最大深度 = ${maxDepth}。`, logType: 'success', desc: `后缀式 ${out.join(' ')}` });
    return snaps;
  },

  /* 后缀求值：每步全量携带 操作数栈 副本与本次计算记录 */
  _snapEval(model) {
    const T = model.tokens;
    const stack = [];
    let i = -1, maxDepth = 0;
    const snaps = [];
    const fmt = v => Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    const push = (action, o) => snaps.push({
      mode: 'eval', action, step: action, tokens: [...T], i, stack: [...stack], maxDepth,
      calc: null,
      log: '', logType: 'info', desc: '', ...o,
    });

    push('init', { log: `就绪：后缀式 ${T.join(' ')}。规则：操作数入栈；运算符弹出两个操作数计算后压回。`, desc: '点击「单步执行」逐记号扫描' });

    for (i = 0; i < T.length; i++) {
      const t = T[i];
      if (!_EX_OPS.includes(t)) {
        stack.push(parseFloat(t));
        maxDepth = Math.max(maxDepth, stack.length);
        push('operand', { log: `操作数「${t}」入栈（栈深 ${stack.length}）`, desc: `${t} 入栈` });
      } else {
        const b = stack.pop(), a = stack.pop();
        if (t === '/' && b === 0) {
          push('error', { log: `✗ 除数为 0（计算 ${fmt(a)} ÷ ${fmt(b)}），表达式无意义，演示终止。`, logType: 'error', desc: '除数为 0' });
          return snaps;
        }
        const r = t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : a / b;
        stack.push(r);
        maxDepth = Math.max(maxDepth, stack.length);
        push('calc', { calc: { a, op: t, b, r }, log: `遇运算符「${t}」→ 弹出 ${fmt(b)}（右）、${fmt(a)}（左），计算 ${fmt(a)} ${t} ${fmt(b)} = ${fmt(r)}，结果压回`, logType: 'info', desc: `${fmt(a)} ${t} ${fmt(b)} = ${fmt(r)}` });
      }
    }
    i = T.length;
    push('done', { log: `✓ 计算完成！栈中唯一元素即表达式值：${fmt(stack[0])}。`, logType: 'success', desc: `结果 = ${fmt(stack[0])}` });
    return snaps;
  },

  /* ------------------------------ 渲染（纯渲染，只读快照） ------------------------------ */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const U = RC408.ui, ESC = RC408.util.esc;

    /* 记号条：已处理（淡）/ 当前（琥珀）/ 未到（灰） */
    const chipFor = (t, k) => {
      if (k < s.i) return U.chip(t, 'chip opacity-40', '已处理');
      if (k === s.i) return U.chip(t, 'chip-check', '当前扫描');
      return U.chip(t, 'chip', '未扫描');
    };
    const strip = `<div class="flex flex-wrap gap-1.5">${s.tokens.map(chipFor).join('')}</div>`;

    /* 竖式栈（列反转：arr[0] 在栈底；栈顶琥珀高亮） */
    const vertStack = arr => (arr.length
      ? `<div class="inline-flex flex-col-reverse gap-1">
           ${arr.map((c, k) => `<div class="frame-cell" style="width:64px;height:40px;border-radius:9px;${k === arr.length - 1 ? 'border-color:#f59e0b;background:#fffbeb;' : ''}">
               <span class="page-num" style="font-size:15px">${ESC(String(c))}</span>
             </div>`).join('')}
         </div>`
      : `<div class="text-xs text-slate-400 py-3">（空栈）</div>`);
    const topArrow = arr => (arr.length
      ? `<div class="flex flex-col-reverse gap-1 text-[11px] font-bold text-amber-600">
           ${arr.map((_, k) => `<div class="flex items-center" style="height:40px">${k === arr.length - 1 ? '← 栈顶' : ''}</div>`).join('')}
         </div>` : '');

    let stats, main, footer;
    if (s.mode === 'toPost') {
      const lastOut = s.out.length && (s.action === 'operand' || s.action === 'pop') ? s.out.length - 1 : -1;
      stats =
        U.statCard('已扫描记号', `${Math.min(s.i + 1, s.tokens.length)} / ${s.tokens.length}`, `中缀式共 ${s.tokens.length} 个记号`, 'text-indigo-600') +
        U.statCard('运算符栈深', s.opStack.length, '栈顶琥珀色高亮', 'text-amber-600') +
        U.statCard('栈最大深度', s.maxDepth, '高频考点（2014-2 同款）', 'text-emerald-600') +
        U.statCard('状态', s.step === 'done' ? '转换完成 ✓' : '转换中…', s.step === 'done' ? `${s.out.length} 个记号` : '逐符号扫描', s.step === 'done' ? 'text-emerald-600' : 'text-slate-500');
      main = `
        <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4">
          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
            ${U.sectionTitle('运算符栈（自下而上）')}
            <div class="flex gap-1 items-end min-h-16">${topArrow(s.opStack)}${vertStack(s.opStack)}</div>
            <div class="text-[10px] text-slate-400 mt-2 border-t border-dashed border-slate-300 pt-1 text-center w-16">栈底</div>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
            ${U.sectionTitle('后缀式生成区（绿 = 刚加入）')}
            <div class="flex flex-wrap gap-1.5 min-h-10">${s.out.map((c, k) => U.chip(c, k === lastOut ? 'chip-hit' : 'chip', '后缀式')).join('') || '<span class="text-xs text-slate-400">（尚未产生输出）</span>'}</div>
          </div>
        </div>`;
      footer = `💡 <b>考点提醒：</b>运算符弹出条件是"栈顶优先级 ≥ 当前"（同级左结合）；左括号出栈不输出；
        转换后 <b>操作数相对顺序不变</b>。速算法：按优先级全加括号 → 运算符移到括号外 → 去括号（2024-2 官方解法）。`;
    } else {
      stats =
        U.statCard('已扫描记号', `${Math.min(s.i + 1, s.tokens.length)} / ${s.tokens.length}`, `后缀式共 ${s.tokens.length} 个记号`, 'text-indigo-600') +
        U.statCard('操作数栈深', s.stack.length, '栈顶琥珀色高亮', 'text-amber-600') +
        U.statCard('栈最大深度', s.maxDepth, '过程中最大', 'text-emerald-600') +
        U.statCard('当前结果', s.stack.length ? String(s.stack[s.stack.length - 1]) : '—', s.step === 'done' ? '即表达式值 ✓' : '栈顶值', s.step === 'done' ? 'text-emerald-600' : 'text-slate-500');
      const calc = s.calc
        ? `<div class="rounded-xl bg-sky-50 border border-sky-200 px-4 py-2 text-sm text-sky-900 font-mono font-bold">${s.calc.a} ${s.calc.op} ${s.calc.b} = ${s.calc.r}</div>`
        : '';
      main = `
        <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4">
          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
            ${U.sectionTitle('操作数栈（自下而上）')}
            <div class="flex gap-1 items-end min-h-16">${topArrow(s.stack)}${vertStack(s.stack)}</div>
            <div class="text-[10px] text-slate-400 mt-2 border-t border-dashed border-slate-300 pt-1 text-center w-16">栈底</div>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-3">
            ${U.sectionTitle('本次计算')}
            ${calc || '<span class="text-xs text-slate-400">（扫描到运算符时显示一次计算）</span>'}
          </div>
        </div>`;
      footer = `💡 <b>考点提醒：</b>遇运算符先弹出的是<b>右操作数</b>，再弹的是左操作数；后缀式<b>不含括号</b>、
        运算符顺序即计算顺序。考研求值题通常能整除，本演示除法按实数处理。`;
    }

    const doneBanner = s.step === 'done'
      ? `<div class="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800 font-bold">${ESC(s.desc)}</div>`
      : '';
    const errBanner = s.step === 'error'
      ? `<div class="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm text-rose-800 font-bold">${ESC(s.desc)}</div>`
      : '';

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${U.sectionTitle(s.mode === 'toPost' ? '中缀式记号流（琥珀 = 当前扫描）' : '后缀式记号流（琥珀 = 当前扫描）')}
          ${strip}
        </div>
        ${main}
        ${doneBanner}${errBanner}
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">${footer}</div>
      </div>`;
  },
});
