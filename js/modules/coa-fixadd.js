'use strict';
/* ============================================================================
 * coa-fixadd.js —— 【计算机组成原理】定点数补码加减运算与溢出判断
 * ----------------------------------------------------------------------------
 * 真题考情：2009-2025 中 14 年考补码运算/溢出/标志位（09/10/11大题/12/13/14/16/
 * 18/21大题/23/24大题/25），常与算术移位、IEEE754、机器级代码结合出题。
 *
 * 快照设计：竖式逐位相加，每一位一帧（LSB→MSB），最后加"标志位判定"帧：
 *   { step:'init'|'neg'|'bit'|'flags',
 *     bitIdx    当前相加的位序号（0 = 最低位）
 *     aBits/bBits  操作数补码位（数组下标 0 = 最低位）
 *     sumBits/carries  结果位与进位链（carries[i] = 送入第 i 位的进位）
 *     flags     最终帧的 {CF, OF, SF, ZF} 与十进制验算数据 }
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-fixadd',
  mode: 'stepper',
  title: '补码加减运算与溢出判断',

  theory: `
> **真题考情**：2009–2025 中 **14 年**考过补码运算、溢出判断或标志位
> （以选择题为主，2011/2021/2024 年考进大题），常与算术移位、IEEE 754、机器级代码综合出题。

## 补码加减的核心：减法变加法
机器里**只有加法器**。\`X − Y\` 被转换为 \`X + [−Y]补\`，其中：
\`\`\`text
[−Y]补 = [Y]补 连同符号位一起取反、末位 + 1
\`\`\`
符号位参与运算，与数值位一视同仁——这正是补码的妙处。

## 溢出判断（必背，本模块演示前两种）
1. **双高位法（进位异或）**：\(OF = C_{out} \oplus C_{n-1}\)（最高位进位 ⊕ 次高位进位）；
2. **符号比较法**：同号相加得异号 → 溢出（"正+正=负"为正溢出，"负+负=正"为负溢出；
   正负相加**必不**溢出）；
3. 双符号位（变形补码）：结果两符号位为 01 / 10 → 溢出。

## CF 与 OF 是两回事（高频考点）
| 标志 | 含义 | 判定 |
| --- | --- | --- |
| **OF** | **有符号**运算溢出 | \(C_{out} \oplus C_{n-1}\) |
| **CF** | **无符号**进位/借位 | 加法：CF = C_out；减法：CF = 借位（C_out 取反） |
| SF | 结果符号 | 结果最高位 |
| ZF | 结果为零 | 结果全 0 |

OF=1 说明有符号结果**错误**（需处理）；CF=1 只代表无符号视角的进位/借位，不一定是错误。
2023 年真题示例：x=100, y=200 时计算 x−y：OF=0（有符号 -100 无溢出）、CF=1（无符号 100 不够减 200）。

## 本模块的观察要点
- 竖式从**最低位**逐位相加，盯住进位链的传播；
- 最后对照 **C_out 与 C_{n-1}** 是否相同；再看"十进制验算"行体会"绕回"。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'width', label: '机器字长', type: 'select', default: 8, options: [{ v: 4, t: '4 位（-8 ~ 7）' }, { v: 8, t: '8 位（-128 ~ 127）' }] },
    { key: 'x', label: '操作数 X（十进制）', default: '100' },
    { key: 'y', label: '操作数 Y（十进制，可为负）', default: '60' },
    { key: 'op', label: '运算', type: 'select', default: 'add', options: [{ v: 'add', t: 'X + Y' }, { v: 'sub', t: 'X − Y' }] },
  ],

  quickActions: [
    { label: '正+正溢出', run(rt) { rt.setInput('width', 8); rt.setInput('x', 100); rt.setInput('y', 60); rt.setInput('op', 'add'); rt.load(); } },
    { label: '负+负溢出', run(rt) { rt.setInput('width', 8); rt.setInput('x', -70); rt.setInput('y', -90); rt.setInput('op', 'add'); rt.load(); } },
    { label: '无符号借位(2023真题)', run(rt) { rt.setInput('width', 8); rt.setInput('x', 100); rt.setInput('y', 200); rt.setInput('op', 'sub'); rt.load(); } },
    { label: '不溢出示例', run(rt) { rt.setInput('width', 8); rt.setInput('x', -33); rt.setInput('y', 96); rt.setInput('op', 'add'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const width = parseInt(vals.width, 10);
    const half = Math.pow(2, width - 1);
    const num = (s, name) => {
      if (!/^-?\d+$/.test(String(s).trim())) throw { message: `${name}「${s}」须为整数` };
      return parseInt(s, 10);
    };
    const x = num(vals.x, 'X'), y = num(vals.y, 'Y');
    const op = vals.op === 'sub' ? 'sub' : 'add';
    const range = `−${half} ~ ${half - 1}`;
    if (x < -half || x > half - 1) throw { message: `X = ${x} 超出 ${width} 位补码表示范围 ${range}` };
    if (y < -half || y > half - 1) throw { message: `Y = ${y} 超出 ${width} 位补码表示范围 ${range}` };
    const bVal = op === 'sub' ? -y : y;   // 实际与 X 相加的数
    if (bVal < -half || bVal > half - 1) {
      throw { message: `X − Y 需要计算 [−Y]补，而 −Y = ${-y} 超出 ${width} 位补码范围 ${range}（请换一个 Y）` };
    }
    return { width, x, y, op, bVal, half, range };
  },

  /* ---------------- ② 纯算法：逐位竖式加法 ---------------- */
  buildSnapshots(model) {
    const { width, x, y, op, bVal } = model;
    const mask = (1 << width) - 1;
    const enc = v => (v & mask) >>> 0;
    const toBits = v => [...enc(v).toString(2).padStart(width, '0')].map(Number).reverse();   // [LSB...MSB]

    const aBits = toBits(x);
    const yBits = toBits(y);
    let bBits = yBits, negBits = null;
    if (op === 'sub') {                       // [−Y]补 = 取反 + 1
      negBits = yBits.map(b => 1 - b);
      let carry = 1;
      for (let i = 0; i < width; i++) { const s2 = negBits[i] + carry; negBits[i] = s2 % 2; carry = s2 > 1 ? 1 : 0; }
      bBits = negBits;
    }
    const sumBits = Array(width).fill(0);
    const carries = Array(width + 1).fill(0); // carries[i] = 送入第 i 位的进位

    const snaps = [{
      step: 'init', bitIdx: -1, aBits, bBits, negBits, yBits, sumBits: [...sumBits], carries: [...carries],
      log: op === 'add'
        ? `就绪：${width} 位补码机计算 ${x} + ${y} = ${x + y}（预知真实值便于验算）。两个操作数均以补码存放，直接相加。`
        : `就绪：${width} 位补码机计算 ${x} − ${y}。减法转换为加法：X + [−Y]补（[−Y]补 对应的真值 = ${bVal}）。`,
      logType: 'info',
      desc: op === 'add' ? '补码加法：符号位参与运算，从最低位逐位相加' : '减法 = 加上 [−Y]补（[Y]补 连同符号位取反加一）',
    }];

    if (op === 'sub') {
      snaps.push({
        step: 'neg', bitIdx: -1, aBits, bBits, negBits, yBits, sumBits: [...sumBits], carries: [...carries],
        log: `求 [−Y]补：[${y}]补 = ${yBits.slice().reverse().join('')} → 连同符号位取反 = ${yBits.map(b => 1 - b).reverse().join('')} → 末位 +1 → [−Y]补 = ${enc(bVal).toString(2).padStart(width, '0')}（真值 ${bVal}）`,
        logType: 'info',
        desc: `[−Y]补 = [Y]补 取反加一 = ${enc(bVal).toString(2).padStart(width, '0')}`,
      });
    }

    for (let i = 0; i < width; i++) {
      const cin = carries[i];
      const s2 = aBits[i] + bBits[i] + cin;
      sumBits[i] = s2 % 2;
      carries[i + 1] = s2 > 1 ? 1 : 0;
      snaps.push({
        step: 'bit', bitIdx: i, aBits, bBits, negBits, yBits, sumBits: [...sumBits], carries: [...carries],
        log: `第 ${i + 1} 位（自低位）：${aBits[i]} + ${bBits[i]} + 进位${cin} → 本位和 ${sumBits[i]}，进位 ${carries[i + 1]}`,
        logType: 'info',
        desc: `第 ${i + 1} 位：和 = ${sumBits[i]}，进位 = ${carries[i + 1]}`,
      });
    }

    /* 标志位判定帧 */
    const cout = carries[width];          // 最高位进位 C_out
    const cHigh = carries[width - 1];     // 次高位进位（进入符号位的进位）
    const OF = cout ^ cHigh;
    const CF = op === 'add' ? cout : (cout ^ 1);
    const SF = sumBits[width - 1];
    const ZF = sumBits.every(b => b === 0) ? 1 : 0;
    const result = sumBits.slice().reverse().join('');
    let signedRes = 0;
    sumBits.forEach((b, i) => { if (b && i < width - 1) signedRes += 1 << i; });
    if (sumBits[width - 1]) signedRes -= 1 << (width - 1);
    const unsignedRes = parseInt(result, 2);
    const trueVal = op === 'add' ? x + y : x - y;
    const overflowType = OF ? (x >= 0 && bVal >= 0 ? '正 + 正 = 负（正溢出）' : '负 + 负 = 正（负溢出）') : null;

    snaps.push({
      step: 'flags', bitIdx: width, aBits, bBits, negBits, yBits, sumBits: [...sumBits], carries: [...carries],
      flags: { CF, OF, SF, ZF }, result, signedRes, unsignedRes, trueVal, overflowType,
      log: `计算完成：结果 = ${result}。标志位：CF=${CF}、OF=${OF}（C_out ${cout} ⊕ 次高位进位 ${cHigh}）、SF=${SF}、ZF=${ZF}。` +
        (OF ? `⚠️ 有符号溢出：${overflowType}，真实值 ${trueVal} 无法用 ${width} 位补码表示！`
          : `有符号结果 = ${signedRes}，与真实值一致 ✓${CF ? `（CF=1 只是无符号视角的进位/借位）` : ''}`),
      logType: OF ? 'error' : 'success',
      desc: OF
        ? `溢出！${overflowType} 真实值 ${trueVal} 超出 [${-model.half}, ${model.half - 1}]`
        : `无溢出：机器结果 ${result} = ${signedRes}（有符号解释）`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { width, x, y, op } = model;
    const inStep = s.step === 'bit' || s.step === 'flags';

    /* 一行位格子：lowToHigh=true 表示传入数组下标 0=最低位；当前列(琥珀)/已完成(绿)/未到(灰) */
    const bitRow = (label, bits, title, extra = '') => `
      <div class="flex items-center gap-2">
        <span class="w-20 text-right text-xs font-bold text-slate-500 shrink-0">${label}</span>
        <div class="flex gap-1">
          ${Array.from({ length: width }, (_, c) => {
      const lowIdx = width - 1 - c;                     // 该列对应的低位下标
      const done = inStep && lowIdx < (s.step === 'flags' ? width : s.bitIdx);
      const isCur = s.step === 'bit' && lowIdx === s.bitIdx;
      const cls = isCur ? 'bit-tag' : done ? 'bit-idx' : '';
      return `<div class="bit-cell ${cls}" style="width:30px;height:34px;font-size:13px" title="${title} 第 ${lowIdx + 1} 位（自低位）">${bits[lowIdx]}</div>`;
    }).join('')}
        </div>
        ${extra}
      </div>`;

    /* 竖式各行 */
    let rows;
    if (s.step === 'init') {
      rows = `<p class="text-sm text-slate-400 py-6 text-center">单步执行后，这里将展示逐位竖式加法（观察进位链传播）</p>`;
    } else {
      const carryBits = Array.from({ length: width }, (_, c) => {
        const lowIdx = width - 1 - c;
        if (s.step === 'flags') return c === 0 ? s.carries[width] : s.carries[lowIdx];
        if (s.step === 'bit' && lowIdx <= s.bitIdx + 1) return c === 0 ? '·' : s.carries[lowIdx];
        return '·';
      });
      rows = `
        ${bitRow('进位 C', carryBits, '进位值')}
        ${bitRow('X', s.aBits, 'X 的补码', `<span class="text-xs font-mono text-slate-400">= ${s.aBits.slice().reverse().join('')}</span>`)}
        ${bitRow(op === 'sub' ? '[−Y]补' : '[Y]补', s.bBits, '加数补码', `<span class="text-xs font-mono text-slate-400">= ${s.bBits.slice().reverse().join('')}</span>`)}
        <div class="flex items-center gap-2">
          <span class="w-20 shrink-0"></span>
          <div class="border-t-2 border-slate-400" style="width:${width * 34}px"></div>
        </div>
        ${bitRow('结果 S', s.sumBits, '结果补码', `<span class="text-xs font-mono font-bold text-slate-500">${s.step === 'flags' ? `= ${s.result}` : '= …'}</span>`)}
      `;
    }

    /* 标志位与验算（仅最终帧） */
    const flagSection = s.step === 'flags' ? (() => {
      const f = s.flags;
      return `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${RC408.ui.statCard('CF 无符号进位/借位', f.CF, op === 'add' ? `= C_out = ${s.carries[width]}` : `= 借位 = C_out(${s.carries[width]}) 取反`, f.CF ? 'text-amber-600' : 'text-slate-600')}
          ${RC408.ui.statCard('OF 有符号溢出', f.OF, `C_out ${s.carries[width]} ⊕ 次高位进位 ${s.carries[width - 1]}`, f.OF ? 'text-rose-600' : 'text-emerald-600')}
          ${RC408.ui.statCard('SF 符号位', f.SF, '结果最高位', 'text-slate-600')}
          ${RC408.ui.statCard('ZF 零标志', f.ZF, '结果全 0 时置 1', 'text-slate-600')}
        </div>
        <div class="rounded-xl border ${f.OF ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'} px-4 py-3 text-sm leading-relaxed ${f.OF ? 'text-rose-800' : 'text-emerald-800'}">
          <b>十进制验算：</b>真实值 ${x} ${op === 'add' ? '+' : '−'} ${y} = <b>${s.trueVal}</b>；机器结果
          <span class="font-mono font-bold">${s.result}</span> 按补码解释 = <b>${s.signedRes}</b>（有符号）/ ${s.unsignedRes}（无符号）。<br>
          ${f.OF
          ? `⚠️ <b>溢出：${s.overflowType}</b>——真实值 ${s.trueVal} 超出 ${width} 位补码范围 [${-model.half}, ${model.half - 1}]，有符号结果 ${s.signedRes} 是"绕回"后的错误值。`
          : `✅ 无溢出，有符号结果与真实值一致。${f.CF ? '（CF=1 只说明无符号运算有进位/借位，与 OF 互相独立。）' : ''}`}
        </div>`;
    })() : '';

    const stats =
      RC408.ui.statCard('算式', `${x} ${op === 'add' ? '+' : '−'} ${y}`, `${width} 位补码机`, 'text-indigo-600') +
      RC408.ui.statCard('[X]补', s.aBits.slice().reverse().join(''), `${x} 的补码`, 'font-mono') +
      RC408.ui.statCard(op === 'sub' ? '[−Y]补' : '[Y]补', s.bBits.slice().reverse().join(''), op === 'sub' ? `真值 ${model.bVal}` : `${y} 的补码`, 'font-mono') +
      RC408.ui.statCard('结果', s.step === 'flags' ? s.result : '…', s.step === 'flags' ? `有符号 = ${s.signedRes}` : '逐位计算中', 'font-mono');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-2 overflow-x-auto">
          ${RC408.ui.sectionTitle('竖式补码加法（琥珀列 = 当前位，绿色 = 已完成；最左列上方为最高位进位 C_out）')}
          ${rows}
        </div>

        ${flagSection}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#d97706', '当前计算位')}
          ${RC408.ui.legend('#059669', '已完成位')}
          ${RC408.ui.legend('#e11d48', '减法时的 [−Y]补')}
        </div>
      </div>`;
  },
});
