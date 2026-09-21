'use strict';
/* ============================================================================
 * coa-muldiv.js —— 【计算机组成原理】乘除运算电路（即时计算器）（前缀 _md）
 * 模式：instant（改输入即出完整竖式表，无快照）
 * 考点：
 *   · 原码一位乘法：n 拍，每拍「看乘数末位 → 部分积 += 被乘数 → (部分积,乘数) 右移一位」；
 *   · 原码加减交替除法（不恢复余数法）：n 拍，每拍「余数左移 → 按余数符号加/减除数 → 上商」，
 *     最后余数为负时再 +除数 恢复；
 *   · 溢出/异常：除数为 0、或定点小数除法中 |被除数| ≥ |除数| ⇒ 商溢出（2025-44 idiv 异常考点）。
 * 口径（写死在代码里，避免后来者改错）：
 *   · 一律 **定点小数** 口径（教材口径）：输入 n 位二进制数表示 0.x₁x₂…xₙ；
 *   · 除法恒等式用**整数分子**表达：xv·2ⁿ = q·yv + R（R 为恢复后的余数，0 ≤ R < yv）；
 *     余数真值 = R ÷ 2ⁿ（即教材写的"余数 0.000…R"要再右移 n 位）；
 *   · "n"是**数值位数**，不是字节数（§3.8-12 量纲教训）。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-muldiv',
  mode: 'instant',
  title: '乘除运算电路（原码一位乘 · 加减交替除法）',

  theory: `
> **为什么要有它**：ALU 里只有加法器，而乘除本质是"多次加 / 减 + 移位"的组合——搞清**哪一拍加什么、往哪边移**，就能把乘除法电路的手算过程写出来。
> **怎么实现**：原码一位乘按"看乘数最低位决定加不加被乘数 → 整体右移"重复 n 拍；除法用**加减交替法**，按余数符号决定加减除数、由新余数符号上商。
> **记住什么**：**n 位乘法 = n 次加 + n 次右移** + 除法要求 **|被除数| < |除数|**（否则商溢出）+ 两类除法异常。

## 一、原码一位乘法（n 拍）
- **符号位单独处理**：积的符号 = 被乘数符号 ⊕ 乘数符号，数值部分按无符号相乘；
- 每拍做两件事：① 看**乘数最低位**——为 1 则"部分积 += 被乘数"、为 0 则加 0；
  ② **(部分积, 乘数) 整体逻辑右移一位**（部分积最低位进乘数最高位）；
- n 拍后 (部分积, 乘数) 拼起来就是 **2n 位积**；
- 阵列乘法器是组合逻辑一遍出结果（1 个周期），"ALU + 移位器"要多周期。

## 二、原码加减交替除法（不恢复余数法，n 拍）
- 前提是 **|被除数| < |除数|**（定点小数要求商的绝对值小于 1），否则**商溢出**；
- 每拍：**余数左移一位** → 按当前余数符号"减除数"（余数 ≥ 0）或"加除数"（余数 < 0）→ 由**新余数**符号上商（≥ 0 上 1、< 0 上 0）；
- n 拍得 n 位商；**最后余数若为负，要 +除数 恢复**才是正确余数；
- 与"恢复余数法"相比省掉每拍的恢复加法 → **加减交替法更快**。

## 三、两个异常（2025-44）
- **除数为 0** → 除法异常（idiv 直接触发）；
- **商溢出**（|被除数| ≥ |除数|）→ 商超出表示范围 → 同样触发异常。

## 考点提醒（易错点）
1. 乘法里是**逻辑右移**、部分积最低位进乘数最高位——别写成算术右移；
2. 除法里"**先加减、后上商**"，上商看的是**新**余数的符号，顺序别倒；
3. 原码乘法**先定符号、再算数值**，符号位不参加数值运算；
4. 与「补码加减」共用 2012-43 / 2021-43 两道大题（按"大题可对应多个知识点"各自登记）。

> **真题考情**：**7/18 年（选 1 + 大题 6）**：大 2012-43（2×x 用左移或加法）、2016-44（7 位 ASCII 串行加 + 移位）、
> 2019-45（imul 何时置 OF=1）、2020-43（用加法与移位实现乘法）、2021-43（带符号乘法 01B3H）、2025-44（idiv 异常）；选 2024-15。
`,

  inputs: [
    { key: 'mode', label: '运算', type: 'select', default: 'mul', wide: true,
      options: [{ v: 'mul', t: '原码一位乘法（n 拍：加 + 右移）' }, { v: 'div', t: '原码加减交替除法（n 拍：左移 + 加减）' }] },
    { key: 'x', label: '被乘数 / 被除数（二进制位串，表示 0.x₁…xₙ）', default: '1011', wide: true,
      help: '只填小数点后的数值位，如 1011 表示 0.1011；最多 8 位' },
    { key: 'y', label: '乘数 / 除数（同上）', default: '1101', wide: true, help: 'n 以两者中较长的位数为准，短的左边补零' },
  ],

  quickActions: [
    { label: '📘 教材例：0.1011 × 0.1101（原码一位乘）', run(rt) { rt.setInput('mode', 'mul'); rt.setInput('x', '1011'); rt.setInput('y', '1101'); rt.load(); } },
    { label: '📘 教材例：0.1011 ÷ 0.1101（加减交替）', run(rt) { rt.setInput('mode', 'div'); rt.setInput('x', '1011'); rt.setInput('y', '1101'); rt.load(); } },
    { label: '🎯 2025-44 同款：除数为 0 → 除法异常', run(rt) { rt.setInput('mode', 'div'); rt.setInput('x', '1011'); rt.setInput('y', '0000'); rt.load(); } },
    { label: '🎯 2025-44 同款：被除数 ≥ 除数 → 商溢出', run(rt) { rt.setInput('mode', 'div'); rt.setInput('x', '1101'); rt.setInput('y', '1011'); rt.load(); } },
    { label: '🎯 2020-43 同款：6 位"加法+移位"实现乘法', run(rt) { rt.setInput('mode', 'mul'); rt.setInput('x', '100100'); rt.setInput('y', '010101'); rt.load(); } },
    { label: '除法：恰好整除的例子（0.0010 ÷ 0.1000 = 0.0100）', run(rt) { rt.setInput('mode', 'div'); rt.setInput('x', '0010'); rt.setInput('y', '1000'); rt.load(); } },
  ],

  parse(vals) {
    const mode = vals.mode === 'div' ? 'div' : 'mul';
    const clean = (s, name) => {
      const v = String(s == null ? '' : s).trim();
      if (!v) throw { message: `请输入${name}（二进制位串）` };
      if (!/^[01]+$/.test(v)) throw { message: `${name}只能含 0 与 1（不含小数点）` };
      if (v.length > 8) throw { message: `${name}最多 8 位（本演示为竖式表格，位数过多看不清）` };
      return v;
    };
    let xs = clean(vals.x, '被乘数/被除数'), ys = clean(vals.y, '乘数/除数');
    const n = Math.max(xs.length, ys.length);
    xs = xs.padStart(n, '0'); ys = ys.padStart(n, '0');
    const xv = parseInt(xs, 2), yv = parseInt(ys, 2);
    const bin = (v, w) => (v < 0 ? '-' + Math.abs(v).toString(2).padStart(w, '0') : v.toString(2).padStart(w, '0'));
    const R = { mode, n, xs, ys, xv, yv, bin, kind: 'ok', steps: [], err: '' };

    if (mode === 'mul') {
      let A = 0, Q = yv;
      for (let i = 1; i <= n; i++) {
        const bit = Q & 1;                       // 乘数最低位
        const add = bit ? xv : 0;
        const aBefore = A, aAfterAdd = A + add;
        const qBefore = Q;
        const combined = aAfterAdd * Math.pow(2, n) + Q;
        const shifted = Math.floor(combined / 2);
        A = Math.floor(shifted / Math.pow(2, n));
        Q = shifted % Math.pow(2, n);
        R.steps.push({ i, bit, aBefore, add, aAfterAdd, qBefore, shiftFrom: combined, A, Q,
          shiftFromStr: bin(combined, 2 * n + 1) });
      }
      R.prod = A * Math.pow(2, n) + Q;
      R.prodStr = bin(R.prod, 2 * n);
      R.prodFrac = R.prod / Math.pow(2, 2 * n);
      R.expect = xv * yv;                        // 独立第二条路径：整数相乘
      R.bitsA = n + 1;
    } else {
      if (yv === 0) { R.kind = 'divzero'; R.err = '除数为 0：定点除法器执行 idiv 时直接触发除法异常（2025-44 考点）。'; return R; }
      if (xv >= yv) { R.kind = 'overflow'; R.err = '被除数 ≥ 除数：定点小数除法要求 |被除数| < |除数|，否则商溢出（商 ≥ 1 放不下）→ 触发除法异常。'; return R; }
      let r = xv, q = 0, qBits = [];
      for (let i = 1; i <= n; i++) {
        const rShift = r * 2;                    // 余数左移一位
        const op = rShift >= 0 ? 'sub' : 'add';
        const rNew = op === 'sub' ? rShift - yv : rShift + yv;
        const qb = rNew >= 0 ? 1 : 0;
        q = q * 2 + qb; qBits.push(qb);
        R.steps.push({ i, rBefore: r, rShift, op, rNew, qb });
        r = rNew;
      }
      let Rf = r, restored = false;
      if (Rf < 0) { Rf += yv; restored = true; }
      R.q = q; R.qBits = qBits; R.qStr = qBits.join(''); R.rem = Rf; R.restored = restored;
      R.remStr = bin(Rf, n); R.remFrac = Rf / Math.pow(2, n);
      R.expect = xv * Math.pow(2, n);            // 独立第二条路径：q·yv + R = xv·2ⁿ
    }
    return R;
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const card = (t, v, s, c) => RC408.ui.statCard(t, v, s, c);
    const head = `<tr class="text-[11px] text-slate-400">`;

    /* ---------- 异常卡（除法异常） ---------- */
    if (m.kind !== 'ok') {
      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            ${card('运算', '原码加减交替除法', `数值位数 n = ${m.n}`, 'text-slate-800')}
            ${card('被除数', '0.' + m.xs, `= ${m.xv}/${Math.pow(2, m.n)}`, 'text-indigo-600')}
            ${card('除数', '0.' + m.ys, `= ${m.yv}/${Math.pow(2, m.n)}`, 'text-rose-600')}
          </div>
          <div class="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-900 leading-relaxed">
            ⛔ <b>${m.kind === 'divzero' ? '除法异常：除数为 0' : '除法异常：商溢出'}</b><br>${m.err}
          </div>
          <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
            💡 <b>考点提醒：</b>2025-44 就是"补码除法器执行 idiv 时为什么触发异常"——两类原因要分清：
            <b>除数为 0</b> 与 <b>商超出表示范围</b>（定点小数除法要求 |被除数| &lt; |除数|）。
          </div>
        </div>`;
      return;
    }

    /* ---------- 乘法竖式 ---------- */
    if (m.mode === 'mul') {
      const rows = m.steps.map(s => `
        <tr class="border-b border-slate-100">
          <td class="px-2 py-1 text-right text-slate-500">${s.i}</td>
          <td class="px-2 py-1 font-mono ${s.bit ? 'text-emerald-600 font-bold' : 'text-slate-400'}">${s.bit}</td>
          <td class="px-2 py-1 font-mono text-indigo-600">${s.bit ? '+ 0.' + m.xs : '+ 0'}</td>
          <td class="px-2 py-1 font-mono text-right">${m.bin(s.aAfterAdd, m.bitsA)}</td>
          <td class="px-2 py-1 font-mono text-right text-slate-400">${m.bin(s.shiftFrom, 2 * m.n + 1)} &gt;&gt; 1</td>
          <td class="px-2 py-1 font-mono text-right font-bold">${m.bin(s.A, m.n)} <span class="text-slate-300">|</span> ${m.bin(s.Q, m.n)}</td>
        </tr>`).join('');
      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${card('被乘数 x', '0.' + m.xs, `= ${m.xv}/${Math.pow(2, m.n)}`, 'text-indigo-600')}
            ${card('乘数 y', '0.' + m.ys, `= ${m.yv}/${Math.pow(2, m.n)}`, 'text-indigo-600')}
            ${card('积（2n 位）', '0.' + m.prodStr, `= ${m.prod}/${Math.pow(2, 2 * m.n)} = ${m.prodFrac}`, 'text-emerald-600')}
            ${card('拍数', m.n + ' 拍', '每拍 = 加一次 + 右移一位', 'text-amber-600')}
          </div>
          <div class="rounded-xl bg-white border border-slate-200 px-4 py-3 overflow-x-auto">
            ${RC408.ui.sectionTitle('原码一位乘竖式：部分积 + 乘数（每拍右移一位）')}
            <table class="w-full text-sm">
              <thead>${head}
                <th class="px-2 py-1 text-right">拍</th><th class="px-2 py-1 text-left">乘数末位</th>
                <th class="px-2 py-1 text-left">加数</th><th class="px-2 py-1 text-right">加后部分积</th>
                <th class="px-2 py-1 text-right">右移前（部分积|乘数）</th><th class="px-2 py-1 text-right">右移后（部分积|乘数）</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="mt-2 text-xs text-slate-600">
              计数校验：整数口径 <b class="font-mono">${m.xv} × ${m.yv} = ${m.expect}</b>，
              竖式得 <b class="font-mono">${m.prod}</b>（两者必须相等 → 竖式没走错）；
              写成 0.x 小数就是 <b>0.${m.xs} × 0.${m.ys} = 0.${m.prodStr}</b>。
            </div>
          </div>
          <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
            💡 <b>考点提醒：</b>符号位单独处理（积的符号 = 两数符号异或），数值部分就是上表这种
            <b>"n 次加 + n 次右移"</b>；<b>2020-43</b> 要求"用加法与移位实现乘法"考的就是这个套路。
            硬件上不用真循环 n 次的方法叫<b>阵列乘法器</b>（组合逻辑一遍出结果，2024-15 考过它与
            "ALU + 移位器多周期"的对比）。
          </div>
        </div>`;
      return;
    }

    /* ---------- 除法竖式 ---------- */
    const rows = m.steps.map(s => `
      <tr class="border-b border-slate-100">
        <td class="px-2 py-1 text-right text-slate-500">${s.i}</td>
        <td class="px-2 py-1 font-mono text-right">${s.rBefore < 0 ? '-' : ''}${binAbs(s.rBefore)}</td>
        <td class="px-2 py-1 font-mono text-right text-slate-500">${s.rShift < 0 ? '-' : ''}${binAbs(s.rShift)}</td>
        <td class="px-2 py-1 font-mono ${s.op === 'sub' ? 'text-rose-600' : 'text-emerald-600'}">${s.op === 'sub' ? '- 0.' + m.ys : '+ 0.' + m.ys}</td>
        <td class="px-2 py-1 font-mono text-right font-bold">${s.rNew < 0 ? '-' : ''}${binAbs(s.rNew)}</td>
        <td class="px-2 py-1 font-mono font-bold ${s.qb ? 'text-emerald-600' : 'text-slate-400'}">${s.qb}</td>
      </tr>`).join('');
    function binAbs(v) { const s = Math.abs(v).toString(2).padStart(m.n, '0'); return s; }

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${card('被除数 x', '0.' + m.xs, `= ${m.xv}/${Math.pow(2, m.n)}`, 'text-indigo-600')}
          ${card('除数 y', '0.' + m.ys, `= ${m.yv}/${Math.pow(2, m.n)}`, 'text-indigo-600')}
          ${card('商（n 位）', '0.' + m.qStr, `= ${m.q}/${Math.pow(2, m.n)}`, 'text-emerald-600')}
          ${card('余数', (m.rem < 0 ? '-' : '') + '0.' + m.remStr, `真值 = ${m.rem}÷2^${m.n} = ${m.remFrac}${m.restored ? '（已恢复余数）' : ''}`, 'text-amber-600')}
        </div>
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('加减交替除法竖式：余数左移 → 按余数符号加/减除数 → 上商')}
          <table class="w-full text-sm">
            <thead>${head}
              <th class="px-2 py-1 text-right">拍</th><th class="px-2 py-1 text-right">余数 R</th>
              <th class="px-2 py-1 text-right">R 左移一位</th><th class="px-2 py-1 text-left">加/减除数</th>
              <th class="px-2 py-1 text-right">新余数</th><th class="px-2 py-1 text-left">商位</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="mt-2 text-xs text-slate-600 leading-relaxed">
            恒等式校验（整数分子口径）：<b class="font-mono">x·2ⁿ = 商 × y + 余数</b> →
            <b class="font-mono">${m.xv}×${Math.pow(2, m.n)} = ${m.q}×${m.yv} + ${m.rem} = ${m.q * m.yv + m.rem}</b>
            ${m.restored ? '（最后一拍余数为负，已 +除数 恢复）' : '（最后一拍余数已为正，无需恢复）'}
          </div>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>① 加减交替法<b>不再单独"恢复余数"</b>，每拍只做一次加减，比恢复余数法快；
          ② 商位由<b>新余数的符号</b>决定（≥0 上商 1）；③ 除法异常的两种来源见下（把除数改成 0000 或让被除数 ≥ 除数试一下）。
        </div>
      </div>`;
  },

  logs(m) {
    if (m.kind === 'divzero') return [{ type: 'error', text: `除数为 0（0.${m.ys}）→ 除法异常` }];
    if (m.kind === 'overflow') return [{ type: 'error', text: `被除数 0.${m.xs} ≥ 除数 0.${m.ys} → 定点小数除法商溢出（异常）` }];
    if (m.mode === 'mul') {
      return [
        { type: 'info', text: `原码一位乘：n = ${m.n} 拍，每拍"看乘数末位 → 加被乘数 → 右移一位"` },
        { type: 'success', text: `0.${m.xs} × 0.${m.ys} = 0.${m.prodStr}（整数校验 ${m.xv}×${m.yv}=${m.expect}）` },
        { type: 'info', text: '积的符号位单独处理：被乘数符号 ⊕ 乘数符号' },
      ];
    }
    return [
      { type: 'info', text: `加减交替除法：n = ${m.n} 拍，每拍"余数左移 → 按符号加/减除数 → 上商"` },
      { type: 'success', text: `0.${m.xs} ÷ 0.${m.ys} = 0.${m.qStr} … 余数 ${m.rem}（真值 ${m.remFrac}）${m.restored ? '，末拍已恢复余数' : ''}` },
      { type: 'info', text: `恒等式 x·2ⁿ = 商×y + 余数：${m.xv * Math.pow(2, m.n)} = ${m.q * m.yv + m.rem}` },
    ];
  },
});
