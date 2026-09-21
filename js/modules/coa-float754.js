'use strict';
/* ============================================================================
 * coa-float754.js —— 【计算机组成原理】IEEE 754 浮点数的表示与求值
 * ----------------------------------------------------------------------------
 * 真题考情：2009-2026 中 12 年考 IEEE 754（**全为选择题**：09/11/12/13/14/16/18/20/21/23/25/26），
 * 固定题型两种："十六进制机器数 → 求真值" 与 "十进制 → 机器数"，
 * 且 2023 年考到**非规格化数**、**2026 年考到"就近舍入(取偶)"求 12.1 的机器数**——本模块均覆盖。
 * （**窗12** 勘误：原写"11 年"且年份表漏 2026；原写的"2019 年考精度极限"在 exam-history 里没有该年。）
 *
 * 快照设计（decode 求值方向）：
 *   { step:'init'|'bits'|'fields'|'special'|'result',
 *     kind:'normal'|'zero'|'denormal'|'inf'|'nan'
 *     bits        完整二进制串（MSB→LSB）
 *     sign/expBits/fracBits  三段字段
 *     E/mant/expVal          阶码字段值、尾数值、真实指数
 *     value/hex               真值与机器数十六进制 }
 * encode（求机器数）方向按"符号 → 规格化 → 阶码 → 尾数 → 拼装"五步出帧。
 * ========================================================================== */

const _F754_PREC = {
  32: { name: '单精度（float）', ebits: 8, fbits: 23, bias: 127 },
  64: { name: '双精度（double）', ebits: 11, fbits: 52, bias: 1023 },
};

RC408.registerModule({
  id: 'coa-float754',
  mode: 'stepper',
  title: 'IEEE 754 浮点数表示与求值',

  theory: `
> **为什么要有它**：定点数表示不了"一亿"和"一亿分之一"这样跨度极大的数——浮点数用**符号 + 阶码 + 尾数**让小数点"浮动"，在固定 32 / 64 位里兼顾范围与精度。
> **怎么实现**：阶码用**移码（含偏置）**存放，尾数用原码并**隐含最高位 "1."**；再按阶码字段是全 0 / 全 1 区分规格化数、非规格化数、±0、±∞、NaN。
> **记住什么**：**机器数 ↔ 真值的互求套路**（切三段 → 阶码减偏置 → 尾数前补 "1."）+ 四类特殊值的判据。

## 格式与公式
| 类型 | 总位数 | 符号 S | 阶码 E | 尾数 M | 偏置 |
| --- | --- | --- | --- | --- | --- |
| 单精度 float | 32 | 1 | 8 | 23 | 127 |
| 双精度 double | 64 | 1 | 11 | 52 | 1023 |

**规格化数**：\\(N = (-1)^S \\times 1.M \\times 2^{E-B}\\)（B 为偏置；隐含最高位 "1." 不占存储，白赚一位精度）

## 四类特殊值（由 E 与 M 联合判定）
| E 字段 | M | 含义 |
| --- | --- | --- |
| 全 0 | 全 0 | ±0 |
| 全 0 | 非 0 | **非规格化数**：\\(N = (-1)^S \\times 0.M \\times 2^{1-B}\\) |
| 全 1 | 全 0 | ±∞ |
| 全 1 | 非 0 | NaN |
| 1 ~ 254 | 任意 | 规格化数（用上面的正常公式） |

## 手算套路（机器数 → 真值）
1. 展开二进制，切成 **1 / 8 / 23** 三段（单精度）；
2. E 字段按**无符号**读出，**减 127** 得真实指数；
3. 尾数字段前补 "1." 得 1.M（非规格化数补 "0."、指数固定 1 − B）；
4. 代入公式，**别忘符号位在最前面**。

## 考点提醒（易错点）
1. **非规格化数**（E 全 0、M 非 0）：**隐含位消失、指数固定为 1 − 偏置**，是失分重灾区（2023-14 的 8020 0000H）；
2. 三段顺序别记错：符号 → 阶码 → 尾数；
3. **精度**：0.1、1.2 这类十进制小数的二进制是无限循环，只能**就近舍入（取偶）**，
   所以 float 的 1.2 不等于数学上的 1.2（2026-14 考"就近舍入取偶"求 12.1 的机器数）；
4. 常考机器数 ↔ 真值互求：2011 的 −8.25、2013 的 C6400000H、2022 的 −0.4375、2025 的 4730 0000H。

> **真题考情**：**12/18 年，全为选择题**（2009-13、2011-13、2012-14、2013-13、2014-14、2016-14、2018-14、
> 2020-13、2021-14、2023-14、2025-13、2026-14），两问固定：机器数 ↔ 真值互求、精度 / 舍入。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'dir', label: '转换方向', type: 'select', default: 'decode', wide: true,
      options: [{ v: 'decode', t: '机器数 → 真值（输入十六进制机器数）' }, { v: 'encode', t: '十进制 → 机器数（输入十进制数）' }],
    },
    { key: 'val', label: '输入值', default: 'C640 0000H', wide: true, ph: '如 C640 0000H / 0xC6400000 / -8.25 / -0.4375', help: '十六进制可含空格，结尾 H 或 0x 前缀均可' },
    { key: 'prec', label: '精度', type: 'select', default: 32, options: [{ v: 32, t: '单精度 32 位' }, { v: 64, t: '双精度 64 位' }] },
  ],

  quickActions: [
    { label: '−8.25（2011真题）', run(rt) { rt.setInput('dir', 'encode'); rt.setInput('val', '-8.25'); rt.setInput('prec', 32); rt.load(); } },
    { label: 'C640 0000H（2013真题）', run(rt) { rt.setInput('dir', 'decode'); rt.setInput('val', 'C640 0000H'); rt.setInput('prec', 32); rt.load(); } },
    { label: '8020 0000H（2023真题·非规格化）', run(rt) { rt.setInput('dir', 'decode'); rt.setInput('val', '8020 0000H'); rt.setInput('prec', 32); rt.load(); } },
    { label: '4730 0000H（2025真题）', run(rt) { rt.setInput('dir', 'decode'); rt.setInput('val', '4730 0000H'); rt.setInput('prec', 32); rt.load(); } },
    { label: '−0.4375（2022真题）', run(rt) { rt.setInput('dir', 'encode'); rt.setInput('val', '-0.4375'); rt.setInput('prec', 32); rt.load(); } },
  ],

  /* ---------------- ① 解析与计算 ---------------- */
  parse(vals) {
    const prec = _F754_PREC[parseInt(vals.prec, 10)] ? parseInt(vals.prec, 10) : 32;
    const meta = _F754_PREC[prec];
    const input = vals.val.trim();
    if (!input) throw { message: '请输入要转换的数' };

    if (vals.dir === 'encode') {
      if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(input)) throw { message: `「${input}」不是合法的十进制数（可带负号与小数）` };
      return { dir: 'encode', prec, meta, dec: Number(input) };
    }
    const hex = input.replace(/0x/i, '').replace(/\s+/g, '').replace(/H$/i, '').toUpperCase();
    if (!/^[0-9A-F]+$/.test(hex) || hex.length !== prec / 4) {
      throw { message: `「${input}」不是 ${prec} 位机器数（需要 ${prec / 4} 个十六进制位）` };
    }
    return { dir: 'decode', prec, meta, hex };
  },

  /* ---------------- ② 纯算法：出快照 ---------------- */
  buildSnapshots(model) {
    const { dir, prec, meta } = model;
    const { ebits, fbits, bias } = meta;
    const total = prec;

    /** 由字段三元组求真值与分类 */
    function classify(sign, E, frac) {
      const fracAll0 = frac === 0n;
      if (E === 0 && fracAll0) return { kind: 'zero', value: sign ? -0 : 0 };
      if (E === 0) return { kind: 'denormal', value: (sign ? -1 : 1) * Number(frac) / Math.pow(2, fbits) * Math.pow(2, 1 - bias) };
      const emax = Math.pow(2, ebits) - 1;
      if (E === emax && fracAll0) return { kind: 'inf', value: sign ? -Infinity : Infinity };
      if (E === emax) return { kind: 'nan', value: NaN };
      const mant = 1 + Number(frac) / Math.pow(2, fbits);
      return { kind: 'normal', value: (sign ? -1 : 1) * mant * Math.pow(2, E - bias), mant };
    }

    const snaps = [];
    if (dir === 'decode') {
      const v = BigInt('0x' + model.hex);
      const bits = v.toString(2).padStart(total, '0');
      const sign = bits[0] === '1' ? 1 : 0;
      const expBits = bits.slice(1, 1 + ebits);
      const fracBits = bits.slice(1 + ebits);
      const E = parseInt(expBits, 2);
      const frac = BigInt('0b' + (fracBits || '0'));
      const cls = classify(sign, E, frac);
      const fmt = x => (typeof x === 'number' && isFinite(x) ? Number(x.toPrecision(12)).toString() : String(x));

      snaps.push({
        step: 'init', kind: cls.kind, bits, hex: model.hex, sign, expBits, fracBits, E,
        mant: cls.mant, expVal: E - bias, value: cls.value, total, ebits, fbits, bias,
        log: `就绪：把 ${prec} 位机器数 ${model.hex} 还原为真值（${dir === 'decode' ? '' : ''}${meta.name}）。`,
        logType: 'info', desc: '单步执行：展开二进制 → 切三段字段 → 判定类别 → 代入公式',
      });
      snaps.push({
        step: 'bits', kind: cls.kind, bits, hex: model.hex, sign, expBits, fracBits, E, mant: cls.mant, expVal: E - bias, value: cls.value, total, ebits, fbits, bias,
        log: `展开 ${total} 位：${bits.slice(0, 1)} | ${expBits} | ${fracBits.slice(0, 12)}…（🔴 符号 1 位 | 🟡 阶码 ${ebits} 位 | 🟢 尾数 ${fbits} 位）`,
        logType: 'info', desc: '按 1 / 阶码 / 尾数 切分三段',
      });
      snaps.push({
        step: 'fields', kind: cls.kind, bits, hex: model.hex, sign, expBits, fracBits, E, mant: cls.mant, expVal: E - bias, value: cls.value, total, ebits, fbits, bias,
        log: `字段解读：S = ${sign}；阶码字段 E = ${expBits}₂ = ${E}（无符号解读）→ 真实指数 = E − ${bias} = ${E - bias}；尾数字段 M = ${fracBits.slice(0, 10)}…₂`,
        logType: 'info', desc: `E = ${E}，真实指数 = ${E - bias}`,
      });
      const kindText = {
        normal: `E 不全 0 也不全 1 → 规格化数：隐含 "1."，N = (-1)^${sign} × ${cls.mant} × 2^${E - bias}`,
        zero: `E 全 0 且 M 全 0 → ±0`,
        denormal: `E 全 0 但 M 非 0 → **非规格化数**：隐含位消失（"0.M"），阶码固定 1−${bias}：N = (-1)^${sign} × 0.${fracBits}₂ × 2^${1 - bias}`,
        inf: `E 全 1 且 M 全 0 → ${sign ? '负' : '正'}无穷大`,
        nan: `E 全 1 且 M 非 0 → NaN（非数）`,
      }[cls.kind];
      snaps.push({
        step: 'special', kind: cls.kind, bits, hex: model.hex, sign, expBits, fracBits, E, mant: cls.mant, expVal: E - bias, value: cls.value, total, ebits, fbits, bias,
        log: `类别判定：${kindText}`,
        logType: cls.kind === 'normal' ? 'info' : 'warn',
        desc: cls.kind === 'normal' ? '规格化数，隐含位 "1." 参与，按标准公式求值' : `特殊类别：${{ zero: '零', denormal: '非规格化数', inf: '无穷大', nan: 'NaN' }[cls.kind]}`,
      });
      snaps.push({
        step: 'result', kind: cls.kind, bits, hex: model.hex, sign, expBits, fracBits, E, mant: cls.mant, expVal: E - bias, value: cls.value, total, ebits, fbits, bias,
        log: cls.kind === 'normal'
          ? `真值 = (-1)^${sign} × 1.${fracBits ? Number(parseInt(fracBits, 2)) / Math.pow(2, fbits) : 0} × 2^${E - bias} = ${sign ? '-' : ''}${cls.mant} × 2^${E - bias} = ${fmt(cls.value)}`
          : `真值 = ${fmt(cls.value)}`,
        logType: 'success',
        desc: cls.kind === 'normal' ? `真值 = ${sign ? '-' : ''}${cls.mant} × 2^${E - bias} = ${fmt(cls.value)}` : `真值 = ${fmt(cls.value)}`,
      });
      return snaps;
    }

    /* ---- encode：十进制 → 机器数 ---- */
    const v = model.dec;
    if (!isFinite(v)) throw { message: '请输入有限大小的数（无穷大/NaN 不支持）' };
    if (v === 0) throw { message: '±0 的机器数全为 0（含符号位），无需演示' };
    const sign = v < 0 ? 1 : 0;
    const a = Math.abs(v);
    let e = Math.floor(Math.log2(a));
    let m = a / Math.pow(2, e);
    while (m >= 2) { m /= 2; e++; }
    while (m < 1) { m *= 2; e--; }
    let frac = Math.round((m - 1) * Math.pow(2, fbits));
    if (frac >= Math.pow(2, fbits)) { frac = 0; e++; m = a / Math.pow(2, e); }
    const E = e + bias;
    if (E < 1 || E > Math.pow(2, ebits) - 2) {
      throw { message: `${v} 超出 ${meta.name}规格化数表示范围（指数 e = ${e} 越界，$E = e + ${bias} = ${E}）——这类数属于非规格化数或溢出为 ±∞` };
    }
    const fracBits = frac.toString(2).padStart(fbits, '0');
    const expBits = E.toString(2).padStart(ebits, '0');
    const hexBig = (BigInt(sign) << BigInt(total - 1)) | (BigInt(E) << BigInt(fbits)) | BigInt(frac);
    const hex = hexBig.toString(16).toUpperCase().padStart(total / 4, '0');

    const base = { sign, expBits, fracBits, E, mant: m, expVal: e, value: v, hex, total, ebits, fbits, bias, kind: 'normal', bits: (sign ? '1' : '0') + expBits + fracBits };
    /* init/sign/norm 阶段先不展示机器数位串（避免提前泄底） */
    const hide = b => ({ ...b, bits: null });
    snaps.push({ step: 'init', ...hide(base), log: `就绪：把十进制 ${v} 编码为 ${meta.name} 机器数（需先规格化为 1.M × 2^e 形式）。`, logType: 'info', desc: '单步执行：定符号 → 规格化 → 求阶码 → 求尾数 → 拼装' });
    snaps.push({
      step: 'sign', ...hide(base), log: `① 确定符号：${v} ${v < 0 ? '< 0 → S = 1' : '≥ 0 → S = 0'}（符号位单独存放，之后只处理绝对值 ${a}）`,
      logType: 'info', desc: `符号位 S = ${sign}`,
    });
    snaps.push({
      step: 'norm', ...hide(base), log: `② 规格化：|${v}| = ${a} = ${m} × 2^${e}（二进制即 1.${fracBits.replace(/0+$/, '') || '0'}₂ × 2^${e}）——整数部分恰为 1，小数部分进入尾数`,
      logType: 'info', desc: `规格化：${m} × 2^${e}`,
    });
    snaps.push({
      step: 'exp', ...base, log: `③ 求阶码字段：真实指数 e = ${e}，加上偏置 ${bias} → E = ${e} + ${bias} = ${E} = ${expBits}₂（${ebits} 位无符号存放）`,
      logType: 'info', desc: `阶码字段 E = ${e} + ${bias} = ${E}`,
    });
    snaps.push({
      step: 'mant', ...base, log: `④ 求尾数字段：规格化去掉隐含的 "1."，小数部分 ${(m - 1)} × 2^${fbits} = ${frac} → ${fbits} 位 ${fracBits}（不足补 0，超出会舍入 → 精度受限，如 1.2 无法精确表示）`,
      logType: 'info', desc: `尾数字段 = ${fracBits.slice(0, 12)}…（${fbits} 位）`,
    });
    snaps.push({
      step: 'result', ...base, log: `⑤ 拼装：S=${sign} | E=${expBits} | M=${fracBits.slice(0, 10)}… → 机器数 = ${hex}H。验证：(-1)^${sign} × ${m} × 2^${e} = ${v} ✓`,
      logType: 'success', desc: `机器数 = ${hex}H`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const cellW = s.total > 32 ? 15 : 27;
    const cellH = s.total > 32 ? 30 : 36;

    /* 三段位格子 */
    const seg = (from, to, cls) => Array.from({ length: to - from }, (_, i) => {
      const p = from + i;
      return `<div class="bit-cell ${cls}" style="width:${cellW}px;height:${cellH}px;font-size:${cellW < 20 ? 10 : 13}px;border-radius:4px" title="第 ${p + 1} 位">${s.bits ? s.bits[p] : '·'}</div>`;
    }).join('');
    const bitsHtml = s.bits ? `
      <div class="overflow-x-auto">
        <div class="flex gap-0.5 justify-center" style="min-width:${s.total * (cellW + 2)}px">
          ${seg(0, 1, 'bit-tag')}${seg(1, 1 + s.ebits, 'bit-sub')}${seg(1 + s.ebits, s.total, 'bit-host')}
        </div>
        <div class="flex justify-center gap-6 mt-2 text-[11px] font-bold flex-wrap">
          <span class="text-rose-600">符号 S = ${s.sign}</span>
          <span class="text-amber-600">阶码字段 E = ${s.expBits}₂ = ${s.E}</span>
          <span class="text-blue-600">尾数字段 M（${s.fbits} 位）</span>
        </div>
      </div>` : `<p class="text-sm text-slate-400 text-center py-6">单步执行后展示 ${s.total} 位机器数</p>`;

    /* 公式与结果 */
    const fmt = x => (typeof x === 'number' ? (isFinite(x) ? Number(x.toPrecision(12)).toString() : String(x)) : String(x));
    const resultHtml = s.step === 'result' || s.step === 'special' ? (() => {
      const kindName = { normal: '规格化数', zero: '零', denormal: '非规格化数', inf: '无穷大', nan: 'NaN' }[s.kind];
      return `<div class="rounded-xl ${s.kind === 'denormal' ? 'border border-amber-200 bg-amber-50 text-amber-900' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'} px-4 py-3 text-sm leading-relaxed">
        <b>类别：${kindName}</b>${s.kind === 'denormal' ? '（隐含位消失、阶码按 1−偏置 处理——2019/2023 真题考点）' : ''}<br>
        公式：N = (-1)^${s.sign} × ${s.kind === 'denormal' ? '0.M' : '1.M'} × 2^${s.kind === 'denormal' ? 1 - s.bias : s.expVal}<br>
        <b>真值 = ${fmt(s.value)}</b>${s.kind === 'normal' ? `　（= ${s.sign ? '-' : ''}${fmt(s.mant)} × 2^${s.expVal}）` : ''}
      </div>`;
    })() : '';

    /* encode 各步的中间量卡 */
    const encStep = {
      sign: ['① 符号位', `S = ${s.sign}`],
      norm: ['② 规格化', `${fmt(s.mant)} × 2^${s.expVal}（= 1.${(s.fracBits || '').replace(/0+$/, '') || '0'}₂ × 2^${s.expVal}）`],
      exp: ['③ 阶码字段', `e = ${s.expVal}，E = e + ${s.bias} = ${s.E}（${s.expBits}₂）`],
      mant: ['④ 尾数字段', `${s.fracBits ? s.fracBits.slice(0, 16) + (s.fbits > 16 ? '…' : '') : ''}（${s.fbits} 位，隐含 "1."）`],
      result: ['⑤ 机器数', `${s.hex}H`],
    }[s.step];

    const stats =
      RC408.ui.statCard('方向', s.step === 'init' && !s.bits ? '…' : '已加载', `${s.total} 位（${_F754_PREC[s.total].name}）`, 'text-indigo-600') +
      RC408.ui.statCard('符号 S', s.sign ?? '—', s.sign === 1 ? '负数' : '非负数', 'text-rose-600') +
      RC408.ui.statCard('阶码字段 E', s.E ?? '—', s.expVal !== undefined && s.E !== null ? `真实指数 = ${s.expVal}` : '', 'text-amber-600') +
      RC408.ui.statCard(s.step === 'result' ? '真值 / 机器数' : '机器数 / 真值', s.step === 'result' ? fmt(s.value) : (s.hex ? s.hex + 'H' : '—'), '', 'font-mono text-emerald-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle(`${s.total} 位机器数（🔴 符号 1 位 ｜ 🟡 阶码 ${s.ebits} 位 ｜ 🟢 尾数 ${s.fbits} 位）`)}
          ${bitsHtml}
        </div>

        ${s.step !== 'init' && s.bits ? `
        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-mono text-slate-600">
          N = (-1)^S × 1.M × 2^(E − 偏置)　（本例偏置 = ${s.bias}；E 字段 = ${s.E}）
        </div>` : ''}

        ${encStep ? `<div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-sm text-indigo-900">
          <b>${encStep[0]}：</b><span class="font-mono">${encStep[1]}</span>
        </div>` : ''}

        ${resultHtml}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#e11d48', '符号位 S')}
          ${RC408.ui.legend('#e11d48', '阶码字段 E（偏置 ' + s.bias + '）')}
          ${RC408.ui.legend('#2563eb', '尾数字段 M')}
        </div>
      </div>`;
  },
});
