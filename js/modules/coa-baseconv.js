'use strict';
/* ============================================================================
 * coa-baseconv.js —— 【计算机组成原理】进位计数制与转换（即时计算器）（前缀 _bc）
 * 模式：instant（改输入即出结果，无快照）
 * 考点：二/八/十/十六进制互转；整数"除基取余、倒序"、小数"乘基取整、正序"；
 *       2^k 进制之间按位分组重组；按权展开求和；十进制小数未必能精确表示。
 * 口径（写在代码里，免得后面改错）：
 *   · 小数转换一律用 **整数分子/分母** 精确算（fracNum / S^len），不用浮点，
 *     否则 0.3 这类数在 double 下乘基取整会算出假数字；
 *   · "位数"上限 12 位（整数与小数各），保证 S^len ≤ 16^12 = 2^48 < 2^53 不丢精度；
 *   · "N 位"一律指**位数**，不是字节数（§3.8-12 的量纲教训）。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-baseconv',
  mode: 'instant',
  title: '进位计数制与转换（R 进制互转）',

  theory: `
> **为什么要有它**：机器里存的是二进制，而机器数、地址、机器码在人眼里都写成十六进制——**同一个数的不同书写法之间的换算**，是把题目"读进来"的第一步。
> **怎么实现**：整数用**除基取余、倒序**，小数用**乘基取整、正序**，2 的幂进制之间直接**按位分组重组**。
> **记住什么**：三条换算规则 + **小数可能永远乘不到 0，只能按精度截断（截断即引入误差）**。

## 四条规则（必背）
1. **2 的幂进制之间免计算**：二↔八 3 位一组、二↔十六 **4 位一组**，以小数点为界向两侧分组、不足补零；
2. **十进制整数 → R 进制**：除基取余、**倒序**（先得的余数是低位）；
3. **十进制小数 → R 进制**：乘基取整、**正序**（先得的整数位是高位）；小数部分可能永远乘不到 0（如 0.3）；
4. **按权展开求和**：\\(N = \\sum d_i \\times R^{i}\\)。

## 考点提醒（易错点）
1. **1 位十六进制 = 4 位二进制、1 位八进制 = 3 位二进制**；"地址 40 位 → 多少位十六进制"是**位数换算、不是容量换算**；
2. 它是**嵌入型**考点——机器数书写（2023-13 的 short 十六进制机器数、2025-12 补码转无符号真值）、
   截断换算（2024-12 的 int→short）、地址展开（2018-45、2020-46）、机器码写十六进制（2017-43），**第一步都要换算进制**；
3. 小数换算的位数要按题给精度截断，**多写一位就是错的**。

> **真题考情**：**10/18 年（选 5 + 大题 5）**：选 2021-13、2022-15、2023-13、2024-12、2025-12；
> 大 2009-44、2012-43、2017-43、2018-45、2020-46（都出现在各大题的第一小步里）。
`,

  inputs: [
    { key: 'src', label: '源进制', type: 'select', default: '10', wide: true,
      options: [{ v: '2', t: '2 二进制' }, { v: '8', t: '8 八进制' }, { v: '10', t: '10 十进制' }, { v: '16', t: '16 十六进制' }] },
    { key: 'dst', label: '目标进制', type: 'select', default: '2', wide: true,
      options: [{ v: '2', t: '2 二进制' }, { v: '8', t: '8 八进制' }, { v: '10', t: '10 十进制' }, { v: '16', t: '16 十六进制' }] },
    { key: 'val', label: '待转换的数（按源进制书写，可带小数点）', default: '173.6875', wide: true,
      help: '例：173.6875（十进制）、1010.11（二进制）、7ff（十六进制，字母不分大小写）' },
    { key: 'bits', label: '小数部分最多保留位数', default: '8', help: '乘基取整的迭代上限；除不尽时会提示"不能精确表示"' },
  ],

  quickActions: [
    { label: '📘 教材易错点：十进制小数截断（0.3 转二进制永远乘不到 0）', run(rt) { rt.setInput('src', '10'); rt.setInput('dst', '2'); rt.setInput('val', '0.3'); rt.setInput('bits', '8'); rt.load(); } },
    { label: '🔗 2^k 重组：十六进制 ↔ 二进制（1 位 = 4 位，2025-12 的换算步）', run(rt) { rt.setInput('src', '16'); rt.setInput('dst', '2'); rt.setInput('val', '3f.8'); rt.setInput('bits', '8'); rt.load(); } },
    { label: '整数：除基取余（173 → 二进制）', run(rt) { rt.setInput('src', '10'); rt.setInput('dst', '2'); rt.setInput('val', '173'); rt.load(); } },
    { label: '小数：乘基取整（0.6875 → 二进制，可精确）', run(rt) { rt.setInput('src', '10'); rt.setInput('dst', '2'); rt.setInput('val', '0.6875'); rt.load(); } },
    { label: '八进制 ↔ 二进制（3 位一组）', run(rt) { rt.setInput('src', '8'); rt.setInput('dst', '2'); rt.setInput('val', '527'); rt.load(); } },
    { label: '反查：二进制 → 十进制（按权展开）', run(rt) { rt.setInput('src', '2'); rt.setInput('dst', '10'); rt.setInput('val', '10101101.1011'); rt.load(); } },
  ],

  parse(vals) {
    const DIG = '0123456789abcdef';
    const S = Number(vals.src), D = Number(vals.dst);
    if (!(S >= 2 && S <= 16) || !(D >= 2 && D <= 16)) throw { message: '源进制与目标进制须在 2~16 之间' };
    const bits = Number(vals.bits);
    if (!(bits >= 1 && bits <= 12)) throw { message: '小数保留位数须为 1~12 的整数' };

    const raw = String(vals.val == null ? '' : vals.val).trim().toLowerCase().replace(/^0x/, '');
    if (!raw) throw { message: '请输入待转换的数' };
    if (!/^[0-9a-f]*\.?[0-9a-f]*$/.test(raw) || raw === '.') throw { message: '只能包含 0-9、a-f 与一个小数点' };
    let [ip, fp] = raw.split('.');
    fp = fp || '';
    if (ip === '') ip = '0';
    for (const ch of ip + fp) {
      const d = DIG.indexOf(ch);
      if (d < 0 || d >= S) throw { message: `「${ch}」不是 ${S} 进制数字（合法字符：0-${DIG[S - 1]}）` };
    }
    if (ip.length > 12) throw { message: '整数部分最多 12 位' };
    if (fp.length > 12) throw { message: '小数部分最多 12 位' };

    /* ① 源进制 → 十进制：按权展开（用整数分子/分母，避免浮点误差） */
    const intTerms = [];
    let intDec = 0;
    [...ip].forEach((ch, k) => {
      const w = ip.length - 1 - k;                 // 位权指数
      const v = DIG.indexOf(ch) * Math.pow(S, w);
      intTerms.push({ d: ch, w, dv: DIG.indexOf(ch), v });
      intDec += v;
    });
    const fracTerms = [];
    let fracNum = 0;
    const fracDen = Math.pow(S, fp.length) || 1;
    if (fp.length) {
      fracNum = parseInt(fp.split('').map(c => DIG.indexOf(c)).join('') || '0', 10);
      // 用逐位累加更稳（避免把 "0a" 拼成数字）
      fracNum = fp.split('').reduce((a, c) => a * S + DIG.indexOf(c), 0);
      fp.split('').forEach((ch, k) => {
        fracTerms.push({ d: ch, w: -(k + 1), dv: DIG.indexOf(ch), num: DIG.indexOf(ch), den: Math.pow(S, k + 1) });
      });
    }

    /* ② 十进制整数 → 目标进制：除基取余、倒序 */
    const intSteps = [];
    let q = intDec;
    if (q === 0) intSteps.push({ dividend: 0, quotient: 0, rem: 0 });
    while (q > 0) {
      const rem = q % D, nq = Math.floor(q / D);
      intSteps.push({ dividend: q, quotient: nq, rem });
      q = nq;
    }
    const intOut = intSteps.map(s => DIG[s.rem]).reverse().join('') || '0';

    /* ③ 十进制小数 → 目标进制：乘基取整、正序（整数分子/分母，精确） */
    const fracSteps = [];
    let num = fracNum, den = fracDen, exact = true;
    for (let i = 0; i < bits && num > 0; i++) {
      const prod = num * D;
      const digit = Math.floor(prod / den);
      const remNum = prod - digit * den;
      fracSteps.push({ i: i + 1, num, den, prod, digit, rem: remNum, remDen: den });
      num = remNum;
    }
    if (num !== 0) exact = fp.length === 0 ? true : false;
    if (fp.length === 0) exact = true;
    const fpOut = fracSteps.map(s => DIG[s.digit]).join('');

    /* ④ 结果拼装 + 十进制近似值（仅用于展示） */
    const outText = intOut + (fpOut ? '.' + fpOut : '');
    const fracDec = fracDen ? fracNum / fracDen : 0;
    const decApprox = intDec + fracDec;

    /* ⑤ 2^k 进制之间的"分组重组"信息（源/目标都是 2 的幂时才有） */
    const isPow2 = b => (b & (b - 1)) === 0 && b >= 2;
    let group = null;
    if (isPow2(S) && isPow2(D) && S !== D) {
      const g = Math.max(Math.log2(S), Math.log2(D)) / Math.min(Math.log2(S), Math.log2(D));
      const from = Math.log2(S) > Math.log2(D) ? 'src' : 'dst';   // 从"大位宽"进制拆成"小位宽"
      group = {
        bitsPerSrc: Math.log2(S), bitsPerDst: Math.log2(D), ratio: g, splitFrom: from,
        // 供渲染：把目标串按分组着色
        widths: from === 'src' ? Math.log2(S) : Math.log2(D),
      };
    }

    return {
      S, D, bits, raw, ip, fp, intTerms, fracTerms, intDec, fracNum, fracDen, fracDec, decApprox,
      intSteps, fracSteps, intOut, fpOut, outText, exact, group,
      intOutLen: intOut.replace(/^0(?=.)/, '').length,
    };
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const BASENAME = { 2: '二进制', 8: '八进制', 10: '十进制', 16: '十六进制' };
    const sub = n => `${BASENAME[n]}（${n} 进制）`;
    const DIG = '0123456789abcdef';
    const esc = s => String(s);

    /* 结果卡 */
    const cards =
      RC408.ui.statCard('源数', esc(m.raw), sub(m.S), 'text-slate-800') +
      RC408.ui.statCard('十进制值', Number(m.decApprox.toPrecision(12)) + '', '按权展开求和', 'text-indigo-600') +
      RC408.ui.statCard('转换结果', esc(m.outText), sub(m.D), 'text-emerald-600') +
      RC408.ui.statCard('是否精确', m.exact ? '精确' : '截断（有误差）',
        m.exact ? '小数部分已化为 0' : `保留 ${m.fpOut.length} 位后仍有剩余`, m.exact ? 'text-emerald-600' : 'text-rose-600');

    /* ① 整数部分：除基取余表 */
    const intRows = m.intSteps.map((s, i) => `
      <tr class="border-b border-slate-100 ${i === 0 ? '' : ''}">
        <td class="px-2 py-1 text-right font-mono">${s.dividend}</td>
        <td class="px-2 py-1 text-slate-400">÷ ${m.D} =</td>
        <td class="px-2 py-1 text-right font-mono">${s.quotient}</td>
        <td class="px-2 py-1 text-slate-400">余</td>
        <td class="px-2 py-1 font-mono font-bold ${s.rem === 0 ? 'text-slate-400' : 'text-rose-600'}">${DIG[s.rem]}</td>
      </tr>`).join('');
    const intTable = m.intDec === 0 ? `<div class="text-xs text-slate-500">整数部分为 0，无需除基取余。</div>` : `
      <table class="w-full text-sm">
        <thead><tr class="text-[11px] text-slate-400">
          <th class="px-2 py-1 text-right">被除数</th><th></th><th class="px-2 py-1 text-right">商</th><th></th><th class="px-2 py-1 text-left">余数（= 该位数字）</th>
        </tr></thead>
        <tbody>${intRows}</tbody>
      </table>
      <div class="mt-2 text-xs text-slate-600">
        余数<b>倒序</b>读出 → <b class="font-mono text-indigo-600">${m.intOut}</b>
        <span class="text-slate-400">（共 ${m.intSteps.length} 次"除基取余"；先得低位、后得高位）</span>
      </div>`;

    /* ② 小数部分：乘基取整表 */
    const fracTable = (m.fp.length === 0) ? `<div class="text-xs text-slate-500">没有小数部分。</div>` : (m.fracSteps.length === 0 ? `
      <div class="text-xs text-slate-500">小数部分为 0，无需乘基取整。</div>` : `
      <table class="w-full text-sm">
        <thead><tr class="text-[11px] text-slate-400">
          <th class="px-2 py-1 text-right">第 i 次</th><th class="px-2 py-1 text-right">乘数（分数）</th>
          <th class="px-2 py-1 text-right">× ${m.D} = 积</th><th class="px-2 py-1 text-left">取整（该位数字）</th><th class="px-2 py-1 text-left">剩余</th>
        </tr></thead>
        <tbody>${m.fracSteps.map(s => `
          <tr class="border-b border-slate-100">
            <td class="px-2 py-1 text-right text-slate-500">${s.i}</td>
            <td class="px-2 py-1 text-right font-mono">${s.num}/${s.den}</td>
            <td class="px-2 py-1 text-right font-mono">${s.prod}/${s.den}</td>
            <td class="px-2 py-1 font-mono font-bold text-rose-600">${DIG[s.digit]}</td>
            <td class="px-2 py-1 font-mono text-slate-500">${s.rem}/${s.remDen}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="mt-2 text-xs text-slate-600">
        整数位<b>正序</b>读出 → <b class="font-mono text-indigo-600">0.${m.fpOut}</b>
        ${m.exact ? '' : `<span class="text-rose-600">（第 ${m.fracSteps.length} 次后剩余 ${m.fracSteps[m.fracSteps.length - 1].rem}/${m.fracSteps[m.fracSteps.length - 1].remDen} ≠ 0，已按"保留 ${m.bits} 位"截断 → 存在误差）</span>`}
      </div>`);

    /* ③ 按权展开 */
    const termStr = (arr, joiner) => arr.map(t => `${t.dv}×${m.S}<sup>${t.w}</sup>`).join(joiner);
    const expand = `
      <div class="text-xs text-slate-700 leading-relaxed font-mono">
        ${m.intTerms.length ? termStr(m.intTerms, ' + ') : '0'}
        ${m.fracTerms.length ? ' + ' + m.fracTerms.map(t => `${t.dv}/${m.S}<sup>${-t.w}</sup>`).join(' + ') : ''}
        = <b>${Number(m.decApprox.toPrecision(12))}</b>
        <span class="text-slate-400">（源数 ${m.raw}<sub>${m.S}</sub> 按权展开）</span>
      </div>`;

    /* ④ 2^k 分组重组（源/目标都是 2 的幂且不相同） */
    let groupHtml = '';
    if (m.group) {
      const w = m.group.widths;                                  // 每组的位数
      const srcBits = [...m.ip].map(ch => DIG.indexOf(ch).toString(2).padStart(m.group.bitsPerSrc, '0')).join('')
        + (m.fp ? '.' + [...m.fp].map(ch => DIG.indexOf(ch).toString(2).padStart(m.group.bitsPerSrc, '0')).join('') : '');
      const cells = [...srcBits].map((b, i) => b === '.'
        ? `<span class="px-1 text-slate-400 font-bold">.</span>`
        : `<div class="bit-cell" style="background:${Math.floor(i / w) % 2 ? '#6366f1' : '#0ea5e9'}">${b}</div>`).join('');
      groupHtml = `
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3">
          <div class="text-xs font-bold text-slate-500 mb-2">2<sup>k</sup> 进制之间：不用算，按 <b>${w} 位一组</b>重组（同色 = 同一位）</div>
          <div class="flex flex-wrap items-center gap-0.5">${cells}</div>
          <div class="mt-2 text-xs text-slate-500">1 位${BASENAME[m.S]} = ${m.group.bitsPerSrc} 位二进制，1 位${BASENAME[m.D]} = ${m.group.bitsPerDst} 位二进制</div>
        </div>`;
    }

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>
        <div class="grid md:grid-cols-2 gap-3">
          <div class="rounded-xl bg-white border border-slate-200 px-4 py-3">
            ${RC408.ui.sectionTitle('① 整数部分：除基取余（倒序读）')}
            ${intTable}
          </div>
          <div class="rounded-xl bg-white border border-slate-200 px-4 py-3">
            ${RC408.ui.sectionTitle('② 小数部分：乘基取整（正序读）')}
            ${fracTable}
          </div>
        </div>
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3">
          ${RC408.ui.sectionTitle('③ 按权展开求和（源进制 → 十进制）')}
          ${expand}
        </div>
        ${groupHtml}
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>① 二↔八/十六是**分组重组**，别去乘幂；② 十进制小数**未必能精确表示**
          （0.3 转二进制永远乘不到 0，只能按精度截断——2024-13 就考这个误差）；
          ③ "n 位十六进制 ↔ 多少位二进制"是**位数×4**，不是容量换算（2025-12）。
        </div>
      </div>`;
  },

  logs(m) {
    return [
      { type: 'info', text: `${m.S} 进制数 ${m.raw} → 十进制 ${Number(m.decApprox.toPrecision(12))}（按权展开）` },
      { type: 'success', text: `→ ${m.D} 进制：${m.outText}（整数 ${m.intSteps.length} 次除基取余${m.fracSteps.length ? `、小数 ${m.fracSteps.length} 次乘基取整` : ''}）` },
      { type: 'info', text: m.exact ? '小数部分精确表示（乘基取整恰好到 0）' : `小数部分不能精确表示，按保留 ${m.bits} 位截断（有误差）` },
    ];
  },
});
