'use strict';
/* ============================================================================
 * coa-fixadd.js —— 【计算机组成原理】定点数补码加减运算与溢出判断
 * ----------------------------------------------------------------------------
 * 真题考情：2009-2026 中 13 年考补码运算/溢出/标志位（选 11 + 大题 4；09/10/11大题/12大题/
 * 13/14/16/18/21大题/23/24大题/25/26），常与算术移位、IEEE754、机器级代码结合出题。
 * （**窗12** 勘误：原写"14 年"且年份表漏 2026，与 exam-history 实算不符。）
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
> **为什么要有它**：机器里**只有加法器**，却要把减法也交给它；同时还得让符号位与数值位一起参加运算——补码就是为这两件事而生的编码。
> **怎么实现**：把 X − Y 转成 **X + [−Y]补**，其中 **[−Y]补** = [Y]补 连同符号位一起取反、末位 + 1；符号位参与运算、与数值位一视同仁。
> **记住什么**：**溢出判断的两种方法**（双高位异或 / 符号比较）+ **CF 与 OF 是两回事**（一个无符号、一个有符号）。

## 溢出判断（必背，本模块演示前两种）
1. **双高位法**：\\(OF = C_{out} \\oplus C_{n-1}\\)（最高位进位 ⊕ 次高位进位）；
2. **符号比较法**：同号相加得异号 → 溢出（"正+正=负"为正溢出、"负+负=正"为负溢出；**正负相加必不溢出**）；
3. **双符号位（变形补码）**：结果两符号位为 01 / 10 → 溢出。

## CF 与 OF 是两回事（高频考点）
| 标志 | 含义 | 判定 |
| --- | --- | --- |
| **OF** | **有符号**运算溢出 | \\(C_{out} \\oplus C_{n-1}\\) |
| **CF** | **无符号**进位 / 借位 | 加法取 \\(C_{out}\\)；减法取借位（\\(C_{out}\\) 取反） |
| SF | 结果符号 | 结果最高位 |
| ZF | 结果为零 | 结果全 0 |

## 考点提醒（易错点）
1. **OF = 1 才说明有符号结果错了**；CF = 1 只是无符号视角的进位 / 借位，不一定是错误。
   **要练"CF 与 OF 互相独立"，就用两个都在补码范围内的操作数**：8 位 x = 100、y = 127 算 x − y ⟹
   **OF = 0（有符号 −27 没溢出）、CF = 1（无符号 100 不够减 127）**；
   若操作数本身**超出补码范围**（如 y = 200，只有无符号位型能表示），那就是**无符号视角**的运算：
   只看 **CF = 1（不够减 ⟹ 借位）**（这正是"无符号比较用减法 + CF 判大小"的道理），**OF 不再有意义**。
2. **算术右移**连符号位一起移、左移低位补 0（2026-13 考算术右移）；
3. 竖式盯住**进位链的传播**，收尾只看 \\(C_{out}\\) 与 \\(C_{n-1}\\) 是否相同，再用"十进制验算"体会"绕回"；
4. 常与算术移位、IEEE 754、机器级代码综合出题。
   ⚠ **窗24 勘误（两处）**：① 本条原写"**2023 真题**：x = 100、y = 200 时算 x − y → OF = 0、CF = 1"——
   年份在「考情缓存/」里**核不到**（2023 的真题/解析文本层为空，见 §3.5-12），故**去掉年份归属**；
   ② 那句话本身也**不成立**：y = 200 超出 8 位补码范围，按位型公式算出来 OF = 1（机器把 [−Y]补 的位型
   当有符号数加），所以**不能拿它当"OF = 0"的例子**——已改用 x = 100、y = 127，并给预设补了
   "无符号不够减"那一档（只讲 CF）。

> **真题考情**：**13/18 年（选 11 + 大题 4）**：大 2011-43、2012-43、2021-43、2024-43；
> 选 2009-12、2010-13·14、2013-14、2014-13、2016-13、2018-13、2021-13、2023-16、2025-14、2026-13。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'width', label: '机器字长', type: 'select', default: 8, options: [{ v: 4, t: '4 位（-8 ~ 7）' }, { v: 8, t: '8 位（-128 ~ 127）' }] },
    { key: 'x', label: '操作数 X（十进制）', default: '100', help: '8 位可填 −128 ~ 127（补码）或 128 ~ 255（无符号位型）' },
    { key: 'y', label: '操作数 Y（十进制，可为负）', default: '60', help: '同上；减法会先求 [−Y]补 再与 X 相加' },
    { key: 'op', label: '运算', type: 'select', default: 'add', options: [{ v: 'add', t: 'X + Y' }, { v: 'sub', t: 'X − Y' }] },
  ],

  quickActions: [
    { label: '正+正溢出', run(rt) { rt.setInput('width', 8); rt.setInput('x', 100); rt.setInput('y', 60); rt.setInput('op', 'add'); rt.load(); } },
    { label: '负+负溢出', run(rt) { rt.setInput('width', 8); rt.setInput('x', -70); rt.setInput('y', -90); rt.setInput('op', 'add'); rt.load(); } },
    { label: '无符号不够减：x=100, y=200（CF=1；OF 不适用）', run(rt) { rt.setInput('width', 8); rt.setInput('x', 100); rt.setInput('y', 200); rt.setInput('op', 'sub'); rt.load(); } },
    { label: 'CF 与 OF 是两回事：x=100, y=127（CF=1、OF=0）', run(rt) { rt.setInput('width', 8); rt.setInput('x', 100); rt.setInput('y', 127); rt.setInput('op', 'sub'); rt.load(); } },
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
    /* ★ 窗24 修：算 y = 200 这类"无符号位型"的操作数。
       本模块要讲的核心之一就是 **CF 是无符号视角的借位**（theory 里的 8 位 x − y 例），
       但旧校验把 x/y 卡在**补码**范围内（8 位只有 −128 ~ 127）⟹ 预设"无符号借位"一按就报
       "Y = 200 超出 8 位补码表示范围"，那条考点根本演示不了。
       现在：x/y 允许"补码 or 无符号位型"两种填法（−2^(w−1) ~ 2^w − 1），位型由 `enc()` 取模得到，
       后面的竖式加法与 CF/OF 判定**一点不用改**。 */
    const unsignedMax = Math.pow(2, width) - 1;
    const range = `补码 −${half} ~ ${half - 1}，无符号位型 0 ~ ${unsignedMax}`;
    if (x < -half || x > unsignedMax) throw { message: `X = ${x} 超出 ${width} 位可填范围（${range}）` };
    if (y < -half || y > unsignedMax) throw { message: `Y = ${y} 超出 ${width} 位可填范围（${range}）` };
    const bVal = op === 'sub' ? -y : y;   // 实际与 X 相加的数
    if (bVal < -unsignedMax || bVal > unsignedMax) {
      throw { message: `X − Y 需要计算 [−Y]补，而 −Y = ${-y} 超出 ${width} 位可取模的位型范围（−${unsignedMax} ~ ${unsignedMax}）` };
    }
    /* ★ 窗24：只要 x / y 有一个超出**补码**范围，这场运算就按"无符号视角"讲解（CF 才是要看的标志） */
    const unsignedView = x > half - 1 || y > half - 1;
    return { width, x, y, op, bVal, half, range, unsignedView };
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
    /* ★ 窗24：只要有操作数超出**补码**范围（如 8 位的 200），这场运算就是"无符号视角"的——
       CF 才是要看的标志（不够减 = 借位），**OF 对无符号运算没有意义**。
       （旧代码不管这个，直接用"x、bVal 的符号"编出溢出类型，于是 x=100、y=200 时印出
        "负 + 负 = 正（负溢出）"这种明显荒谬的话——x 明明是正数。） */
    const unsignedView = !!(model && model.unsignedView);
    const overflowType = OF
      ? (x >= 0 && bVal >= 0 ? '正 + 正 = 负（正溢出）'
        : (x < 0 && bVal < 0 ? '负 + 负 = 正（负溢出）'
          : '操作数位型超出补码范围（无符号视角，见下方说明）'))
      : null;

    snaps.push({
      step: 'flags', bitIdx: width, aBits, bBits, negBits, yBits, sumBits: [...sumBits], carries: [...carries],
      flags: { CF, OF, SF, ZF }, result, signedRes, unsignedRes, trueVal, overflowType, unsignedView,
      log: `计算完成：结果 = ${result}。标志位：CF=${CF}、OF=${OF}（C_out ${cout} ⊕ 次高位进位 ${cHigh}）、SF=${SF}、ZF=${ZF}。` +
        (unsignedView
          ? `⚠️ 本次操作数超出 ${width} 位**补码**范围 ⟹ 按**无符号**视角看：${CF ? `CF=1 表示"不够减"（${x} < ${y}）——这正是真题里"无符号比较用减法 + CF 判大小"的道理` : 'CF=0 表示够减'
          }；**无符号运算不看 OF**（这里 OF=${OF} 只是"[−Y]补 的位型被当成有符号数去加"的副产物，不是本题考点）。`
          : (OF ? `⚠️ 有符号溢出：${overflowType}，真实值 ${trueVal} 无法用 ${width} 位补码表示！`
            : `有符号结果 = ${signedRes}，与真实值一致 ✓${CF ? '（CF=1 只是无符号视角的进位 / 借位，与 OF 互相独立）' : ''}`)),
      logType: unsignedView ? (CF ? 'warn' : 'info') : (OF ? 'error' : 'success'),
      desc: unsignedView
        ? `无符号视角：CF=${CF}（${x} ${op === 'add' ? '+' : '−'} ${y}${CF && op === 'sub' ? ' 不够减 ⟹ 借位' : ''}）；OF 不适用于无符号运算`
        : (OF ? `溢出！${overflowType} 真实值 ${trueVal} 超出 [${-model.half}, ${model.half - 1}]`
          : `无溢出：机器结果 ${result} = ${signedRes}（有符号解释）`),
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
        <div class="rounded-xl border ${s.unsignedView ? 'border-amber-200 bg-amber-50' : f.OF ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'} px-4 py-3 text-sm leading-relaxed ${s.unsignedView ? 'text-amber-900' : f.OF ? 'text-rose-800' : 'text-emerald-800'}">
          <b>十进制验算：</b>真实值 ${x} ${op === 'add' ? '+' : '−'} ${y} = <b>${s.trueVal}</b>；机器结果
          <span class="font-mono font-bold">${s.result}</span> 按补码解释 = <b>${s.signedRes}</b>（有符号）/ ${s.unsignedRes}（无符号）。<br>
          ${s.unsignedView
          ? `⚠️ <b>本次操作数超出了 ${width} 位补码范围 [${-model.half}, ${model.half - 1}]</b>，所以这是一次<b>无符号视角</b>的运算：
               ${f.CF ? `CF=1 表示"无符号不够减"（${x} < ${y}）` : 'CF=0 表示够减'}，**OF 对无符号运算没有意义**
               （上面那个 OF=${f.OF} 只是位型公式的副产物）。要练"CF 与 OF 互相独立"，请用
               <span class="font-mono">x = 100、y = 127</span> 这种两个操作数都在补码范围内的例子。`
          : f.OF
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
