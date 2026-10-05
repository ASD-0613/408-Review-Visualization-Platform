'use strict';
/* ============================================================================
 * coa-assembly.js —— 【计算机组成原理】高级语言 ↔ 机器级代码（C → 汇编 → 机器码 逐句对照执行）
 * 前缀 _as（钩子类名 as-*）；模式：stepper（一条汇编指令一帧；首帧 init、末帧 done）
 *
 * 考情（**窗29 从零核定**；逐条证据行号见 `js/exam-history.js` 的 coa-assembly 条）：
 *   · 18 年中 **12 年**考过，共 **13 题、全为大题**（2024 一年两道）：
 *     2010-43（操作码字段划分 + 汇编语句 add (R4),(R5)+ 的机器码；2010_解析.txt:492）、
 *     2012-44（题给指令格式表 + 语句 X=a+b 的 LOAD/LOAD/ADD 指令序列；2012_真题.txt:371-418）、
 *     2013-44（16 位定长指令字 + 8 位补码 OFFSET 求转移目标；2013_解析.txt:480-497）、
 *     2014-44（循环代码段 P 的机器代码与 OFFSET 字段）、2015-44（7 位操作码 + inc/shl/sub 的机器码；
 *     2015_解析.txt:484-489）、2017-44（函数 f1 源程序与机器级代码；2017_真题.txt:671-695）、
 *     2019-45（C 函数 f1 的源程序与其机器级代码 + call 相对寻址偏移量；2019_真题.txt:444-530）、
 *     2021-43（16 位定长指令字 R/I/J 格式 + 指令 01B2H 的功能；2021_真题.txt:399-440）、
 *     2023-44（C 程序段的机器级代码行 + jmp/jge 的寻址与目标地址）、2024-43（add/slli/lw 编码与机器码判别；
 *     2024_解析.txt:682-698）、2024-44（sum += a[i] 的指令序列与 slli 机器码；2024_解析.txt:816-827）、
 *     2025-44（题给 C 程序对应的 mov/scov/idiv 机器级代码）、2026-43（R/I/M 型 + OP 编码 + y=16x−5 的机器码；
 *     2026_真题.txt:327-362）。
 *     ⚠ **窗29 就地改正旧结论**：handover §2.2 与 README 原写"机器级代码 **14/18** 年（2009·2012~2015·2017·
 *     2019~2026）"。逐条复核：**漏了 2010**，而 2009-44（取指/译码每拍微操作与控制信号）、
 *     2022-43（暂存器 Y/Z + 取指控制信号序列）属 coa-datapath、2020-43（C 函数 imul 的补码溢出与
 *     加减移位实现乘法）属 coa-muldiv ⟹ **改为 12/18 年**。
 *   · 主考形式：给 C 代码 + 汇编 / 机器码 → 问某条指令的寻址方式、有效地址、访存次数；
 *     问函数调用过程中的栈变化（实参 / 返回地址 / 局部变量各在哪）；给机器码反推指令语义。
 *   · 相邻考点不登记（下一窗别当漏登补回来）：单纯的数据通路微操作序列归 coa-datapath；
 *     扩展操作码的字段位数设计归 coa-inst-format（本模块只"用"格式、不"设计"格式）；
 *     八种寻址方式的 EA 公式归 coa-addressing（本模块把寻址方式当作读懂机器码的手段）。
 *   · **本考点无选择题**（12 年全是大题）⟹ 不涉及 §2.0② 的"选择题单一归属"。
 *   · **无法核对（不猜，留白）**：2026-43 第 (4) 问的答案表是图像（`2026_真题.txt:365-374` 空白）⟹ 只核到题。
 *
 * 数据模型（口径写死在代码里，避免后来者改错）：
 *   · 指令字 **32 位定长** = opcode 5 位 ‖ Rd 4 位 ‖ Rs 4 位 ‖ mode 3 位 ‖ imm16 16 位。
 *   · 8 个寄存器（4 位编号）：0 eax / 1 ebx / 2 ecx / 3 edx / 4 esi / 5 edi / 6 esp / 7 ebp；
 *     eip 不占编号、单独维护。寄存器与内存字一律按**有符号 32 位**存，显示时按 8 位十六进制。
 *   · 代码段：0x00000000 起，每条 4 字节（最多 24 条）。
 *   · 内存窗口：0x00000100 ~ 0x0000013C，共 16 个 32 位字：
 *       0x100~0x10C = 数组 a[0..3]；0x110 = x；0x114 = y；0x118 = m；0x11C = r；0x120~0x13C = 栈。
 *     esp 初值 = 0x140（栈底，向下增长）；每次 push / call 先 esp ← esp − 4 再写。
 *   · 形式地址一律**符号扩展**成 32 位；转移类指令的 imm16 是**绝对目标地址**（相对寻址的换算见 theory）。
 *
 * 不变量（冒烟断言的对象，§3.8-1 "只写不变量"）：
 *   ① 首帧 init / 末帧 done；其余每帧**恰好执行一条**汇编指令，eip 只可能是"下一条"或"合法目标"；
 *   ② 每帧的寄存器组 / 标志位 / 内存都是**全量深拷贝**（改第 k 帧不许污染第 k+1 帧，§1.3）；
 *   ③ **汇编 ⇄ 机器码互逆**：源汇编文本汇编成机器码、再反汇编回来，逐字等于源文本
 *      （这是"机器码逐句分析"这类真题的机器判据）；
 *   ④ 32 位字段划分自洽：opcode / Rd / Rs / mode / imm16 五段按位拼回去必须等于该指令的机器码；
 *   ⑤ 所有转移 / 调用目标都落在代码段内且是 4 的倍数（指令边界）；所有访存地址都落在内存窗口内；
 *   ⑥ 末帧结果必须等于**独立参考实现**（用 JS 直接按 C 语义另算一遍：求和 / 取大 / P+Q / a[2]+5）；
 *   ⑦ 单趟指令条数可闭式预测（循环片段 6N + 5 条、分支片段恰好 1 条跳转被跳过）。
 * ========================================================================== */

/* ---------------------------- ISA 定义（唯一事实源） ---------------------------- */

const AS_REGS = ['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'esp', 'ebp'];
const AS_REG_IX = {};
AS_REGS.forEach((r, i) => { AS_REG_IX[r] = i; });

/* form：rr = "op Rd, 源"｜src = "op 源"（push）｜r1 = "op Rd"（pop）｜addr = "op 目标"｜st｜none */
const AS_OPC = {
  nop: { code: 0x00, form: 'none', desc: '空操作' },
  mov: { code: 0x01, form: 'rr', desc: '传送：Rd ← 源' },
  add: { code: 0x02, form: 'rr', desc: '加法：Rd ← Rd + 源（置标志位）' },
  sub: { code: 0x03, form: 'rr', desc: '减法：Rd ← Rd − 源（置标志位）' },
  cmp: { code: 0x04, form: 'rr', desc: '比较：按 Rd − 源 置标志位，不改 Rd' },
  and: { code: 0x05, form: 'rr', desc: '逻辑与：Rd ← Rd & 源（置标志位）' },
  inc: { code: 0x06, form: 'r1', desc: '自增：Rd ← Rd + 1（置标志位）' },
  lea: { code: 0x07, form: 'rr', desc: '取有效地址：Rd ← EA（不访存）' },
  push: { code: 0x08, form: 'src', desc: '入栈：esp ← esp − 4；M[esp] ← 源' },
  pop: { code: 0x09, form: 'r1', desc: '出栈：Rd ← M[esp]；esp ← esp + 4' },
  jmp: { code: 0x0A, form: 'addr', desc: '无条件转移：eip ← 目标' },
  jz: { code: 0x0B, form: 'addr', desc: 'ZF = 1 时转移' },
  jnz: { code: 0x0C, form: 'addr', desc: 'ZF = 0 时转移' },
  jg: { code: 0x0D, form: 'addr', desc: '有符号大于（ZF = 0 且 SF = OF）时转移' },
  jge: { code: 0x0E, form: 'addr', desc: '有符号大于等于（SF = OF）时转移' },
  jl: { code: 0x0F, form: 'addr', desc: '有符号小于（SF ≠ OF）时转移' },
  jle: { code: 0x10, form: 'addr', desc: '有符号小于等于（ZF = 1 或 SF ≠ OF）时转移' },
  call: { code: 0x11, form: 'addr', desc: '调用：返回地址入栈；eip ← 目标' },
  ret: { code: 0x12, form: 'none', desc: '返回：eip ← M[esp]；esp ← esp + 4' },
  st: { code: 0x13, form: 'st', desc: '写内存：M[EA(Rd)] ← Rs（Rd 是地址基址、Rs 是要写的数据）' },
  hlt: { code: 0x14, form: 'none', desc: '停机（本演示用它表示程序结束、控制权交回操作系统）' },
};

const AS_MODES = {
  0: { name: '寄存器寻址', ea: '(Rs)', acc: 0 },
  1: { name: '立即数寻址', ea: '符号扩展(imm16)', acc: 0 },
  2: { name: '直接寻址', ea: 'imm16', acc: 1 },
  3: { name: '寄存器间接寻址', ea: '(Rs)', acc: 1 },
  4: { name: '寄存器间接 + 位移', ea: '(Rs) + 符号扩展(imm16)', acc: 1 },
  5: { name: '比例变址寻址', ea: '(Rs) × 4 + 符号扩展(imm16)', acc: 1 },
};

/* 内存窗口 */
const AS_MEM0 = 0x100;
const AS_MEMN = 16;
const AS_CODE_MAX = 24;
const AS_STEP_CAP = 400;
/* 数据段单元别名（写进画面，帮助把地址与 C 变量对上） */
const AS_DATA_TAG = {
  0x100: 'a[0]', 0x104: 'a[1]', 0x108: 'a[2]', 0x10C: 'a[3]',
  0x110: 'x', 0x114: 'y', 0x118: 'm', 0x11C: 'r',
};

const AS_H8 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const AS_H4 = v => (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
const AS_BYTES = w => [24, 16, 8, 0].map(s => ((w >>> s) & 0xFF).toString(16).toUpperCase().padStart(2, '0')).join(' ');

/* ============================ 汇编器 / 反汇编器 ============================ */

/** 把"数"或"标号"解析成整数（十进制可带负号；0x 前缀为十六进制） */
function asNum(tok, syms) {
  const t = String(tok).trim();
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (Object.prototype.hasOwnProperty.call(syms, t)) return syms[t];
  throw { message: `汇编里出现无法识别的数或标号「${t}」` };
}

/** 解析"源操作数" → { rs, mode, imm16 } */
function asSrc(tok, syms) {
  const t = String(tok).trim();
  if (t.charAt(0) === '[') {
    if (t.charAt(t.length - 1) !== ']') throw { message: `源操作数「${t}」的方括号不配对` };
    const inner = t.slice(1, -1).replace(/\s+/g, '');
    let m;
    if ((m = /^([a-z]{3})\*4([+-])(0[xX][0-9a-fA-F]+|\d+)$/.exec(inner))) {
      const v = asNum(m[3], syms);
      return { rs: AS_REG_IX[m[1]], mode: 5, imm16: (m[2] === '-' ? -v : v) & 0xFFFF };
    }
    if ((m = /^([a-z]{3})([+-])(0[xX][0-9a-fA-F]+|\d+)$/.exec(inner))) {
      const v = asNum(m[3], syms);
      return { rs: AS_REG_IX[m[1]], mode: 4, imm16: (m[2] === '-' ? -v : v) & 0xFFFF };
    }
    if (AS_REG_IX[inner] != null) return { rs: AS_REG_IX[inner], mode: 3, imm16: 0 };
    return { rs: 0, mode: 2, imm16: asNum(inner, syms) & 0xFFFF };
  }
  if (AS_REG_IX[t] != null) return { rs: AS_REG_IX[t], mode: 0, imm16: 0 };
  return { rs: 0, mode: 1, imm16: asNum(t, syms) & 0xFFFF };
}

/** 按顶层逗号切分操作数（方括号内的逗号不算分隔符） */
function asSplitOps(rest) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < rest.length; i++) {
    const ch = rest.charAt(i);
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 汇编一行 → 指令对象（addr / word 之外的全部字段都算好） */
function asAssemble(src, syms) {
  const t = String(src).trim().replace(/\s+/g, ' ');
  const sp = t.indexOf(' ');
  const mn = (sp < 0 ? t : t.slice(0, sp)).toLowerCase();
  const rest = sp < 0 ? '' : t.slice(sp + 1);
  const meta = AS_OPC[mn];
  if (!meta) throw { message: `汇编里出现未知助记符「${mn}」` };
  const ins = { op: mn, rd: 0, rs: 0, mode: 0, imm16: 0, form: meta.form };
  const ops = asSplitOps(rest);

  if (meta.form === 'none') {
    if (ops.length) throw { message: `${mn} 不带操作数，却写了「${rest}」` };
  } else if (meta.form === 'r1') {
    if (ops.length !== 1 || AS_REG_IX[ops[0]] == null) throw { message: `${mn} 需要恰好 1 个寄存器操作数，现在是「${rest}」` };
    ins.rd = AS_REG_IX[ops[0]];
  } else if (meta.form === 'src') {
    if (ops.length !== 1) throw { message: `${mn} 需要恰好 1 个操作数，现在是「${rest}」` };
    const o = asSrc(ops[0], syms);
    ins.rs = o.rs; ins.mode = o.mode; ins.imm16 = o.imm16;
  } else if (meta.form === 'addr') {
    if (ops.length !== 1) throw { message: `${mn} 需要恰好 1 个转移目标，现在是「${rest}」` };
    ins.mode = 2;
    ins.imm16 = asNum(ops[0], syms) & 0xFFFF;
  } else if (meta.form === 'st') {
    if (ops.length !== 2) throw { message: `st 的写法是 st [地址], 寄存器，现在是「${rest}」` };
    const dst = asSrc(ops[0], syms);
    if (dst.mode < 2) throw { message: `st 的目的必须是内存形式（[绝对地址] / [寄存器] / [寄存器+位移]），现在是「${ops[0]}」` };
    if (AS_REG_IX[ops[1]] == null) throw { message: `st 的源必须是寄存器，现在是「${ops[1]}」` };
    ins.rd = dst.rs; ins.mode = dst.mode; ins.imm16 = dst.imm16; ins.rs = AS_REG_IX[ops[1]];
  } else {
    if (ops.length !== 2) throw { message: `${mn} 需要 2 个操作数（Rd, 源），现在是「${rest}」` };
    if (AS_REG_IX[ops[0]] == null) throw { message: `${mn} 的目的操作数必须是寄存器，现在是「${ops[0]}」` };
    const o = asSrc(ops[1], syms);
    ins.rd = AS_REG_IX[ops[0]];
    ins.rs = o.rs; ins.mode = o.mode; ins.imm16 = o.imm16;
  }
  ins.immExt = (ins.imm16 << 16) >> 16;
  ins.word = (((meta.code << 27) | (ins.rd << 23) | (ins.rs << 19) | (ins.mode << 16) | ins.imm16) >>> 0);
  return ins;
}

/** 反汇编：机器码 → 规范文本（与源文本逐字一致，是"汇编 ⇄ 机器码互逆"的另一半） */
function asDisasm(ins) {
  const op = ins.op;
  const form = AS_OPC[op].form;
  if (form === 'none') return op;
  if (form === 'r1') return op + ' ' + AS_REGS[ins.rd];
  if (form === 'src') return op + ' ' + asSrcText(ins);
  if (form === 'addr') return op + ' 0x' + AS_H4(ins.imm16);
  if (form === 'st') return 'st ' + asMemText(ins) + ', ' + AS_REGS[ins.rs];
  return op + ' ' + AS_REGS[ins.rd] + ', ' + asSrcText(ins);
}
/* ⚠ 写内存指令 st 的"地址基址"存在 rd 字段（rs 字段是数据寄存器），反汇编时必须区分 */
function asBase(ins) { return AS_OPC[ins.op].form === 'st' ? ins.rd : ins.rs; }
function asMemText(ins) {
  const b = asBase(ins);
  if (ins.mode === 2) return '[0x' + AS_H4(ins.imm16) + ']';
  if (ins.mode === 3) return '[' + AS_REGS[b] + ']';
  if (ins.mode === 4) return '[' + AS_REGS[b] + (ins.immExt < 0 ? '-' : '+') + Math.abs(ins.immExt) + ']';
  return '[' + AS_REGS[b] + '*4+0x' + AS_H4(ins.imm16) + ']';
}
function asSrcText(ins) {
  if (ins.mode === 0) return AS_REGS[ins.rs];
  if (ins.mode === 1) return String(ins.immExt);
  return asMemText(ins);
}

/** 位域划分（render 与冒烟共用同一份，避免两处漂移） */
function asFields(ins) {
  const w = ins.word >>> 0;
  return [
    { key: 'opcode', name: '操作码 opcode', bits: 5, sh: 27, val: (w >>> 27) & 0x1F, color: '#6366f1', txt: ins.op },
    { key: 'rd', name: '目的寄存器 Rd', bits: 4, sh: 23, val: (w >>> 23) & 0xF, color: '#0ea5e9', txt: AS_REGS[(w >>> 23) & 0xF] },
    { key: 'rs', name: '源寄存器 Rs', bits: 4, sh: 19, val: (w >>> 19) & 0xF, color: '#14b8a6', txt: AS_REGS[(w >>> 19) & 0xF] },
    { key: 'mode', name: '寻址方式 mode', bits: 3, sh: 16, val: (w >>> 16) & 0x7, color: '#f59e0b', txt: (AS_MODES[(w >>> 16) & 0x7] || { name: '保留' }).name },
    { key: 'imm16', name: '形式地址 imm16', bits: 16, sh: 0, val: w & 0xFFFF, color: '#a855f7', txt: '0x' + AS_H4(w & 0xFFFF) },
  ];
}

/* ================================ 四个 C 片段 ================================ */

const AS_PRESETS = {
  loop: {
    name: '循环求和（比例变址遍历数组）',
    c: [
      'int s = 0;',
      'for (int i = 0; i < N; i++)',
      '    s += a[i];',
      'return s;',
    ],
    asm: v => [
      { txt: 'mov eax, 0', c: 1, note: 's = 0' },
      { txt: 'mov ecx, 0', c: 2, note: 'i = 0' },
      { label: 'again:' },
      { txt: `cmp ecx, ${v.n}`, c: 2, note: 'i 与 N 比较（N 编成立即数：改 N 则机器码跟着变）' },
      { txt: 'jge done', c: 2, note: 'i ≥ N 时跳出循环' },
      { txt: 'mov edx, [ecx*4+0x0100]', c: 3, note: 'a[i]：比例变址寻址，(ecx) × 4 + 0x0100' },
      { txt: 'add eax, edx', c: 3, note: 's += a[i]' },
      { txt: 'add ecx, 1', c: 2, note: 'i++' },
      { txt: 'jmp again', c: 2, note: '无条件跳回条件判断' },
      { label: 'done:' },
      { txt: 'hlt', c: 4, note: '程序结束，结果 s 留在 eax' },
    ],
  },
  branch: {
    name: '条件分支（if-else 的跳转骨架）',
    c: [
      'int m;',
      'if (x > y) m = x;',
      'else       m = y;',
      'return m;',
    ],
    asm: () => [
      { txt: 'mov eax, [0x0110]', c: 2, note: 'x → eax（直接寻址：全局变量住在内存里）' },
      { txt: 'cmp eax, [0x0114]', c: 2, note: '按 x − y 置标志位，eax 本身不变' },
      { txt: 'jle 0x0014', c: 2, note: 'x ≤ y → 走 else 分支' },
      { txt: 'mov ebx, [0x0110]', c: 2, note: 'm = x' },
      { txt: 'jmp 0x0018', c: 2, note: '跳过 else 分支' },
      { txt: 'mov ebx, [0x0114]', c: 3, note: 'm = y' },
      { txt: 'st [0x0118], ebx', c: 4, note: '把 m 写回内存（写内存指令）' },
      { txt: 'hlt', c: 4, note: '程序结束，结果 m 留在 ebx 与 M[0x118]' },
    ],
  },
  call: {
    name: '函数调用（传参 / 返回地址 / 栈帧）',
    c: [
      'int f(int x, int y) {',
      '    int z = x + y;',
      '    return z;',
      '}',
      'int main() { int r = f(P, Q); }',
    ],
    asm: v => [
      { label: 'main:' },
      { txt: `push ${v.q}`, c: 5, note: '第 2 个实参 Q 先入栈（实参从右向左入栈）' },
      { txt: `push ${v.p}`, c: 5, note: '第 1 个实参 P 后入栈 ⟹ P 地址更低，正好是 [ebp+8]' },
      { txt: 'call f', c: 5, note: '返回地址入栈；eip ← f 的入口' },
      { txt: 'add esp, 8', c: 5, note: '调用者清理 2 个实参（栈平衡）' },
      { txt: 'st [0x011C], eax', c: 5, note: 'r = 返回值（约定放在 eax）' },
      { txt: 'hlt', c: 5, note: 'main 结束，控制权交回操作系统' },
      { label: 'f:' },
      { txt: 'push ebp', c: 1, note: '保存调用者的 ebp' },
      { txt: 'mov ebp, esp', c: 1, note: '建立自己的栈帧：ebp 固定下来当帧基址' },
      { txt: 'mov eax, [ebp+8]', c: 2, note: '取第 1 个参数 x（在 ebp 之上）' },
      { txt: 'add eax, [ebp+12]', c: 2, note: '加第 2 个参数 y' },
      { txt: 'st [ebp-4], eax', c: 2, note: 'z = x + y：局部变量在 ebp 之下（负位移）' },
      { txt: 'mov eax, [ebp-4]', c: 3, note: '把 z 放进 eax 当返回值' },
      { txt: 'pop ebp', c: 3, note: '恢复调用者的 ebp' },
      { txt: 'ret', c: 3, note: '弹出返回地址 → eip，回到 main' },
    ],
  },
  ptr: {
    name: '数组与指针（取地址 / 间接寻址 / 写回）',
    c: [
      'int a[4] = {…};',
      'int *p = &a[2];',
      '*p = *p + 5;',
      'return a[2];',
    ],
    asm: () => [
      { txt: 'mov eax, 2', c: 2, note: '下标 2（立即数）' },
      { txt: 'lea ebx, [eax*4+0x0100]', c: 2, note: 'p = &a[2]：算出有效地址，本指令不访存' },
      { txt: 'mov eax, [ebx]', c: 3, note: '*p：寄存器间接寻址（int * 的硬件基础）' },
      { txt: 'add eax, 5', c: 3, note: '*p + 5' },
      { txt: 'st [ebx], eax', c: 3, note: '*p = …：写回 p 指向的那个单元' },
      { txt: 'mov eax, [0x0108]', c: 4, note: 'a[2]：直接寻址，读的是与 *p 同一个单元' },
      { txt: 'hlt', c: 4, note: '程序结束，结果留在 eax' },
    ],
  },
};

/* ================================ 模块本体 ================================ */

RC408.registerModule({
  id: 'coa-assembly',
  mode: 'stepper',
  title: '高级语言 ↔ 机器级代码（C → 汇编 → 机器码 逐句对照）',

  theory: `
> **为什么要有它**：高级语言的一句 C 语句，在机器上要变成若干条汇编指令、每条再编码成一个定长机器码。真题里的「程序的机器级代码表示」考的就是这条链子——给出 C 代码与汇编 / 机器码，问某条指令的寻址方式、有效地址、访存次数，或者问函数调用过程中栈里究竟放了什么。
> **怎么实现**：本演示用一套 **32 位定长指令字**（格式见下表），把 4 个 C 片段（循环 / 分支 / 函数调用 / 指针）逐句汇编成机器码，再一条一条执行；每一帧告诉你"正在对应哪句 C、执行哪条机器码、五个字段各是什么、寄存器和内存怎么变"。
> **记住什么**：**机器码 = 操作码 + 寄存器号 + 寻址方式 + 形式地址** 四段拼出来的；**比例变址寻址让 a[i] 的下标直接当索引**（硬件替你乘 4）；**函数调用三件事——实参入栈、返回地址入栈、ebp / esp 划出栈帧**；**局部变量在 ebp 之下（负位移），参数在 ebp 之上（正位移）**。

## 一、本演示的指令字格式（32 位定长）
| 字段 | 位宽 | 位置 | 含义 |
| --- | --- | --- | --- |
| 操作码 opcode | 5 | 31~27 | 做什么运算（mov / add / cmp / jmp / call …） |
| 目的寄存器 Rd | 4 | 26~23 | 结果写到哪个寄存器；**写内存指令里它当"地址基址"** |
| 源寄存器 Rs | 4 | 22~19 | 参与寻址的寄存器；写内存指令里它是"要写的数据寄存器" |
| 寻址方式 mode | 3 | 18~16 | 8 种方式里选 1 种，决定形式地址怎么变成有效地址 |
| 形式地址 imm16 | 16 | 15~0 | 立即数 / 位移量 / 绝对地址，一律**符号扩展**成 32 位后再用 |

**为什么用定长**：取指简单（每拍 PC + 4，不必先译码才知道指令多长），代价是编码密度低。真题里"指令格式设计"（各字段留几位、扩展操作码怎么扣）是另一个考点，本演示只**用**格式、不设计格式。

## 二、寻址方式（mode 三位）与 C 的对应
| mode | 名称 | 有效地址 / 操作数 | 取操作数访存次数 | 对应哪种 C 写法 |
| --- | --- | --- | --- | --- |
| 000 | 寄存器寻址 | 操作数 = (Rs) | 0 | 局部变量被优化进寄存器 |
| 001 | 立即数寻址 | 操作数 = 符号扩展(imm16) | 0 | 常量、循环次数 N、小整数 |
| 010 | 直接寻址 | EA = imm16 | 1 | 全局变量 x / m / r |
| 011 | 寄存器间接寻址 | EA = (Rs) | 1 | 指针取值 *p |
| 100 | 寄存器间接 + 位移 | EA = (Rs) + 符号扩展(imm16) | 1 | 局部变量 [ebp−4]、参数 [ebp+8] |
| 101 | 比例变址寻址 | EA = (Rs) × 4 + 符号扩展(imm16) | 1 | 数组元素 a[i] |
| 110 / 111 | 保留 | —— | —— | —— |

**比例变址是 a[i] 的关键**：元素宽度 4 字节，硬件把下标寄存器**先乘 4 再加重址**，于是 C 里的 a[i] 只对应一条指令。这就是教材说"变址寻址特别适合数组循环"的机器级含义——**乘 4 由硬件做，程序员不必手写**。

## 三、四个 C 片段各自考什么
1. **循环求和**：初始化 → 条件判断（cmp 只置标志位 + 条件转移）→ 循环体 → 计数加一 → 无条件跳回；数组元素用比例变址取。骨架是"判断在前、回跳在后"。
2. **条件分支**：cmp 不改寄存器；**jle 走 else、jmp 跳过 else**——两条跳转就是 if-else 的标准骨架；全局变量走直接寻址。
3. **函数调用**：**实参从右向左入栈**（保证第 1 个参数落在低地址，也就是 ebp + 8）；**call 把返回地址压栈**；被调函数用 push ebp / mov ebp, esp 建立栈帧；**局部变量在 [ebp−4]，参数在 [ebp+8]、[ebp+12]**；ret 弹出返回地址回到调用点；最后调用者 add esp, 8 清理实参。
4. **数组与指针**：lea 只算有效地址、**不访存**；mov eax, [ebx] 是寄存器间接寻址（int * 的硬件基础）；st 把寄存器写回内存；最后 a[2] 用直接寻址再读回来，验证它与 *p 确实是同一个单元。

## 四、栈帧一图（函数调用片段，f 刚建立好栈帧时）
| 地址 | 内容 | 怎么找到它 |
| --- | --- | --- |
| ebp − 8 | （留白未用） | —— |
| ebp − 4 | 局部变量 z | [ebp−4] |
| ebp + 0 | 调用者保存的 ebp（push ebp 压入） | [ebp] |
| ebp + 4 | **返回地址**（call 压入） | [ebp+4] |
| ebp + 8 | 第 1 个实参 P | [ebp+8] |
| ebp + 12 | 第 2 个实参 Q | [ebp+12] |
| 更高地址 | 调用者的栈帧 | —— |

**一句话记住**：**参数在 ebp 上面（正位移），局部变量和保存的 ebp 在 ebp 下面（负位移），返回地址永远紧贴 ebp 上面第一格。**

## 五、易错点
1. **cmp 不写目的寄存器**：它只按"目的 − 源"置 ZF / SF / OF / CF，所以 cmp 后面必须跟条件转移才有意义。
2. **条件转移别记反**：jg / jge / jl / jle 是**有符号**比较（看 SF 与 OF）；C 的 int 比较用它，无符号数才换另一套。
3. **"一条指令访存几次"只数取操作数那一次**：立即数与寄存器寻址一次都不访存；比例变址虽然要先算 (Rs) × 4 + 位移，仍然只访存一次；lea 只算地址、同样不访存。
4. **形式地址必须符号扩展**：[ebp−4] 里的 −4 编码成 16 位是 FFFC，必须符号扩展成 32 位的 −4 才能参与加法；当作无符号的 65532 就会算到天上去。
5. **改数据不一定改机器码**：把 x / y 改掉，机器码一个字节都不变（它们住在内存里）；把循环次数 N 或实参 P / Q 改掉，立即数字段就跟着变——**这就是"指令里的立即数在编译期就被定死"的含义**。
6. **转移指令填的是目标地址**：本演示的 jmp / call 在 imm16 里填**绝对地址**；若改成相对寻址，同一个字段要填"目标 − (PC + 4)"这个偏移量——**字段位数不变，含义变了**，这也是真题爱考的一点。
7. **程序结束时用 hlt**：真实机器的 main 返回要由操作系统接管；本演示用一个 hlt 指令表示"程序结束、控制权交回操作系统"，省掉一段与考点无关的代码。

> **真题考情**：**12/18 年、13 道大题**（2010-43、2012-44、2013-44、2014-44、2015-44、2017-44、2019-45、2021-43、2023-44、2024-43 / 2024-44、2025-44、2026-43）：给出 C 代码与汇编 / 机器码，求寻址方式、有效地址、访存次数，或问函数调用过程中的栈与返回地址。⚠ 旧结论"14/18 年"**已改正**：漏了 2010，而 2009-44 / 2022-43 属数据通路、2020-43 属乘除运算，都不登记在本考点。
`,

  inputs: [
    {
      key: 'preset', label: '高级语言片段（C → 汇编 → 机器码）', type: 'select', default: 'loop', wide: true,
      options: Object.keys(AS_PRESETS).map(k => ({ v: k, t: AS_PRESETS[k].name + '（' + AS_PRESETS[k].c.length + ' 句 C）' })),
    },
    {
      key: 'arr', label: '数组 a[4] 初值（4 个十进制整数，逗号分隔）', type: 'text', default: '10,20,30,40',
      help: '写进 0x0100 ~ 0x010C；循环片段读它求和，指针片段改它（a[2] ← a[2] + 5）',
    },
    {
      key: 'vars', label: '变量取值（每行「名字=十进制值」）：x / y = 分支片段；n = 循环次数；p / q = 调用片段两个实参',
      type: 'textarea', rows: 5, wide: true,
      default: 'x=7\ny=3\nn=4\np=3\nq=5',
      help: '循环次数 n 只允许 1~4（数组只有 4 个元素）；x / y 写进内存 0x0110 / 0x0114；p / q 会变成 push 的立即数',
    },
    {
      key: 'regs', label: '寄存器初值（8 行「寄存器=值」，值可写十进制或 0x 十六进制）', type: 'textarea', rows: 8, wide: true,
      default: 'eax=0\nebx=0\necx=0\nedx=0\nesi=0\nedi=0\nesp=0x140\nebp=0x140',
      help: 'esp / ebp 初值 0x0140 是栈底（栈向低地址增长）；函数调用片段会一路压到 0x012C',
    },
  ],

  quickActions: [
    { label: '📘 循环求和：for (i < N) s += a[i]（比例变址）', run(rt) { rt.setInput('preset', 'loop'); rt.load(); } },
    { label: '📘 条件分支：if (x > y) m = x; else m = y;', run(rt) { rt.setInput('preset', 'branch'); rt.load(); } },
    { label: '📘 函数调用：f(P, Q) 的传参 / 返回地址 / 栈帧', run(rt) { rt.setInput('preset', 'call'); rt.load(); } },
    { label: '📘 数组与指针：p = &a[2]; *p = *p + 5;', run(rt) { rt.setInput('preset', 'ptr'); rt.load(); } },
    {
      label: '🎲 随机数据（看机器码哪一段跟着变）',
      run(rt) {
        const a = [];
        for (let i = 0; i < 4; i++) a[i] = 1 + Math.floor(Math.random() * 40);
        rt.setInput('arr', a.join(','));
        rt.setInput('vars', 'x=' + (1 + Math.floor(Math.random() * 40)) +
          '\ny=' + (1 + Math.floor(Math.random() * 40)) +
          '\nn=' + (2 + Math.floor(Math.random() * 3)) +
          '\np=' + (1 + Math.floor(Math.random() * 20)) +
          '\nq=' + (1 + Math.floor(Math.random() * 20)));
        rt.load();
      },
    },
  ],

  parse(vals) {
    /* ---------- 片段 ---------- */
    const pid = Object.prototype.hasOwnProperty.call(AS_PRESETS, vals.preset) ? vals.preset : 'loop';
    const P = AS_PRESETS[pid];

    /* ---------- 数组 ---------- */
    const arr = String(vals.arr == null ? '' : vals.arr).trim().split(/[,，\s]+/).filter(Boolean).map(s => {
      if (!/^-?\d+$/.test(s)) throw { message: `数组初值「${s}」不是十进制整数（要 4 个，逗号分隔）` };
      const n = parseInt(s, 10);
      if (n < -0x8000 || n > 0x7FFF) throw { message: `数组初值 ${n} 超出本演示的数域（−32768 ~ 32767）` };
      return n;
    });
    if (arr.length !== 4) throw { message: `数组 a 要写 4 个初值，现在给了 ${arr.length} 个（例：10,20,30,40）` };

    /* ---------- 变量 ---------- */
    const varDef = { x: 7, y: 3, n: 4, p: 3, q: 5 };
    String(vals.vars == null ? '' : vals.vars).split('\n').map(s => s.trim()).filter(Boolean).forEach(line => {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+)$/.exec(line);
      if (!m) throw { message: `变量行「${line}」格式应为「名字=十进制值」，如 x=7` };
      if (!Object.prototype.hasOwnProperty.call(varDef, m[1])) {
        throw { message: `不能识别的变量名「${m[1]}」：本演示只允许 x / y / n / p / q` };
      }
      const v = parseInt(m[2], 10);
      if (v < -0x8000 || v > 0x7FFF) throw { message: `变量 ${m[1]} = ${v} 超出本演示的数域（−32768 ~ 32767）` };
      varDef[m[1]] = v;
    });
    if (!(varDef.n >= 1 && varDef.n <= 4)) {
      throw { message: `循环次数 n = ${varDef.n} 不合法：数组 a 只有 4 个元素，n 必须取 1~4（否则会越界读到 x / y 所在的单元）` };
    }

    /* ---------- 寄存器 ---------- */
    const regs0 = AS_REGS.map(() => 0);
    const seen = {};
    String(vals.regs == null ? '' : vals.regs).split('\n').map(s => s.trim()).filter(Boolean).forEach(line => {
      const m = /^([A-Za-z]{3})\s*=\s*(-?(?:\d+|0[xX][0-9a-fA-F]+))$/.exec(line);
      if (!m) throw { message: `寄存器行「${line}」格式应为「寄存器=值」，如 eax=0 或 esp=0x140` };
      const ix = AS_REG_IX[m[1].toLowerCase()];
      if (ix == null) throw { message: `不是本演示的寄存器：${m[1]}（只有 ${AS_REGS.join(' / ')}）` };
      if (seen[ix]) throw { message: `寄存器 ${m[1]} 写了两次` };
      seen[ix] = 1;
      const v = /^0[xX]/.test(m[2]) ? parseInt(m[2], 16) : parseInt(m[2], 10);
      if (v < 0 || v > 0xFFFFFFFF) throw { message: `寄存器 ${m[1]} 的值 ${m[2]} 超出 32 位范围` };
      regs0[ix] = v | 0;
    });
    if (Object.keys(seen).length !== AS_REGS.length) {
      const miss = AS_REGS.filter((r, i) => !seen[i]);
      throw { message: `寄存器初值要写全 8 个：还缺 ${miss.join(' / ')}` };
    }
    if (regs0[6] < AS_MEM0 + 4 || regs0[6] > AS_MEM0 + 4 * AS_MEMN) {
      throw { message: `esp 初值 ${AS_H8(regs0[6])} 不在栈窗口内（应取 0x0120 ~ 0x0140，默认 0x0140）` };
    }

    /* ---------- 汇编：两趟（先收标号地址，再逐条编码） ---------- */
    const lines = P.asm(varDef);
    const syms = {};
    let addr = 0;
    lines.forEach(L => {
      if (L.label) {
        const name = L.label.replace(/:$/, '');
        if (Object.prototype.hasOwnProperty.call(syms, name)) throw { message: `标号 ${name} 定义了两次` };
        syms[name] = addr;
        return;
      }
      addr += 4;
    });
    if (addr === 0 || addr > AS_CODE_MAX * 4) throw { message: `代码段有 ${addr / 4} 条指令，超出本演示的上限 ${AS_CODE_MAX} 条` };

    const rows = [];
    addr = 0;
    lines.forEach(L => {
      if (L.label) {
        rows.push({ kind: 'label', addr, label: L.label, word: null, c: 0, note: '' });
        return;
      }
      const src = L.txt.replace(/\s+/g, ' ').trim();
      const ins = asAssemble(src, syms);
      ins.txt = src;
      ins.addr = addr;
      ins.kind = 'code';
      ins.c = L.c || 0;
      ins.note = L.note || '';
      /* 不变量 ③：汇编 ⇄ 机器码必须互逆——两条都要过 */
      const back = asDisasm(ins);
      if (asAssemble(back, syms).word !== ins.word) {
        throw { message: `内部错误：机器码 0x${AS_H8(ins.word)} 反汇编成「${back}」后再汇编回去，机器码变了（互逆判据不成立）` };
      }
      if (src !== back) {
        /* 转移类允许把目标写成标号（汇编源用标号、反汇编只能给数值地址，两者等价） */
        let label = null;
        if (AS_OPC[ins.op].form === 'addr') {
          Object.keys(syms).forEach(k => { if (syms[k] === ins.imm16 && label === null) label = k; });
        }
        const alt = label === null ? null : ins.op + ' ' + label;
        if (alt === null || src !== alt) {
          throw { message: `内部错误：汇编文本「${src}」与反汇编结果「${back}」不一致（互逆判据不成立）` };
        }
      }
      rows.push(ins);
      addr += 4;
    });

    const byAddr = {};
    rows.forEach(r => { if (r.kind === 'code') byAddr[r.addr] = r; });
    /* 转移目标必须落在代码段内、且是指令起始地址 */
    rows.forEach(r => {
      if (r.kind !== 'code') return;
      if (AS_OPC[r.op].form !== 'addr') return;
      if (!Object.prototype.hasOwnProperty.call(byAddr, r.immExt)) {
        throw { message: `内部错误：${r.op} 的目标 0x${AS_H4(r.imm16)} 不是一条指令的起始地址（标号要单独占一行，紧接在目标指令之前）` };
      }
    });

    /* ---------- 内存 ---------- */
    const mi = a => {
      const d = a - AS_MEM0;
      if (!(a >= AS_MEM0 && a <= AS_MEM0 + 4 * (AS_MEMN - 1) && d % 4 === 0)) {
        throw { message: `访存地址 ${AS_H8(a)} 越界：本演示的内存窗口是 0x0100 ~ 0x013C（按字对齐）` };
      }
      return d / 4;
    };
    const mem0 = [];
    for (let i = 0; i < AS_MEMN; i++) mem0.push(0);
    for (let i = 0; i < 4; i++) mem0[mi(AS_MEM0 + 4 * i)] = arr[i];
    mem0[mi(0x110)] = varDef.x;
    mem0[mi(0x114)] = varDef.y;

    return {
      pid, presetName: P.name, cLines: P.c.slice(), rows, byAddr, syms,
      entry: syms.main != null ? syms.main : 0,
      regs0, mem0, mi, v: varDef, arr,
      codeAddrs: rows.filter(r => r.kind === 'code').map(r => r.addr),
    };
  },

  buildSnapshots(model) {
    const m = model;
    const st = { regs: m.regs0.slice(), mem: m.mem0.slice(), eip: m.entry, flags: { ZF: 0, SF: 0, OF: 0, CF: 0 } };

    const memAt = a => st.mem[m.mi(a)];
    const memWr = (a, v) => { st.mem[m.mi(a)] = v | 0; };
    const setFlags = (r, a, b, kind) => {
      st.flags.ZF = r === 0 ? 1 : 0;
      st.flags.SF = r < 0 ? 1 : 0;
      if (kind === 'add') {
        st.flags.CF = (a + b > 0x7FFFFFFF || a + b < -0x80000000) ? 1 : 0;
        st.flags.OF = (((a ^ r) & (b ^ r)) < 0) ? 1 : 0;
      } else if (kind === 'sub') {
        st.flags.CF = ((a >>> 0) < (b >>> 0)) ? 1 : 0;
        st.flags.OF = (((a ^ b) & (a ^ r)) < 0) ? 1 : 0;
      } else { st.flags.CF = 0; st.flags.OF = 0; }
    };
    /* ⚠ st 的地址基址在 rd 字段（rs 是数据寄存器），求 EA 必须走 asBase，别一律用 rs */
    const eaOf = ins => {
      const b = asBase(ins);
      if (ins.mode === 2) return ins.immExt;
      if (ins.mode === 3) return st.regs[b];
      if (ins.mode === 4) return (st.regs[b] + ins.immExt) | 0;
      if (ins.mode === 5) return (st.regs[b] * 4 + ins.immExt) | 0;
      return null;
    };
    const readSrc = ins => {
      if (ins.mode === 0) return st.regs[ins.rs];
      if (ins.mode === 1) return ins.immExt;
      return memAt(eaOf(ins));
    };
    const jumpTaken = op => {
      const f = st.flags;
      if (op === 'jmp') return true;
      if (op === 'jz') return f.ZF === 1;
      if (op === 'jnz') return f.ZF === 0;
      if (op === 'jg') return f.ZF === 0 && f.SF === f.OF;
      if (op === 'jge') return f.SF === f.OF;
      if (op === 'jl') return f.SF !== f.OF;
      if (op === 'jle') return f.ZF === 1 || f.SF !== f.OF;
      return false;
    };

    const snaps = [];
    /* 统一入口：每帧都带全量深拷贝（§1.3 铁律）+ 本帧变化清单 */
    const push = (kind, cur, desc, logTxt, logType, extra) => {
      const ex = extra || {};
      const prevRegs = ex.prevRegs || st.regs.slice();
      const prevMem = ex.prevMem || st.mem.slice();
      const chRegs = [], chMem = [];
      st.regs.forEach((v, i) => { if (v !== prevRegs[i]) chRegs.push(i); });
      st.mem.forEach((v, i) => { if (v !== prevMem[i]) chMem.push(i); });
      snaps.push({
        kind, idx: snaps.length,
        eip: ex.execAddr != null ? ex.execAddr : (cur ? cur.addr : st.eip),
        nextEip: st.eip,
        regs: st.regs.slice(), mem: st.mem.slice(),
        flags: { ZF: st.flags.ZF, SF: st.flags.SF, OF: st.flags.OF, CF: st.flags.CF },
        prevRegs, prevMem, chRegs, chMem,
        cur: cur || null, ea: ex.ea != null ? ex.ea : null, acc: ex.acc != null ? ex.acc : null,
        desc, log: logTxt, logType,
      });
    };

    /* ---------- init ---------- */
    const firstIns = m.byAddr[st.eip];
    push('init', null,
      `就绪：C 片段「${m.presetName}」已汇编成 ${m.codeAddrs.length} 条机器码，程序入口 eip = ${AS_H8(st.eip)}（${firstIns ? asDisasm(firstIns) : '—'}）。点"单步"逐条执行：每条汇编一帧，机器码字段、寄存器与内存都跟着变。`,
      `就绪：${m.presetName}｜${m.codeAddrs.length} 条指令｜入口 ${AS_H8(st.eip)}`,
      'info');

    /* ---------- 逐条执行（一条汇编一帧） ---------- */
    let guard = 0;
    while (st.eip !== null) {
      if (++guard > AS_STEP_CAP) {
        throw { message: `程序执行超过 ${AS_STEP_CAP} 条指令仍未停机：请检查循环次数 n（当前 ${m.v.n}）与寄存器初值` };
      }
      const ins = m.byAddr[st.eip];
      if (!ins) throw { message: `eip = ${AS_H8(st.eip)} 不是一条指令的起始地址（转移目标算错了）` };
      const meta = AS_OPC[ins.op];
      const prevRegs = st.regs.slice();
      const prevMem = st.mem.slice();
      const next = (ins.addr + 4) | 0;
      /* EA 必须在"执行前"的寄存器状态上算（比例变址用的是执行前的 Rs） */
      let eaVal = null;
      if (meta.form === 'rr' || meta.form === 'st') {
        if (ins.mode >= 2) eaVal = eaOf(ins);
      }
      const accCnt = meta.form === 'st' ? 1 : ((meta.form === 'rr' && ins.mode >= 2 && ins.op !== 'lea') ? (AS_MODES[ins.mode] || { acc: 0 }).acc : null);

      let desc = '';
      let logTxt = '';
      let logType = 'info';
      st.eip = next;   /* 先假设顺序执行；跳转 / 调用 / 停机再覆盖 */
      const dis = asDisasm(ins);
      const A = AS_H8(ins.addr);

      if (ins.op === 'mov') {
        const v = readSrc(ins) | 0;
        st.regs[ins.rd] = v;
        desc = `执行 ${dis}：${AS_REGS[ins.rd]} 变成 ${AS_H8(v)}。${ins.note}`;
        logTxt = `${A}  ${dis}｜${AS_REGS[ins.rd]} = ${AS_H8(v)}`;
      } else if (ins.op === 'add' || ins.op === 'sub' || ins.op === 'cmp' || ins.op === 'and') {
        const a = st.regs[ins.rd];
        const b = readSrc(ins) | 0;
        const r = ins.op === 'add' ? ((a + b) | 0) : ins.op === 'and' ? ((a & b) | 0) : ((a - b) | 0);
        setFlags(r, a, b, ins.op === 'add' ? 'add' : (ins.op === 'and' ? 'and' : 'sub'));
        if (ins.op !== 'cmp') st.regs[ins.rd] = r;
        const fTxt = `ZF=${st.flags.ZF} SF=${st.flags.SF} OF=${st.flags.OF} CF=${st.flags.CF}`;
        if (ins.op === 'cmp') {
          desc = `执行 ${dis}：只按 ${AS_REGS[ins.rd]} − 源 置标志位，${AS_REGS[ins.rd]} 保持 ${AS_H8(a)} 不变；${fTxt}。${ins.note}`;
        } else {
          const sign = ins.op === 'add' ? '+' : (ins.op === 'sub' ? '−' : '&');
          desc = `执行 ${dis}：${AS_REGS[ins.rd]} = ${AS_H8(a)} ${sign} ${AS_H8(b)} = ${AS_H8(st.regs[ins.rd])}；${fTxt}。${ins.note}`;
        }
        logTxt = `${A}  ${dis}｜${ins.op === 'cmp' ? '仅置标志位' : AS_REGS[ins.rd] + ' = ' + AS_H8(st.regs[ins.rd])}｜${fTxt}`;
      } else if (ins.op === 'inc') {
        const a = st.regs[ins.rd];
        const r = (a + 1) | 0;
        st.regs[ins.rd] = r;
        setFlags(r, a, 1, 'add');
        desc = `执行 ${dis}：${AS_REGS[ins.rd]} = ${AS_H8(a)} + 1 = ${AS_H8(r)}。${ins.note}`;
        logTxt = `${A}  ${dis}｜${AS_REGS[ins.rd]} = ${AS_H8(r)}`;
      } else if (ins.op === 'lea') {
        st.regs[ins.rd] = eaVal | 0;
        desc = `执行 ${dis}：按 ${(AS_MODES[ins.mode] || {}).ea} 算出有效地址 ${AS_H8(eaVal)} 送 ${AS_REGS[ins.rd]}。本指令只算地址、不访存，所以它是"取地址"而不是"取值"。${ins.note}`;
        logTxt = `${A}  ${dis}｜EA = ${AS_H8(eaVal)} → ${AS_REGS[ins.rd]}`;
      } else if (ins.op === 'push') {
        const v = readSrc(ins) | 0;
        st.regs[6] = (st.regs[6] - 4) | 0;
        memWr(st.regs[6], v);
        desc = `执行 ${dis}：esp 先减 4 变成 ${AS_H8(st.regs[6])}，再把 ${AS_H8(v)} 写进去。${ins.note}`;
        logTxt = `${A}  ${dis}｜M[${AS_H8(st.regs[6])}] ← ${AS_H8(v)}；esp = ${AS_H8(st.regs[6])}`;
      } else if (ins.op === 'pop') {
        const at = st.regs[6];
        const v = memAt(at);
        st.regs[ins.rd] = v | 0;
        st.regs[6] = (at + 4) | 0;
        desc = `执行 ${dis}：${AS_REGS[ins.rd]} ← M[${AS_H8(at)}] = ${AS_H8(v)}，随后 esp 加 4 变成 ${AS_H8(st.regs[6])}。${ins.note}`;
        logTxt = `${A}  ${dis}｜${AS_REGS[ins.rd]} = ${AS_H8(v)}；esp = ${AS_H8(st.regs[6])}`;
      } else if (ins.op === 'st') {
        const v = st.regs[ins.rs];
        memWr(eaVal, v);
        desc = `执行 ${dis}：M[${AS_H8(eaVal)}] ← ${AS_REGS[ins.rs]} = ${AS_H8(v)}。写内存指令里 Rd 字段当地址基址、Rs 字段才是数据。${ins.note}`;
        logTxt = `${A}  ${dis}｜M[${AS_H8(eaVal)}] ← ${AS_H8(v)}`;
      } else if (ins.op === 'call') {
        st.regs[6] = (st.regs[6] - 4) | 0;
        memWr(st.regs[6], next);
        st.eip = ins.immExt;
        desc = `执行 ${dis}：先把返回地址 ${AS_H8(next)} 压栈（M[${AS_H8(st.regs[6])}]），再让 eip ← ${AS_H8(st.eip)}。返回地址入栈正是 call 与 jmp 的唯一区别。${ins.note}`;
        logTxt = `${A}  ${dis}｜返回地址 ${AS_H8(next)} 入栈；eip ← ${AS_H8(st.eip)}`;
      } else if (ins.op === 'ret') {
        const at = st.regs[6];
        const t = memAt(at) | 0;
        st.eip = t;
        st.regs[6] = (at + 4) | 0;
        desc = `执行 ${dis}：从 M[${AS_H8(at)}] 弹出返回地址 ${AS_H8(t)} 送 eip，esp 加 4 变成 ${AS_H8(st.regs[6])}。${ins.note}`;
        logTxt = `${A}  ${dis}｜eip ← ${AS_H8(t)}（回到调用点）；esp = ${AS_H8(st.regs[6])}`;
      } else if (meta.form === 'addr') {
        const taken = jumpTaken(ins.op);
        if (taken) st.eip = ins.immExt;
        const cond = ins.op === 'jmp' ? '无条件转移' : `${ins.op} 的条件${taken ? '成立' : '不成立'}`;
        desc = `执行 ${dis}：${cond} ⟹ eip ${taken ? '← ' + AS_H8(st.eip) : '顺序前进到 ' + AS_H8(st.eip)}。条件转移只看标志位，不比较、也不访存。${ins.note}`;
        logTxt = `${A}  ${dis}｜${cond}；eip = ${AS_H8(st.eip)}`;
      } else if (ins.op === 'hlt') {
        st.eip = null;
        desc = `执行 hlt：程序结束，控制权交回操作系统。${ins.note}`;
        logTxt = `${A}  hlt｜程序结束`;
      } else {
        desc = `执行 ${dis}：${meta.desc}。${ins.note}`;
        logTxt = `${A}  ${dis}`;
      }

      push('exec', ins, desc, logTxt, logType, { prevRegs, prevMem, execAddr: ins.addr, ea: eaVal, acc: accCnt });
    }

    /* ---------- done ---------- */
    const nExec = snaps.length - 1;
    push('done', null,
      `完成：${m.presetName} 共执行 ${nExec} 条机器码。最终 eax = ${AS_H8(st.regs[0])}、ebx = ${AS_H8(st.regs[1])}，栈顶 esp = ${AS_H8(st.regs[6])}（已回到 ${AS_H8(m.regs0[6])} 说明栈平衡）。`,
      `完成：${m.presetName}｜共 ${nExec} 条指令｜eax = ${AS_H8(st.regs[0])}、ebx = ${AS_H8(st.regs[1])}、esp = ${AS_H8(st.regs[6])}`,
      'success', { prevRegs: st.regs.slice(), prevMem: st.mem.slice() });
    return snaps;
  },

  render(ctx) {
    const { snap: s, model: M, stage } = ctx;
    const esc = RC408.util.esc;
    const cur = s.cur;
    const nExec = ctx.total - 2;

    /* ---------- 卡片 1：统计 ---------- */
    const cTxt = cur && cur.c ? M.cLines[cur.c - 1] : '';
    const cards =
      RC408.ui.statCard('当前对应 C 语句', cur && cur.c ? '第 ' + cur.c + ' 行' : (s.kind === 'done' ? '全部执行完' : '（未开始）'),
        esc((cTxt || M.cLines[0]).slice(0, 24)), 'text-indigo-600') +
      RC408.ui.statCard('指令进度', s.kind === 'init' ? '0 / ' + nExec : (s.kind === 'done' ? '完成' : s.idx + ' / ' + nExec),
        s.kind === 'exec' ? '本帧执行 eip = ' + AS_H8(s.eip) : (s.kind === 'done' ? '已停机' : '入口 ' + AS_H8(M.entry)), 'text-slate-800') +
      RC408.ui.statCard('标志位', s.flags.ZF || s.flags.SF || s.flags.OF || s.flags.CF
        ? (s.flags.ZF ? 'ZF ' : '') + (s.flags.SF ? 'SF ' : '') + (s.flags.OF ? 'OF ' : '') + (s.flags.CF ? 'CF' : '') : '全 0',
        'cmp 与算术指令会改标志位', 'text-amber-600') +
      RC408.ui.statCard('内存窗口', '0x0100 ~ 0x013C', '16 个 32 位字：数据段 + 栈段', 'text-slate-500');

    /* ---------- 卡片 2：C ↔ 汇编 ↔ 机器码 ---------- */
    const cCol = M.cLines.map((line, i) => {
      const no = i + 1;
      const hot = cur && cur.c === no;
      return `<div class="as-c-line${hot ? ' cur' : ''}" data-c="${no}" style="display:flex;gap:8px;padding:2px 6px;border-radius:6px;box-sizing:border-box;font:600 12px Consolas,monospace;background:${hot ? '#eef2ff' : 'transparent'};color:${hot ? '#3730a3' : '#334155'}">
        <span style="color:#94a3b8;width:16px;text-align:right">${no}</span><span>${esc(line)}</span></div>`;
    }).join('');

    const asmRows = M.rows.map(r => {
      if (r.kind === 'label') {
        return `<div class="as-code-row as-code-label" data-addr="${AS_H8(r.addr)}" style="display:flex;gap:8px;padding:1px 6px;font:700 12px Consolas,monospace;color:#b45309">${esc(r.label)}</div>`;
      }
      const hot = cur && cur.addr === r.addr;
      return `<div class="as-code-row${hot ? ' cur' : ''}" data-addr="${AS_H8(r.addr)}" data-op="${r.op}" style="display:flex;gap:8px;align-items:baseline;padding:2px 6px;border-radius:6px;box-sizing:border-box;font:600 12px Consolas,monospace;background:${hot ? '#eef2ff' : 'transparent'}">
        <span style="color:#94a3b8">${AS_H8(r.addr)}</span>
        <span class="as-word" style="color:#a855f7">${AS_BYTES(r.word)}</span>
        <span style="color:${hot ? '#3730a3' : '#0f172a'};min-width:212px">${esc(asDisasm(r))}</span>
        <span class="as-cmap" style="color:#64748b;font-weight:400">${r.c ? 'C 第 ' + r.c + ' 行' : ''}</span></div>`;
    }).join('');

    /* ---------- 卡片 3：字段划分 ---------- */
    let strip = '', fldTable = '', eaTxt = '';
    if (cur) {
      const bins = RC408.util.bin(cur.word >>> 0, 32);
      const fields = asFields(cur);
      let pos = 0;
      strip = fields.map(f => {
        const seg = bins.slice(pos, pos + f.bits); pos += f.bits;
        return `<span class="as-fld" data-f="${f.key}" style="background:${f.color}1a;color:${f.color};border-left:1.5px solid ${f.color}66;padding:2px 3px;font:700 12px Consolas,monospace">${seg}</span>`;
      }).join('');
      const form = AS_OPC[cur.op].form;
      const rdHint = form === 'addr' || form === 'none' || (form === 'st' && cur.mode === 2) || form === 'src'
        ? '（本指令不把结果写寄存器，此字段不用）' : '';
      const rsHint = form === 'st' ? '（要写入内存的数据寄存器）' : (form === 'addr' || form === 'none' || form === 'r1' ? '（本指令不用）' : '');
      fldTable = fields.map(f => {
        const vTxt = f.key === 'imm16' ? f.txt + '（符号扩展后 = ' + cur.immExt + '）' : f.txt;
        const hint = f.key === 'rd' ? rdHint : (f.key === 'rs' ? rsHint : '');
        return `<tr class="as-fld-row" data-f="${f.key}">
          <td style="padding:2px 8px"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${f.color}"></span> ${f.name}</td>
          <td style="padding:2px 8px;color:#64748b">${f.bits} 位（${f.sh + f.bits - 1}~${f.sh}）</td>
          <td style="padding:2px 8px;font-family:Consolas,monospace">${f.val} = ${esc(vTxt)} ${esc(hint)}</td></tr>`;
      }).join('');
      const mo = AS_MODES[cur.mode] || { name: '保留', ea: '—', acc: 0 };
      const accTxt = s.acc === null || s.acc === undefined ? '本指令不取内存操作数，一条也不访存'
        : (s.acc === 0 ? '一条也不访存' : '访存 ' + s.acc + ' 次');
      eaTxt =
        '<div class="as-ea" style="font:600 12px Consolas,monospace;color:#0f172a;padding:4px 8px;background:#f8fafc;border-radius:6px">' +
        '寻址方式 mode = ' + cur.mode + ' ⟹ ' + mo.name + '；' + accTxt +
        (s.ea === null || s.ea === undefined ? '' : '；代入本帧执行前的寄存器：EA = ' + mo.ea + ' = ' + AS_H8(s.ea)) +
        '</div>' +
        (form === 'addr'
          ? '<div class="as-rel" style="font:400 12px system-ui;color:#475569;padding:4px 8px;background:#fffbeb;border-radius:6px">⚠ 本指令是转移类：imm16 = ' +
            AS_H8(cur.imm16) + ' 填的是<b>绝对目标地址</b>。若改成相对寻址，同一个 16 位字段要填 目标 − (PC+4) = ' +
            AS_H8(cur.imm16) + ' − ' + AS_H8(cur.addr + 4) + ' = ' + (cur.imm16 - (cur.addr + 4)) +
            '（即 0x' + AS_H4((cur.imm16 - (cur.addr + 4)) & 0xFFFF) + '）。</div>'
          : '');
    } else {
      strip = '<span style="color:#94a3b8;font:600 12px Consolas,monospace">（本帧没有正在执行的指令）</span>';
    }

    /* ---------- 卡片 4：寄存器与标志位 ---------- */
    const regCell = i => {
      const hot = s.chRegs.indexOf(i) >= 0;
      const isSp = i === 6 || i === 7;
      return `<div class="as-reg${hot ? ' cur' : ''}" data-reg="${AS_REGS[i]}" style="width:104px;border:1.5px solid ${hot ? '#6366f1' : (isSp ? '#cbd5e1' : '#e2e8f0')};background:${hot ? '#eef2ff' : '#ffffff'};border-radius:6px;padding:2px 6px;box-sizing:border-box;font:600 11px Consolas,monospace">
        <div style="color:#94a3b8">${AS_REGS[i]}</div><div style="color:${hot ? '#3730a3' : '#0f172a'}">${AS_H8(s.regs[i])}</div></div>`;
    };
    const flagCell = (k, meaning) => {
      const on = s.flags[k] === 1;
      return `<div class="as-flag${on ? ' on' : ''}" data-flag="${k}" style="width:96px;border:1.5px solid ${on ? '#f59e0b' : '#e2e8f0'};background:${on ? '#fffbeb' : '#ffffff'};border-radius:6px;padding:2px 6px;box-sizing:border-box;font:600 11px Consolas,monospace">
        <div style="color:#94a3b8">${k}</div><div style="color:${on ? '#b45309' : '#0f172a'}">${on ? 1 : 0}</div>
        <div style="color:#94a3b8;font-weight:400;white-space:nowrap">${meaning}</div></div>`;
    };

    /* ---------- 卡片 5：内存窗口 ---------- */
    const memCells = [];
    for (let i = 0; i < AS_MEMN; i++) {
      const a = AS_MEM0 + 4 * i;
      const hot = s.chMem.indexOf(i) >= 0;
      const isStack = a >= 0x120;
      const tag = AS_DATA_TAG[a] || (isStack ? '栈' : '');
      const isSp = s.regs[6] === a, isBp = s.regs[7] === a;
      const mark = (isSp ? '<span style="color:#dc2626">esp</span> ' : '') + (isBp ? '<span style="color:#7c3aed">ebp</span>' : '');
      memCells.push(`<div class="as-mem${hot ? ' cur' : ''}" data-addr="${AS_H8(a)}" data-tag="${esc(tag)}" style="width:120px;border:1.5px solid ${hot ? '#6366f1' : '#e2e8f0'};background:${hot ? '#eef2ff' : (isStack ? '#f8fafc' : '#ffffff')};border-radius:6px;padding:2px 6px;box-sizing:border-box;font:600 11px Consolas,monospace">
        <div style="display:flex;justify-content:space-between;color:#94a3b8"><span>${AS_H8(a)}</span><span style="font-weight:700;color:#64748b">${esc(tag)}</span></div>
        <div style="color:${hot ? '#3730a3' : '#0f172a'}">${AS_H8(s.mem[i])}</div>
        <div style="height:13px;font-weight:400">${mark}</div></div>`);
    }
    const memRows = [];
    for (let r = 0; r < 4; r++) memRows.push('<div class="as-mem-row" style="display:flex;gap:6px">' + memCells.slice(r * 4, r * 4 + 4).join('') + '</div>');

    /* ---------- 栈帧速览（只有"函数调用"片段显示；这是真题最爱考的一张表） ---------- */
    let frameBox = '';
    if (M.pid === 'call') {
      const readSlot = a => {
        const d = a - AS_MEM0;
        return (d >= 0 && d % 4 === 0 && a <= AS_MEM0 + 4 * (AS_MEMN - 1)) ? AS_H8(s.mem[d / 4]) : '（不在窗口内）';
      };
      const ebp = s.regs[7];
      const SLOTS = [
        [-4, '局部变量 z', '在 ebp 之下（负位移）'],
        [0, '调用者保存的 ebp', 'push ebp 压入'],
        [4, '返回地址', 'call 压入 —— 与 jmp 的唯一区别'],
        [8, '第 1 个实参 P', '实参从右向左入栈 ⟹ P 在低地址'],
        [12, '第 2 个实参 Q', '先入栈的反而在高地址'],
      ];
      /* ⚠ 只有 ebp 已经不是调用者初值时，"ebp 为基址"的这张表才说得通（窗29 实测：末帧 ebp 已
         恢复成 0x140，若照旧渲染这张表，会把主程序的栈顶当成 f 的栈帧，属**语义类**缺陷）。 */
      frameBox = ebp === M.regs0[7]
        ? '<div class="as-frame as-frame-idle" style="flex:1 1 330px;min-width:300px;font:400 12px system-ui;color:#64748b;padding:6px 8px;background:#f8fafc;border-radius:6px">' +
          '栈帧速览：<b>当前还没有进入 f 的栈帧</b>（ebp 仍是调用者的初值 <b style="font-family:Consolas,monospace">' + AS_H8(ebp) + '</b>）。' +
          '执行到 f 的 <b>push ebp</b> / <b>mov ebp, esp</b> 之后，这里会实时列出 [ebp−4] 局部变量、[ebp] 保存的 ebp、' +
          '[ebp+4] <b>返回地址</b>、[ebp+8] / [ebp+12] 两个实参。</div>'
        : '<div class="as-frame" style="flex:1 1 330px;min-width:300px">' +
          '<div style="font:600 12px system-ui;color:#475569;margin-bottom:4px">栈帧速览（ebp = <b style="font-family:Consolas,monospace">' + AS_H8(ebp) + '</b>，栈向低地址增长）：</div>' +
          SLOTS.map(([off, what, why]) => {
            const a = (ebp + off) | 0;
            const isRet = off === 4;
            return '<div class="as-frame-row" data-off="' + off + '" style="display:flex;gap:8px;align-items:baseline;padding:1px 6px;border-radius:6px;box-sizing:border-box;font:600 11px Consolas,monospace;background:' + (isRet ? '#fffbeb' : 'transparent') + '">' +
              '<span style="color:#7c3aed;width:118px">[ebp' + (off >= 0 ? '+' + off : off) + ']</span>' +
              '<span style="color:#94a3b8;width:78px">' + AS_H8(a) + '</span>' +
              '<span style="color:' + (isRet ? '#b45309' : '#0f172a') + '">' + readSlot(a) + '</span>' +
              '<span style="color:#64748b;font-weight:400">' + what + ' —— ' + why + '</span></div>';
          }).join('') + '</div>';
    }

    stage.innerHTML = `
      <div class="space-y-4">
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('① 高级语言 ↔ 汇编 ↔ 机器码（左 = C 源码；右 = 地址 / 机器码 / 汇编 / 对应 C 行）')}
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
            <div class="as-col-c" style="flex:0 1 268px;min-width:238px;display:flex;flex-direction:column;gap:2px">${cCol}</div>
            <div class="as-col-asm" style="flex:1 1 520px;min-width:470px;display:flex;flex-direction:column;gap:2px">${asmRows}</div>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('② 当前指令的机器码字段划分（32 位 = 5 + 4 + 4 + 3 + 16）')}
          <div class="as-strip" style="display:flex;flex-wrap:wrap;gap:0;font-family:Consolas,monospace;background:#f8fafc;border-radius:6px;padding:4px 6px;margin-bottom:6px">${strip}</div>
          ${cur ? `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">
            <div style="flex:1 1 430px;min-width:360px"><table style="width:100%;border-collapse:collapse;font:400 12px system-ui">${fldTable}</table></div>
            <div style="flex:1 1 300px;min-width:280px;display:flex;flex-direction:column;gap:6px">${eaTxt}
              <div class="as-sem" style="font:400 12px system-ui;color:#475569;padding:4px 8px;background:#f8fafc;border-radius:6px">指令语义：${esc(AS_OPC[cur.op].desc)}</div>
            </div></div>` : ''}
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('③ 寄存器（蓝框 = 本帧刚被改写）与标志位（橙 = 该位为 1）')}
          <div class="as-reg-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">${AS_REGS.map((_, i) => regCell(i)).join('')}</div>
          <div class="as-flag-row" style="display:flex;flex-wrap:wrap;gap:6px;align-items:stretch">
            ${flagCell('ZF', '结果为 0')}${flagCell('SF', '结果符号')}${flagCell('OF', '有符号溢出')}${flagCell('CF', '进位/借位')}
            <div style="flex:1 1 300px;min-width:240px;font:400 12px system-ui;color:#475569;padding:4px 8px;background:#f8fafc;border-radius:6px">
              eip = <b style="font-family:Consolas,monospace">${s.kind === 'exec' ? AS_H8(s.nextEip) : (s.kind === 'init' ? AS_H8(M.entry) : '已停机')}</b>；
              esp = <b style="font-family:Consolas,monospace">${AS_H8(s.regs[6])}</b>，ebp = <b style="font-family:Consolas,monospace">${AS_H8(s.regs[7])}</b>。
              栈从 0x0140 向低地址增长。</div>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('④ 内存窗口（0x0100~0x011C 数据段：a[0..3] / x / y / m / r；0x0120~0x013C 栈段）')}
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
            <div class="as-mem-grid" style="display:flex;flex-direction:column;gap:6px">${memRows.join('')}</div>
            ${frameBox}
          </div>
        </div>
      </div>`;
  },
});
