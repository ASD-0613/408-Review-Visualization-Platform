'use strict';
/* ============================================================================
 * net-crc.js —— 【计算机网络】差错控制编码（交互部分：CRC 循环冗余校验 · 模 2 除法）（前缀 _cr）
 * 考情：3 年 / 3 题（选 3）—— 2013-15（海明码最少校验位数 = 4）、2023-37（G(x)=x⁴+x+1 判接收串）、
 *   2025-34（编码集最小码距 ⟹ 检 3 位 / 纠 1 位）。
 *   窗46 第二批归位：2025-34 原错挂在 net-shannon / net-encode，2013-15 原被判"考纲外"，
 *   两题都归到本条目（见 exam-history.js 的注释与 handover §6.2.47）。
 * 快照：发送端补零 → 模 2 除法逐位 → 余数 FCS → 拼接发送帧；接收端校验余数 = 0。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-crc',
  mode: 'stepper',
  title: '差错控制编码：CRC 检错 · 最小码距 · 海明码',

  theory: `
> **为什么要有它**：数据在链路上会传错，收方必须能**发现**（甚至**纠正**）——差错控制就是"用可接受的冗余换可靠"。它分两族：**检错编码**（奇偶校验、CRC）只回答"有没有错"，**纠错编码**（海明码）还能定位并改正。
> **怎么实现**：检错靠"约定多项式"或"编码集的最小码距"——CRC 把数据补 r 个 0 后对 G(x) 做**模 2 除法**，把 r 位余数（FCS）附在帧尾，收方用同一个 G 再除一遍，余数非 0 就是出错；纠错靠**海明码**：插入 k 个校验位，使 \\(2^k \\ge n + k + 1\\)。
> **记住什么**：**余数为 0 判无错**（G = x⁴ + x + 1 ⇒ 10011）+ **最小码距判据**：码距 d 可 100% 检 \\(d-1\\) 位错、纠 \\(\\lfloor (d-1)/2 \\rfloor\\) 位错。

## 差错控制两族编码（先分清"检错"还是"纠错"）

| 编码 | 类型 | 最小码距 | 能力 | 真题 |
| --- | --- | --- | --- | --- |
| 奇偶校验（1 位） | 检错 | 2 | 检出奇数位错，**不能纠错** | — |
| CRC（循环冗余校验） | 检错 | 由 G(x) 决定 | 检错强，**不定位、不纠错**（余数非 0 即错） | 2023-37 |
| 海明码 | 纠错 | 至少 3 | **纠 1 位错、检 2 位错**；校验位数满足 \\(2^k \\ge n + k + 1\\) | 2013-15 |
| 给定编码集 | 现算 | 两两码距取最小 | 检 \\(d-1\\) 位、纠 \\(\\lfloor (d-1)/2 \\rfloor\\) 位 | 2025-34 |

## 最小码距判据（2025-34 的解法）

1. **码距** = 两个等长码字逐位比较、不同的位数（异或后数 1 的个数）；
2. **最小码距 d** = 所有码字对里最小的那个码距；
3. 判据：**检 e 位错** ⟹ \\(d \\ge e + 1\\)；**纠 t 位错** ⟹ \\(d \\ge 2t + 1\\)；**既检 e 又纠 t** ⟹ \\(d \\ge e + t + 1\\)；
4. 2025-34 实测：码集 {10011010, 01011100, 11110000, 00001111} 的六对码距为 4、4、4、4、4、8 ⟹ **d = 4** ⟹ 可 100% 检 3 位错、纠 1 位错（**答案 C**）。
   ⚠ **易错点**：有的参考答案把最小码距写成 3，可它自己列出的两两码距明明是 4 —— 以**自己按定义算出来的**为准，别背参考答案的结论。

## 海明码的位数（2013-15 的解法）

设数据位 n、校验位 k：k 个校验位能指出 \\(2^k\\) 种状态（含"无错"一种），要覆盖 n 个数据位 + k 个校验位 + 1 种无错 ⟹ 纠 1 位错必须满足 \\(2^k \\ge n + k + 1\\)。
例：n = 8 时 k = 4 有 \\(2^4 = 16 \\ge 8 + 4 + 1 = 13\\) 成立，而 k = 3 有 8 < 12 ⟹ **至少 4 位校验位**。

## 模 2 除法就是异或（CRC 手算三步）

1. 每步只看**当前余数的最高位**：是 1 就商 1 并异或 G，是 0 就商 0 并直接左移（等价于异或全 0）；
2. 除到剩余位数不足 r 位为止，余数**恰好 r 位**（不足时高位补 0）；
3. 发送帧 = 原数据 + r 位 FCS；接收方用整帧除以 G，**余数 = 0 认为无错**（只检错、不纠错）；
4. **2023-37 的演算**：G = 10011 ⟹ r = 4；把四个选项都当整帧除以 10011，只有 **1 0111 1100** 的余数为 0（其余三项余数非 0）⟹ 判它未出错。

## 考点提醒（易错点）

1. **补的是 r 个 0**：G 是 r 次多项式 ⇒ 补 r 位、余数也是 r 位，别多补成 r+1；
2. **两类公式别写反**：检错是 \\(d \\ge e + 1\\)、纠错是 \\(d \\ge 2t + 1\\)，"纠 1 检 2"对应 d ≥ 3；
3. **CRC 只检错不纠错**：能判断"是否出错"，**不能定位错在哪一位**；要纠错得用海明码；
4. 生成多项式必须**最高位与最低位都为 1**（如 10011），否则检错能力受损。

> **真题考情**：**3/18 年（选 3）**：2013-15（海明码最少校验位数 = 4）、2023-37（G(x) = x⁴ + x + 1 判接收串）、
> 2025-34（码集最小码距 = 4 ⟹ 检 3 位错、纠 1 位错）。
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
    /* ⚠ 窗55 修：这一帧原先**没把 `fcs` 带进快照**（只带了 frame），于是 render 里
       `${s.frame ? … s.fcs.join('') …}` 的守卫放行、`null.join` 当场抛 TypeError，
       框架 paint() 已经把 #stage 清空 ⟹ **末帧整个展示区空白**（浏览器实测该帧 innerHTML 长度 = 0）。
       根因是**快照没全量携带视觉状态**（§1.3 铁律），不是守卫写窄了 ⟹ 在这里补齐 `fcs`，
       而不是把 render 的守卫改成 `s.fcs && s.frame`（那样末帧会整块少一个信息卡）。 */
    push('recv', { recvOk: rr === 0, fcs, frame,
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
          ${RC408.ui.legend('#d97706', '当前处理位')}
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
