'use strict';
/* ============================================================================
 * net-crc.js —— 【计算机网络】CRC 循环冗余校验（模 2 除法）（前缀 _cr）
 * 考情：2023-37（G(x)=x⁴+x+1 判断接收比特串是否传错）；CRC 是差错控制的经典考点。
 * 快照：发送端补零 → 模 2 除法逐位 → 余数 FCS → 拼接发送帧；接收端校验余数 = 0。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-crc',
  mode: 'stepper',
  title: 'CRC 循环冗余校验（模 2 除法）',

  theory: `
> **为什么要有它**：链路层要在收方**发现传输错误**，又不愿付出纠错码的冗余代价——CRC 用"约定一个生成多项式、发送方附上余数"的办法，让收方一除就知道有没有错。
> **怎么实现**：数据后**补 r 个 0** → 对 G(x)（r+1 位）做**模 2 除法**（减法 = 异或、不借位）→ 余数（r 位）就是 FCS，拼在数据后面发出；收方用整帧再除以 G。
> **记住什么**：**余数为 0 判无错**；G(x) = x⁴ + x + 1 ⇒ **10011**。

## 模 2 除法就是异或（手算三步）
1. 每步只看**当前余数的最高位**：是 1 就商 1 并异或 G，是 0 就商 0 并直接左移（等价于异或全 0）；
2. 除到剩余位数不足 r 位为止，余数**恰好 r 位**（不足时高位补 0）；
3. 发送帧 = 原数据 + r 位 FCS；接收方用整帧除以 G，**余数 = 0 认为无错**（只检错、不纠错）。

## 考点提醒（易错点）
1. **补的是 r 个 0**：G 是 r 次多项式 ⇒ 补 r 位、余数也是 r 位，别多补成 r+1；
2. 生成多项式必须**最高位与最低位都为 1**（如 10011），否则检错能力受损；
3. CRC 属**检错**编码（与奇偶校验、海明码同族）：能判断"是否出错"，**不能定位错在哪一位**。

> **真题考情**：**1/18 年（全为选择题）**：2023-37（G(x) = x⁴ + x + 1，判断哪个接收比特串未出错），
> 题眼就是"模 2 除的余数是否为 0"；其余年份的差错控制题考的是奇偶校验 / 海明码，不属本模块。
`,

  inputs: [
    { key: 'data', label: '数据比特串', type: 'text', default: '101001101', wide: true, ph: '如 101001101' },
    { key: 'gen', label: '生成多项式 G（二进制，最高/最低位须为 1）', type: 'text', default: '10011', ph: '如 10011（= x⁴+x+1）', wide: true },
  ],

  quickActions: [
    { label: '2023 真题 G(x)', run(rt) { rt.setInput('data', '101001101'); rt.setInput('gen', '10011'); rt.load(); } },
  ],

  parse(vals) {
    const bits = s => { const t = vals[s].replace(/[^01]/g, ''); return t; };
    const data = bits('data'), gen = bits('gen');
    if (data.length < 4 || data.length > 16) throw { message: '数据比特串长度须为 4 ~ 16' };
    if (gen.length < 3 || gen.length > 6) throw { message: 'G 须为 2 ~ 5 次多项式（二进制 3 ~ 6 位）' };
    if (gen[0] !== '1' || gen[gen.length - 1] !== '1') throw { message: '生成多项式最高位与最低位必须为 1' };
    return { data: data.split('').map(Number), gen: gen.split('').map(Number), r: gen.length - 1, hex: vals.data.trim() };
  },

  buildSnapshots(model) {
    const { data, gen, r } = model;
    const aug = [...data, ...Array(r).fill(0)];
    let rem = 0;                                    // 余数寄存器（r 位）
    const mask = (1 << r) - 1;
    const poly = parseInt(gen.join(''), 2);         // 含最高位的完整 G
    const snaps = [];
    const remBits = v => v.toString(2).padStart(r, '0').split('').map(Number);
    const push = (step, o) => snaps.push({ step, data, gen, r, aug, rem: remBits(rem), remVal: rem,
      fcs: null, frame: null, recvOk: null, bitIdx: -1, bit: null, xored: false,
      log: '', logType: 'info', desc: '', ...o });

    push('init', { log: `就绪：数据 ${data.join('')}，G = ${gen.join('')}（r = ${r}，即 G(x) = ${genToPoly(gen)}）。先在数据后补 ${r} 个 0 再做模 2 除法。`,
      desc: '补零 → 模 2 除 → 余数 FCS → 拼接发送' });

    aug.forEach((bit, i) => {
      const remBefore = rem;
      rem = ((rem << 1) | bit) & ((1 << (r + 1)) - 1);
      const xored = rem >= (1 << r);                // 余数寄存器溢出位为 1 → 商 1，异或 G
      if (xored) rem ^= poly;
      rem &= mask;
      push('div', { bitIdx: i, bit, remBefore: remBits(remBefore), xored,
        log: `第 ${i + 1} 位（${bit}）：余数左移入位 → ${xored ? `最高位为 1，商 1 并异或 G = ${gen.join('')}` : '最高位为 0，商 0 直接左移'} → 余数 = ${remBits(rem).join('')}`,
        desc: xored ? '异或 G' : '直接左移' });
    });

    const fcs = remBits(rem);
    const frame = [...data, ...fcs];
    push('fcs', { fcs, frame,
      log: `除法完成：余数 = ${fcs.join('')}（${r} 位）即 **FCS**。发送帧 = 数据 ${data.join('')} + FCS ${fcs.join('')} = ${frame.join('')}。`,
      logType: 'success', desc: `FCS = ${fcs.join('')}，发送帧 ${frame.join('')}` });

    /* 接收端校验：整帧除 G 余数应为 0 */
    let rr = 0;
    frame.forEach(bit => { rr = ((rr << 1) | bit) & ((1 << (r + 1)) - 1); if (rr >= (1 << r)) rr ^= poly; rr &= mask; });
    push('recv', { recvOk: rr === 0, frame,
      log: `接收方用同一 G 除整帧：余数 = ${rr.toString(2).padStart(r, '0')} → ${rr === 0 ? '**余数为 0，认为传输无错 ✓**（注意：CRC 只能检错，不能定位/纠错）' : '余数非 0 → 检出错误'}`,
      logType: rr === 0 ? 'success' : 'error', desc: rr === 0 ? '接收校验通过（余数 = 0）' : '余数非 0，检出错误' });
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    const U = RC408.util;
    const remBits = s.rem || [];
    const stats =
      RC408.ui.statCard('G（生成多项式）', s.gen ? s.gen.join('') : '—', s.gen ? genToPoly(s.gen) : '', 'text-indigo-600') +
      RC408.ui.statCard('FCS（余数）', s.fcs ? s.fcs.join('') : '…', `${s.r} 位`, 'font-mono text-emerald-600') +
      RC408.ui.statCard('发送帧', s.frame ? s.frame.join('') : '—', '数据 + FCS', 'font-mono') +
      RC408.ui.statCard('接收校验', s.recvOk === null || s.recvOk === undefined ? '—' : s.recvOk ? '通过 ✓' : '检出错误', '整帧 ÷ G 余数 = 0', s.recvOk === false ? 'text-rose-600' : 'text-emerald-600');

    const augCells = s.aug.map((b, i) => {
      const isCur = s.bitIdx === i;
      const done = s.bitIdx >= i && s.bitIdx !== -1;
      return `<div class="bit-cell ${done ? 'bit-idx' : isCur ? 'bit-tag' : ''}" style="width:26px;height:32px;font-size:12px" title="补零后第 ${i + 1} 位">${b}</div>`;
    }).join('');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 overflow-x-auto">
          ${RC408.ui.sectionTitle('补零后的被除数（数据 + r 个 0；绿 = 已处理，琥珀 = 当前位）')}
          <div class="flex gap-1 justify-center flex-wrap">${augCells}</div>
          <p class="text-[11px] text-slate-400 mt-2 text-center font-mono">当前余数寄存器 = ${remBits.join(' ')}</p>
        </div>
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-mono text-slate-600">
          G(x) = ${s.gen ? genToPoly(s.gen) : ''} → G = <b>${s.gen ? s.gen.join('') : ''}</b>（模 2 除法：商 1 当且仅当余数最高位为 1，减法用异或）
        </div>
        ${s.frame ? `<div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-mono text-slate-700">
          <b style="color:#4f46e5">发送帧</b>：数据 ${s.data.join('')} + FCS <b style="color:#059669">${s.fcs.join('')}</b> = <b>${s.frame.join('')}</b>
        </div>` : ''}
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#d9770b', '当前处理位')}
          ${RC408.ui.legend('#059669', '已处理位')}
        </div>
      </div>`;
  },
});

function genToPoly(g) {
  const deg = g.length - 1;
  const terms = [];
  g.forEach((b, i) => { if (b) { const d = deg - i; terms.push(d === 0 ? '1' : d === 1 ? 'x' : 'x' + (d >= 10 ? '⁰¹²³⁴⁵⁶⁷⁸⁹'[d] : sup(d))); } });
  return terms.join(' + ');
}
function sup(d) { return String(d).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join(''); }
