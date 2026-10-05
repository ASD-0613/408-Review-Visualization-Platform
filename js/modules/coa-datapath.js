'use strict';
/* ============================================================================
 * coa-datapath.js —— 【计算机组成原理】数据通路与指令执行（单总线 CPU 逐拍微操作）（前缀 _dp）
 * 模式：stepper（一拍一帧；首帧 init、末帧 done）
 *
 * 考情（**窗27 从零核定**：子代理只读 考情缓存/、主线程逐条复核证据行，依据行号见下）：
 *   · 18 年中 **11 年**考过，共 **13 题 = 选 8 + 大题 5**（题号级：2010 与 2021 各两个题号）。
 *   · 大题 5 道 —— "给出数据通路与控制信号，求某拍的有效控制信号 / 某控制信号的取值"是本考点主考形式：
 *     2009-44（取指、译码阶段每个节拍的功能与有效控制信号；2009_解析.txt:463-465 与 490-520）、
 *     2015-43（单总线结构下为什么必须设暂存器 T；2015_解析.txt:468-473）、
 *     2022-43（单总线数据通路为何需要暂存器 Y / Z + 取指阶段控制信号序列；2022_解析.txt:385-398）、
 *     2024-43（题给数据通路与控制信号，求 ALUBsrc / Ext / ALUctr 的取值；2024_真题.txt:614-625）、
 *     2026-44（数据通路部件、EX1OP 扩展控制信号位数、取指周期控制信号；2026_解析.txt:777-809）。
 *     ⚠ 2009-44 与 2024-43 **在别的条目里也登记着**（前者 coa-baseconv、后者 coa-fixadd 与
 *     coa-inst-format）——按 §2.0① "大题可对应多个知识点"各自登记，不是重复。
 *   · 选择题 5 道：2010-12（数据通路的功能、"优化数据通路结构 ⇒ 提高吞吐量/主频"，2010_解析.txt:175-182）、
 *     2016-20（单总线结构数据通路与单周期处理器，2016_解析.txt:305-309）、
 *     2017-19（指令流水线数据通路包含哪些部件、**不含**控制部件，2017_真题.txt:427-429）、
 *     2019-17（取数及执行过程中用到哪些部件，2019_真题.txt:130-131）、
 *     2020-12（机器字长 = CPU 内部用于整数运算的数据通路的宽度，2020_解析.txt:183-185）。
 *   · **不登记（看着像但按 §2.0② 归更"专"的那个模块）**：2009-17 / 2025-17（RISC 用硬布线 → coa-cisc-risc）、
 *     2009-19 / 2012-18 / 2014-18 / 2017-18（微程序控制器与下地址字段 → coa-microprog）、
 *     2017-20（多总线结构 → coa-bus）、2025-16（ISA 与微架构之分 → coa-hierarchy）、
 *     2024-19（五段流水线的数据冒险 → coa-pipeline）、2026-20（CPI 关系 → coa-perf）、
 *     2021-43（MAR/MDR/IR 位宽 → coa-mainmem 等已登记；且 2021 解析为空文本层、错页，无法复核）。
 *   · **无法核对（不猜，留白）**：2023 整年真题文本层乱码（CJK 仅 14 字）、解析为空 ⟹ 该年有无本考点不可判。
 *
 * 数据模型（字长 16 位、地址 16 位；口径写死在代码里，避免后来者改错）：
 *   · 部件：PC / MAR / MDR / IR / 通用寄存器 R0~R3 / 暂存器 Y、Z / ALU / 主存 M（每字 16 位）。
 *   · 指令字 16 位 = 操作码 4 位 ‖ R_d 2 位 ‖ R_s 2 位 ‖ imm8 8 位（imm8 **只有**立即数与转移指令用）。
 *   · 主存窗口 = 0x0010 ~ 0x001F（16 个字，演示只用这一页）。**0x0010 放当前指令字**（取指阶段自动写入，
 *     用户不许覆盖）；PC 初值 = 0x0010，取指第 3 拍 PC + 1 ⇒ 0x0011。
 *   · 立即数 / 转移目标一律是 **8 位字段**，经扩展器 Ext 变成 16 位后才送 ALU / PC：
 *     Ext = 1 符号扩展（imm8 = F6 ⇒ FFF6 = −10）、Ext = 0 零扩展（F6 ⇒ 00F6 = 246）。
 *
 * 不变量（冒烟断言的对象，§3.8-1 "只写不变量"）：
 *   ① 首帧 init / 末帧 done；其余每帧恰好推进**一条**微操作；
 *   ② **单总线铁律**：每一拍**至多一个**部件驱动总线（micro.out 至多 1 项）——这是本考点最爱考的一条；
 *   ③ 每帧的寄存器组 / 主存 / 微操作表都是**全量深拷贝**（改第 k 帧不许污染第 k+1 帧，§1.3）；
 *   ④ 取指 3 拍的微操作序列对所有指令**完全一样**；PC 每帧至多 +1；
 *   ⑤ 各指令总拍数固定：add R,R = 6 拍、add R,(R) = 8 拍、add R,#imm = 6 拍、lw = 6 拍、sw = 6 拍、jmp = 4 拍；
 *   ⑥ 末帧结果必须等于**独立参考实现**（十进制/整数口径另算一遍）的结果。
 * ========================================================================== */

/* 主存窗口起址（buildSnapshots 与 render 共用；写成常量避免两处漂移） */
const DP_WIN0 = 0x10;

RC408.registerModule({
  id: 'coa-datapath',
  mode: 'stepper',
  title: '数据通路与指令执行（单总线 CPU 逐拍微操作）',

  theory: `
> **为什么要有它**：CPU 内部所有部件都挂在内部总线上，指令之所以能执行，就是控制器按拍发出一串**微操作**——搞清"每一拍**谁**把数据送上总线、**谁**接收"，才能回答真题里"给出数据通路与控制信号，求某拍的有效控制信号 / 某控制信号的取值"这一类大题。
> **怎么实现**：把指令周期拆成**取指 3 拍 + 执行若干拍**；单总线**每拍只允许一个部件输出**（所以 ALU 的两个输入必须先用暂存器 Y 缓存一个、结果先用 Z 缓存）；指令里的 8 位立即数 / 偏移必须经**扩展器 Ext** 变成 16 位才能送 ALU 或 PC。
> **记住什么**：**取指 3 拍（PC→MAR、M→MDR、MDR→IR 且 PC+1）** + **单总线一拍一个输出** + **Ext：符号扩展还是零扩展** + 控制信号命名法 Xout / Xin。

## 一、部件与内部总线
| 部件 | 作用 |
| --- | --- |
| PC | 程序计数器，存放**下一条**要取的指令地址 |
| MAR / MDR | 地址寄存器 / 数据寄存器，CPU 与主存之间唯一的进出口 |
| IR | 指令寄存器，存放**当前**指令字（操作码 + 寄存器号 + imm8） |
| R0 ~ R3 | 通用寄存器组，程序员可见 |
| Y / Z | 暂存器，**只对控制器可见**：Y 缓存 ALU 的一个输入、Z 缓存 ALU 的输出 |
| ALU | 算术逻辑部件，本演示只做 16 位加法 |

## 二、取指阶段：3 拍，所有指令公共
| 拍 | 微操作 | 有效控制信号 |
| --- | --- | --- |
| T1 | (PC) → MAR | PCout, MARin |
| T2 | M(MAR) → MDR | MemR, MDRin |
| T3 | (MDR) → IR，(PC) + 1 → PC | MDRout, IRin, PC+1, PCin |

**为什么 T3 能同时做两件事**：PC 加 1 由**独立增量器**完成、结果直接回送 PC，**不占用内部总线**——总线那一拍只服务 MDR → IR。这条是 2009-44 的判据。

## 三、执行阶段：为什么必须有 Y 和 Z（2015-43 / 2022-43 的核心）
单总线**一拍只能有一个部件输出**，所以 ALU 的两个输入不可能同拍送上总线：
1. 先把一个操作数从寄存器送上总线、存入**暂存器 Y**（此时 Y 的输入不受总线限制）；
2. 下一拍让另一个操作数上总线，与 Y 一起进 ALU 运算，结果先存**暂存器 Z**；
3. 再下一拍把 Z 送回目的寄存器。
**没有 Y / Z，ALU 的 A、B 两端会同时拿到同一份数据（都来自总线），数据通路根本不能工作**——2015-43 问的正是这一点。

## 四、立即数与转移目标：扩展器 Ext
指令里的 imm8 只有 8 位，而 ALU / PC 是 16 位，必须扩展：
- **Ext = 1 符号扩展**：imm8 = F6（−10）⇒ FFF6（−10）；
- **Ext = 0 零扩展**：imm8 = F6 ⇒ 00F6（246 = +246）。
- 有符号的数据（add 的立即数、分支偏移）**必须**符号扩展；**无符号**的量（逻辑左移的移位量）两种扩展结果相同，取 0 取 1 都对——2024-43 第 3 问考的就是"为什么 slli 的 Ext 取 0 取 1 都可以"。2026-44 把这条控制信号叫 **EX1OP**，并问它至少要几位。
- 扩展器的输出**直接送 ALU 的 B 端 / PC**，**不经过内部总线**。

## 五、控制信号命名法（2009-44 / 2024-43 的通用判据）
- **Xout**：部件 X 把内容送到总线（一拍只能有一个 Xout）；
- **Xin**：部件 X 从总线接收（可以有多个）；
- 特殊信号：**MemR / MemW**（主存读 / 写）、**ALUop**（ALU 运算种类）、**Ext / EX1OP**（扩展方式）、**PC+1**（增量器）。
- 注：本演示的指令一律**单字长 16 位**，故取指恒为 3 拍；若指令变长，取指要按"每字一拍"增加。

## 考点提醒（易错点）
1. **单总线铁律**：任意一拍只能有一个部件输出到总线。**某拍出现两个 Xout，该拍一定是错的**（2022-43 就是靠这条判的）。
2. **PC + 1 不是总线操作**：它由独立增量器完成，因此能与"总线上的一步"同拍完成；把它算成第二个 Xout 是最常见的错答。
3. **Y / Z 的存在理由**要能说出：Y 缓存 ALU 的一个输入、Z 缓存 ALU 的输出，**都是为了绕开"一拍一个输出"**。
4. **Ext 取值看数据含义**：符号数必须符号扩展；无符号量（如移位量）两种扩展结果相同，故 Ext 取 0 或 1 都可（2024-43）。
5. **数据通路不含控制部件**：生成控制信号的控制部件**不属于**数据通路（2017-19）。
6. 概念题：**机器字长 = CPU 内部用于整数运算的数据通路的宽度**（2020-12）；**优化数据通路结构**能缩短时钟周期、提高主频与吞吐量（2010-12）。
7. 本演示的字长是 16 位、主存只有一页 16 个字，所以地址与数据都用 4 位十六进制书写；真题里的位宽按题目给定。

> **真题考情**：**11/18 年（选 8 + 大题 5）**：大 2009-44（取指/译码各拍微操作与有效控制信号）、2015-43（单总线为何必须设暂存器）、2022-43（暂存器 Y/Z + 取指控制信号序列）、2024-43（ALUBsrc / Ext / ALUctr 取值）、2026-44（数据通路部件与 EX1OP 位数）；选 2010-12·18、2016-20、2017-19、2019-17、2020-12、2021-17·18。
`,

  inputs: [
    {
      key: 'inst', label: '指令', type: 'select', default: 'add_ri', wide: true,
      options: [
        { v: 'add_rr', t: 'add Rd, Rs —— 寄存器寻址：Rd ← Rd + Rs' },
        { v: 'add_ri', t: 'add Rd, (Rs) —— 寄存器间接：Rd ← Rd + M[Rs]' },
        { v: 'add_imm', t: 'add Rd, #imm8 —— 立即数：Rd ← Rd + Ext(imm8)（考 Ext 取值）' },
        { v: 'lw', t: 'lw Rd, (Rs) —— 取数：Rd ← M[Rs]' },
        { v: 'sw', t: 'sw Rd, (Rs) —— 存数：M[Rs] ← Rd' },
        { v: 'jmp', t: 'jmp #imm8 —— 转移：PC ← Ext(imm8)' },
      ],
    },
    {
      key: 'rd', label: 'Rd（目的寄存器）', type: 'select', default: 'R1',
      options: [{ v: 'R0', t: 'R0' }, { v: 'R1', t: 'R1' }, { v: 'R2', t: 'R2' }, { v: 'R3', t: 'R3' }],
    },
    {
      key: 'rs', label: 'Rs（源寄存器 / 地址寄存器）', type: 'select', default: 'R2',
      options: [{ v: 'R0', t: 'R0' }, { v: 'R1', t: 'R1' }, { v: 'R2', t: 'R2' }, { v: 'R3', t: 'R3' }],
    },
    {
      key: 'imm', label: 'imm8（立即数 / 转移目标，2 位十六进制）', type: 'text', default: 'F6',
      help: '8 位字段：F6 当符号扩展是 −10（FFF6）、当零扩展是 +246（00F6）；只有 add Rd,#imm8 与 jmp 会用到它',
    },
    {
      key: 'ext', label: 'Ext（扩展方式，只对立即数 / 转移有意义）', type: 'select', default: '1',
      options: [{ v: '1', t: 'Ext = 1：符号扩展（有符号数必须选它）' }, { v: '0', t: 'Ext = 0：零扩展' }],
    },
    {
      key: 'regs', label: '通用寄存器初值（4 行，每行 4 位十六进制：R0 R1 R2 R3）', type: 'textarea', rows: 4, wide: true,
      default: '0000\n0010\n0014\n0002',
      help: '字长 16 位。注意 R2 = 0014 是"地址"，它必须落在主存窗口 0010~001F 内',
    },
    {
      key: 'mem', label: '主存初值（每行"地址=值"，均十六进制 4 位；窗口 0010~001F）', type: 'textarea', rows: 3, wide: true,
      default: '0014=0006',
      help: '0010 单元由取指阶段自动写入"当前指令字"，不许在这里填；未列出的单元初值为 0000',
    },
  ],

  quickActions: [
    { label: '📘 教材例：add R1, (R2)（寄存器间接，8 拍）', run(rt) { rt.setInput('inst', 'add_ri'); rt.setInput('rd', 'R1'); rt.setInput('rs', 'R2'); rt.load(); } },
    { label: '🎯 2022-43 同款：add R1, R2（看暂存器 Y / Z 为什么必需）', run(rt) { rt.setInput('inst', 'add_rr'); rt.setInput('rd', 'R1'); rt.setInput('rs', 'R2'); rt.load(); } },
    { label: '🎯 2024-43 同款①：add R1, #F6 且 Ext = 1（符号扩展 ⇒ FFF6）', run(rt) { rt.setInput('inst', 'add_imm'); rt.setInput('rd', 'R1'); rt.setInput('imm', 'F6'); rt.setInput('ext', '1'); rt.load(); } },
    { label: '🎯 2024-43 同款②：同一条指令改成 Ext = 0（零扩展 ⇒ 00F6，结果不同）', run(rt) { rt.setInput('inst', 'add_imm'); rt.setInput('rd', 'R1'); rt.setInput('imm', 'F6'); rt.setInput('ext', '0'); rt.load(); } },
    { label: '🎯 2026-44 同款：取指周期 3 拍的控制信号序列', run(rt) { rt.setInput('inst', 'add_imm'); rt.setInput('rd', 'R1'); rt.setInput('imm', 'F6'); rt.setInput('ext', '1'); rt.load(); } },
    { label: '📘 lw R1, (R2)：取数（MDR 经总线进 Rd）', run(rt) { rt.setInput('inst', 'lw'); rt.setInput('rd', 'R1'); rt.setInput('rs', 'R2'); rt.load(); } },
    { label: '📘 sw R1, (R2)：存数（MemW：总线 → 主存）', run(rt) { rt.setInput('inst', 'sw'); rt.setInput('rd', 'R1'); rt.setInput('rs', 'R2'); rt.load(); } },
    { label: '📘 jmp #0012：转移（Ext 结果直接送 PC，不占总线）', run(rt) { rt.setInput('inst', 'jmp'); rt.setInput('imm', '12'); rt.setInput('ext', '0'); rt.load(); } },
  ],

  parse(vals) {
    const hxRe = /^[0-9a-fA-F]{1,4}$/;
    const hx4 = v => v.toString(16).toUpperCase().padStart(4, '0');
    const hex = (s, name, max) => {
      const v = String(s == null ? '' : s).trim().replace(/^0[xX]/, '');
      if (!hxRe.test(v)) throw { message: `${name}「${s}」不是十六进制数（1~4 位）` };
      const n = parseInt(v, 16);
      if (n > max) throw { message: `${name} 超出范围（最大 ${hx4(max)}）` };
      return n;
    };

    const inst = ['add_rr', 'add_ri', 'add_imm', 'lw', 'sw', 'jmp'].indexOf(vals.inst) >= 0 ? vals.inst : 'add_ri';
    const regIdx = s => { const m = /^R([0-3])$/.exec(String(s || '')); return m ? +m[1] : 0; };
    const rd = regIdx(vals.rd), rs = regIdx(vals.rs);

    const immRaw = String(vals.imm == null ? '' : vals.imm).trim().replace(/^0[xX]/, '');
    if (!/^[0-9a-fA-F]{1,2}$/.test(immRaw)) throw { message: `imm8「${vals.imm}」必须是 1~2 位十六进制（8 位字段）` };
    const imm8 = parseInt(immRaw, 16);
    const ext = String(vals.ext) === '0' ? 0 : 1;

    /* 通用寄存器：必须 4 行 */
    const rl = String(vals.regs == null ? '' : vals.regs).split('\n').map(s => s.trim()).filter(Boolean);
    if (rl.length !== 4) throw { message: `通用寄存器要 4 行（R0~R3 各一行），现在给了 ${rl.length} 行` };
    const regs = rl.map((s, i) => hex(s, `R${i}`, 0xFFFF));

    /* 主存：addr=value；窗口 0010~001F；0010 是当前指令字，不许覆盖 */
    const mem = [];
    for (let i = 0; i < 16; i++) mem.push(0);
    String(vals.mem == null ? '' : vals.mem).split('\n').map(s => s.trim()).filter(Boolean).forEach(line => {
      const mm = /^([0-9a-fA-F]{1,4})\s*[=:]\s*([0-9a-fA-F]{1,4})$/.exec(line);
      if (!mm) throw { message: `主存行「${line}」格式应为"地址=值"（均十六进制 4 位），如 0014=0006` };
      const a = parseInt(mm[1], 16), v = parseInt(mm[2], 16);
      if (a < 0x10 || a > 0x1F) throw { message: `主存地址 ${hx4(a)} 越界：本演示的窗口是 0010~001F` };
      if (a === 0x10) throw { message: '0010 单元放的是当前指令字，由取指阶段自动写入，请不要在"主存初值"里填它' };
      mem[a - 0x10] = v;
    });

    /* 三条会访存的指令：Rs 必须指向主存窗口内的单元（否则演示画不出来） */
    if (inst === 'add_ri' || inst === 'lw' || inst === 'sw') {
      const a = regs[rs];
      if (a < 0x10 || a > 0x1F) {
        throw { message: `${inst === 'sw' ? 'sw' : inst} 要用 R${rs} 当地址，而 R${rs} = ${hx4(a)} 不在主存窗口 0010~001F 内：请改 R${rs} 的初值` };
      }
      if (inst === 'sw' && a === 0x10) {
        throw { message: 'sw 的地址不能是 0010：那个单元存的是当前指令字，写它就等于把正在执行的指令改掉了' };
      }
    }

    /* 指令字 16 位 = 操作码 4 位 ‖ Rd 2 位 ‖ Rs 2 位 ‖ imm8 8 位 */
    const OP = { add_rr: 1, add_ri: 2, add_imm: 3, lw: 4, sw: 5, jmp: 6 };
    const code = ((OP[inst] << 12) | (rd << 10) | (rs << 8) | imm8) & 0xFFFF;
    /* 指令字真的写进 0x0010：取指第 2 拍读的就是它，记忆与画面才对得上（不变量：mem[0] === code） */
    mem[0] = code;
    const LABEL = {
      add_rr: (d, s) => `add R${d}, R${s}`,
      add_ri: (d, s) => `add R${d}, (R${s})`,
      add_imm: d => `add R${d}, #${immRaw.toUpperCase()}`,
      lw: (d, s) => `lw R${d}, (R${s})`,
      sw: (d, s) => `sw R${d}, (R${s})`,
      jmp: () => `jmp #${immRaw.toUpperCase()}`,
    };
    const immExt = ext ? (imm8 >= 0x80 ? imm8 - 0x100 : imm8) & 0xFFFF : imm8 & 0xFFFF;

    /* 地址（只有用得到时才有意义） */
    const addr = regs[rs];
    return {
      inst, rd, rs, imm8, immExt, ext, regs, mem, code, addr,
      pc: 0x0010,
      label: LABEL[inst](rd, rs),
      hx: hx4,
      kind: 'ok', err: '',
    };
  },

  buildSnapshots(model) {
    const m = model, H = m.hx;
    const TOTAL = { add_rr: 6, add_ri: 8, add_imm: 6, lw: 6, sw: 6, jmp: 4 }[m.inst];
    const WIN = DP_WIN0, WN = 16;

    /* 逐拍执行；每拍只做一件事，且"谁驱动总线"至多一个（不变量②） */
    const st = { pc: m.pc, mar: 0, mdr: 0, ir: 0, y: 0, z: 0, alu: null, regs: m.regs.slice(), mem: m.mem.slice() };
    const memAt = a => (a >= WIN && a < WIN + WN) ? st.mem[a - WIN] : 0;
    const wMem = (a, v) => { st.mem[a - WIN] = v & 0xFFFF; };

    const steps = [];
    const S = o => steps.push(o);

    /* ---------- 取指阶段 3 拍（所有指令公共，不变量④） ---------- */
    S({
      t: 'T1', micro: '(PC) → MAR', sigs: ['PCout', 'MARin'], out: 'PC', ins: ['MAR'],
      note: '只有 PC 在输出',
      run() { st.mar = st.pc; },
      say() { return `取指第 1 拍：PC = ${H(st.pc)} 送上单总线 → MAR ← ${H(st.mar)}。控制信号只有 PCout 与 MARin。`; },
      log() { return `T1 (PC) → MAR：MAR ← ${H(st.mar)}`; },
    });
    S({
      t: 'T2', micro: 'M(MAR) → MDR', sigs: ['MemR', 'MDRin'], out: 'M', ins: ['MDR'],
      note: '读主存（指令字）',
      run() { st.mdr = memAt(st.mar); },
      say() { return `取指第 2 拍：按 MAR = ${H(st.mar)} 读主存，读出**指令字** ${H(st.mdr)} → MDR。控制信号 MemR、MDRin（本拍由主存驱动总线）。`; },
      log() { return `T2 M(MAR) → MDR：MDR ← ${H(st.mdr)}（指令字）`; },
    });
    S({
      t: 'T3', micro: '(MDR) → IR，(PC) + 1 → PC', sigs: ['MDRout', 'IRin', 'PC+1', 'PCin'], out: 'MDR', ins: ['IR'],
      note: 'PC+1 走独立增量器，不占总线',
      run() { st.ir = st.mdr; st.pc = (st.pc + 1) & 0xFFFF; },
      say() { return `取指第 3 拍：MDR → IR（IR ← ${H(st.ir)}），同时 (PC) + 1 → PC（PC ← ${H(st.pc)}）。**PC + 1 由独立增量器完成、不占内部总线**，所以能与总线上的一步同拍。`; },
      log() { return `T3 (MDR) → IR 且 (PC)+1 → PC：IR ← ${H(st.ir)}，PC ← ${H(st.pc)}`; },
    });

    /* ---------- 执行阶段（按指令展开） ---------- */
    const Rd = `R${m.rd}`, Rs = `R${m.rs}`;
    if (m.inst === 'add_rr') {
      S({ t: 'T4', micro: `(${Rd}) → Y`, sigs: [`${Rd}out`, 'Yin'], out: Rd, ins: ['Y'], note: '先缓存一个操作数',
        run() { st.y = st.regs[m.rd]; },
        say() { return `执行第 1 拍：${Rd} = ${H(st.y)} 送上总线 → Y。**单总线一拍只能一个输出**，所以先把一个加数存进 Y。`; },
        log() { return `T4 (${Rd}) → Y：Y ← ${H(st.y)}`; } });
      S({ t: 'T5', micro: `(Y) + (${Rs}) → Z`, sigs: [`${Rs}out`, 'ALUop=ADD', 'Zin'], out: Rs, ins: ['Z'], note: 'ALU 结果先入 Z',
        run() { st.alu = { a: st.y, b: st.regs[m.rs], op: 'ADD', r: (st.y + st.regs[m.rs]) & 0xFFFF }; st.z = st.alu.r; },
        say() { return `执行第 2 拍：${Rs} = ${H(st.alu.b)} 上总线，与 Y 里的 ${H(st.alu.a)} 一起进 ALU 做加法，和 ${H(st.z)} 先存入 Z。`; },
        log() { return `T5 (Y) + (${Rs}) → Z：${H(st.alu.a)} + ${H(st.alu.b)} = ${H(st.z)}`; } });
      S({ t: 'T6', micro: `(Z) → ${Rd}`, sigs: ['Zout', `${Rd}in`], out: 'Z', ins: [Rd], note: '写回目的寄存器',
        run() { st.regs[m.rd] = st.z; },
        say() { return `执行第 3 拍：Z = ${H(st.z)} 经总线写回 ${Rd}，一条 add 寄存器指令共 6 拍完成。`; },
        log() { return `T6 (Z) → ${Rd}：${Rd} ← ${H(st.regs[m.rd])}`; } });
    } else if (m.inst === 'add_ri') {
      S({ t: 'T4', micro: `(${Rs}) → MAR`, sigs: [`${Rs}out`, 'MARin'], out: Rs, ins: ['MAR'], note: '寄存器间接：先取有效地址',
        run() { st.mar = st.regs[m.rs]; },
        say() { return `执行第 1 拍：${Rs} = ${H(st.mar)} 作为**有效地址**送上总线 → MAR（寄存器间接寻址）。`; },
        log() { return `T4 (${Rs}) → MAR：MAR ← ${H(st.mar)}`; } });
      S({ t: 'T5', micro: 'M(MAR) → MDR', sigs: ['MemR', 'MDRin'], out: 'M', ins: ['MDR'], note: '读操作数',
        run() { st.mdr = memAt(st.mar); },
        say() { return `执行第 2 拍：读 M[${H(st.mar)}] = ${H(st.mdr)} → MDR。`; },
        log() { return `T5 M(MAR) → MDR：MDR ← M[${H(st.mar)}] = ${H(st.mdr)}`; } });
      S({ t: 'T6', micro: `(${Rd}) → Y`, sigs: [`${Rd}out`, 'Yin'], out: Rd, ins: ['Y'], note: '缓存被加数',
        run() { st.y = st.regs[m.rd]; },
        say() { return `执行第 3 拍：${Rd} = ${H(st.y)} 送上总线 → Y（同 add R,R：先缓存一个加数）。`; },
        log() { return `T6 (${Rd}) → Y：Y ← ${H(st.y)}`; } });
      S({ t: 'T7', micro: '(Y) + (MDR) → Z', sigs: ['MDRout', 'ALUop=ADD', 'Zin'], out: 'MDR', ins: ['Z'], note: '操作数来自 MDR',
        run() { st.alu = { a: st.y, b: st.mdr, op: 'ADD', r: (st.y + st.mdr) & 0xFFFF }; st.z = st.alu.r; },
        say() { return `执行第 4 拍：MDR = ${H(st.alu.b)} 上总线，与 Y 里的 ${H(st.alu.a)} 相加得 ${H(st.z)} → Z。`; },
        log() { return `T7 (Y) + (MDR) → Z：${H(st.alu.a)} + ${H(st.alu.b)} = ${H(st.z)}`; } });
      S({ t: 'T8', micro: `(Z) → ${Rd}`, sigs: ['Zout', `${Rd}in`], out: 'Z', ins: [Rd], note: '写回',
        run() { st.regs[m.rd] = st.z; },
        say() { return `执行第 5 拍：Z → ${Rd}，寄存器间接的 add 共 8 拍（比 add R,R 多 2 拍：多了一次访存与一次取有效地址）。`; },
        log() { return `T8 (Z) → ${Rd}：${Rd} ← ${H(st.regs[m.rd])}`; } });
    } else if (m.inst === 'add_imm') {
      S({ t: 'T4', micro: `(${Rd}) → Y`, sigs: [`${Rd}out`, 'Yin'], out: Rd, ins: ['Y'], note: '缓存被加数',
        run() { st.y = st.regs[m.rd]; },
        say() { return `执行第 1 拍：${Rd} = ${H(st.y)} 送上总线 → Y。`; },
        log() { return `T4 (${Rd}) → Y：Y ← ${H(st.y)}`; } });
      S({ t: 'T5', micro: `Ext(IR[7:0]) + (Y) → Z`, sigs: [m.ext ? 'Ext=1（符号扩展）' : 'Ext=0（零扩展）', 'ALUop=ADD', 'Zin'], out: null, ins: ['Z'],
        note: '扩展器输出直送 ALU，不占总线',
        run() { st.alu = { a: st.y, b: m.immExt, op: 'ADD', r: (st.y + m.immExt) & 0xFFFF }; st.z = st.alu.r; },
        say() { return `执行第 2 拍：IR 低 8 位 = ${H(m.imm8).slice(2)} 经扩展器（Ext = ${m.ext}：${m.ext ? '符号扩展' : '零扩展'}）变成 ${H(m.immExt)}，与 Y 里的 ${H(st.y)} 相加得 ${H(st.z)} → Z。**扩展器的输出直接进 ALU，不经过内部总线**，所以本拍总线上没有部件在驱动。`; },
        log() { return `T5 Ext(${H(m.imm8).slice(2)}) = ${H(m.immExt)}（Ext=${m.ext}）；${H(st.alu.a)} + ${H(st.alu.b)} = ${H(st.z)} → Z`; } });
      S({ t: 'T6', micro: `(Z) → ${Rd}`, sigs: ['Zout', `${Rd}in`], out: 'Z', ins: [Rd], note: '写回',
        run() { st.regs[m.rd] = st.z; },
        say() { return `执行第 3 拍：Z → ${Rd}。把 Ext 改成 0 再看一遍，结果会不一样——这就是 2024-43 求 Ext 取值的道理。`; },
        log() { return `T6 (Z) → ${Rd}：${Rd} ← ${H(st.regs[m.rd])}`; } });
    } else if (m.inst === 'lw') {
      S({ t: 'T4', micro: `(${Rs}) → MAR`, sigs: [`${Rs}out`, 'MARin'], out: Rs, ins: ['MAR'], note: '取有效地址',
        run() { st.mar = st.regs[m.rs]; },
        say() { return `执行第 1 拍：${Rs} = ${H(st.mar)} 作为有效地址 → MAR。`; },
        log() { return `T4 (${Rs}) → MAR：MAR ← ${H(st.mar)}`; } });
      S({ t: 'T5', micro: 'M(MAR) → MDR', sigs: ['MemR', 'MDRin'], out: 'M', ins: ['MDR'], note: '读主存',
        run() { st.mdr = memAt(st.mar); },
        say() { return `执行第 2 拍：读 M[${H(st.mar)}] = ${H(st.mdr)} → MDR。取数指令的数据只经过 MDR 一次。`; },
        log() { return `T5 M(MAR) → MDR：MDR ← ${H(st.mdr)}`; } });
      S({ t: 'T6', micro: `(MDR) → ${Rd}`, sigs: ['MDRout', `${Rd}in`], out: 'MDR', ins: [Rd], note: '写回寄存器',
        run() { st.regs[m.rd] = st.mdr; },
        say() { return `执行第 3 拍：MDR = ${H(st.mdr)} 经总线写回 ${Rd}，lw 共 6 拍。`; },
        log() { return `T6 (MDR) → ${Rd}：${Rd} ← ${H(st.regs[m.rd])}`; } });
    } else if (m.inst === 'sw') {
      S({ t: 'T4', micro: `(${Rs}) → MAR`, sigs: [`${Rs}out`, 'MARin'], out: Rs, ins: ['MAR'], note: '取有效地址',
        run() { st.mar = st.regs[m.rs]; },
        say() { return `执行第 1 拍：${Rs} = ${H(st.mar)} 作为有效地址 → MAR。`; },
        log() { return `T4 (${Rs}) → MAR：MAR ← ${H(st.mar)}`; } });
      S({ t: 'T5', micro: `(${Rd}) → MDR`, sigs: [`${Rd}out`, 'MDRin'], out: Rd, ins: ['MDR'], note: '要写入的数据先进 MDR',
        run() { st.mdr = st.regs[m.rd]; },
        say() { return `执行第 2 拍：${Rd} = ${H(st.mdr)}（要存的数据）→ MDR。**写主存也要先经 MDR**，CPU 与主存之间只有这一个数据口。`; },
        log() { return `T5 (${Rd}) → MDR：MDR ← ${H(st.mdr)}`; } });
      S({ t: 'T6', micro: 'MDR → M(MAR)（MemW）', sigs: ['MemW'], out: 'MDR', ins: ['M'], note: '写主存：本拍接收方是主存',
        run() { wMem(st.mar, st.mdr); },
        say() { return `执行第 3 拍：MDR = ${H(st.mdr)} 写入 M[${H(st.mar)}]（控制信号 MemW）。注意本拍**接收方是主存**、驱动者仍是 MDR。`; },
        log() { return `T6 MDR → M[${H(st.mar)}]：M[${H(st.mar)}] ← ${H(st.mdr)}（MemW）`; } });
    } else {
      S({ t: 'T4', micro: 'Ext(IR[7:0]) → PC', sigs: [m.ext ? 'Ext=1（符号扩展）' : 'Ext=0（零扩展）', 'PCin'], out: null, ins: ['PC'],
        note: '扩展器直送 PC，不占总线',
        run() { st.pc = m.immExt; },
        say() { return `执行第 1 拍：IR 低 8 位 = ${H(m.imm8).slice(2)} 经扩展器（Ext = ${m.ext}）变成 ${H(m.immExt)} 直接送 PC ⇒ PC ← ${H(st.pc)}。**转移目标由扩展器直接给 PC，不占内部总线**，所以本拍总线上没有部件在驱动；jmp 共 4 拍。`; },
        log() { return `T4 Ext(${H(m.imm8).slice(2)}) → PC：PC ← ${H(st.pc)}（Ext=${m.ext}）`; } });
    }

    if (steps.length !== TOTAL) throw { message: `内部错误：${m.inst} 展开出 ${steps.length} 拍，应为 ${TOTAL} 拍` };

    /* ---------- 生成快照：首帧 init + 每拍一帧 + 末帧 done ---------- */
    const beatsMeta = steps.map((s, i) => ({ idx: i + 1, t: s.t, micro: s.micro, sigs: s.sigs.slice(), out: s.out, ins: s.ins.slice(), note: s.note }));
    const clone = o => ({
      pc: o.pc, mar: o.mar, mdr: o.mdr, ir: o.ir, y: o.y, z: o.z,
      alu: o.alu ? { a: o.alu.a, b: o.alu.b, op: o.alu.op, r: o.alu.r } : null,
      regs: o.regs.slice(), mem: o.mem.slice(),
    });
    const snaps = [];
    const frame = (kind, s, extra) => snaps.push(Object.assign({
      kind, total: TOTAL, label: m.label, code: m.code, inst: m.inst, ext: m.ext, imm8: m.imm8, immExt: m.immExt,
      rd: m.rd, rs: m.rs, beats: beatsMeta.map(b => Object.assign({}, b, { sigs: b.sigs.slice(), ins: b.ins.slice() })),
      signRoom: { ext: m.ext, immExt: m.immExt },
    }, clone(s), extra));

    frame('init', st, {
      idx: 0, t: '—', micro: '（未开始）', sigs: [], out: null, ins: [], note: '',
      desc: `就绪：${m.label}（指令字 ${H(m.code)}）。PC = ${H(m.pc)}，取指从 M[${H(m.pc)}] 读出这条指令；本条共 ${TOTAL} 拍（取指 3 拍 + 执行 ${TOTAL - 3} 拍）。点"单步"看每一拍的微操作与控制信号。`,
      log: `就绪：${m.label}｜指令字 ${H(m.code)}｜取值 ${H(m.ext)}｜共 ${TOTAL} 拍`,
      logType: 'info',
    });

    steps.forEach((s, i) => {
      s.run();
      const last = i === steps.length - 1;
      frame('beat', st, {
        idx: i + 1, t: s.t, micro: s.micro, sigs: s.sigs.slice(), out: s.out, ins: s.ins.slice(), note: s.note,
        desc: s.say(),
        log: s.log() + (last ? `｜本条指令完成：${m.label}` : ''),
        logType: last ? 'success' : 'info',
      });
    });

    /* 末帧 done：状态与最后一拍相同，给结论 */
    const fin = clone(st);
    const resTxt = m.inst === 'add_rr' || m.inst === 'add_ri' || m.inst === 'add_imm'
      ? `${Rd} ← ${H(st.regs[m.rd])}`
      : m.inst === 'lw' ? `${Rd} ← ${H(st.regs[m.rd])}`
        : m.inst === 'sw' ? `M[${H(st.mar)}] ← ${H(st.mem[st.mar - WIN])}`
          : `PC ← ${H(st.pc)}`;
    frame('done', fin, {
      idx: TOTAL + 1, t: '完成', micro: '（本条指令执行完毕）', sigs: [], out: null, ins: [], note: '',
      desc: `完成：${m.label} 共 ${TOTAL} 拍。结果 ${resTxt}。若下一条指令继续执行，PC = ${H(st.pc)}。`,
      log: `完成：${m.label} 共 ${TOTAL} 拍（取指 3 + 执行 ${TOTAL - 3}）｜结果 ${resTxt}`,
      logType: 'success',
    });
    return snaps;
  },

  render(ctx) {
    const { snap: s, model: m, stage } = ctx;
    const H = m.hx;

    /* 部件格：橙边 = 本拍驱动总线（out），绿边 = 本拍从总线接收（in） */
    const part = (name, val) => {
      const isOut = s.out === name, isIn = (s.ins || []).indexOf(name) >= 0;
      const bc = isOut ? '#f59e0b' : (isIn ? '#10b981' : '#e2e8f0');
      const bg = isOut ? '#fffbeb' : (isIn ? '#ecfdf5' : '#ffffff');
      const mk = isOut ? '<span style="color:#b45309">▶ </span>' : (isIn ? '<span style="color:#047857">◀ </span>' : '');
      return `<div class="dp-part${isOut ? ' dp-part-out' : ''}${isIn ? ' dp-part-in' : ''}" data-part="${name}"
        style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;border:1.5px solid ${bc};background:${bg};border-radius:8px;padding:3px 8px;font:600 12px Consolas,monospace;box-sizing:border-box">
        <span style="color:#475569">${name}</span><span>${mk}<span class="dp-val" style="color:#0f172a">${val}</span></span></div>`;
    };
    const left = [
      part('PC', H(s.pc)), part('MAR', H(s.mar)), part('MDR', H(s.mdr)),
      part('IR', H(s.ir)), part('Y', H(s.y)), part('Z', H(s.z)),
    ].join('');
    const right = [
      part('R0', H(s.regs[0])), part('R1', H(s.regs[1])), part('R2', H(s.regs[2])), part('R3', H(s.regs[3])),
      part('ALU', s.alu ? H(s.alu.r) : '——'),
    ].join('');

    /* 主存窗口 0010~001F：4 行 × 4 格（确定性网格，离线没有 Tailwind 也不会塌） */
    const memRows = [];
    for (let r = 0; r < 4; r++) {
      const cells = [];
      for (let c = 0; c < 4; c++) {
        const i = r * 4 + c, a = DP_WIN0 + i;
        const isCur = s.mar === a && s.kind === 'beat';
        const isCode = a === 0x10;
        const bc = isCur ? '#6366f1' : (isCode ? '#facc15' : '#e2e8f0');
        const bg = isCur ? '#eef2ff' : (isCode ? '#fefce8' : '#ffffff');
        cells.push(`<div class="dp-mem${isCur ? ' dp-mem-cur' : ''}${isCode ? ' dp-mem-code' : ''}" data-addr="${H(a)}"
          style="width:86px;border:1.5px solid ${bc};background:${bg};border-radius:6px;padding:2px 6px;box-sizing:border-box;font:600 11px Consolas,monospace">
          <div style="color:#94a3b8">${H(a)}</div><div style="color:#0f172a">${H(s.mem[i])}</div></div>`);
      }
      memRows.push(`<div class="dp-mem-row" style="display:flex;gap:6px;justify-content:flex-start">${cells.join('')}</div>`);
    }

    const busTxt = s.out
      ? `本拍驱动总线：<b>${s.out}</b> → 接收：<b>${(s.ins || []).join(' / ') || '—'}</b>`
      : (s.kind === 'beat' ? '本拍<b>没有部件驱动总线</b>（扩展器 / 增量器的输出直送 ALU 或 PC）'
        : (s.kind === 'done' ? '本条指令已执行完毕（下面每一拍的微操作与控制信号都可回看）' : '（尚未开始）'));

    const rows = s.beats.map(b => {
      const cur = b.idx === s.idx;
      return `<tr class="dp-row${cur ? ' dp-cur' : ''}" data-t="${b.t}" style="background:${cur ? '#eef2ff' : 'transparent'};${cur ? 'font-weight:700' : ''}">
        <td style="padding:2px 8px;color:#475569">${b.t}</td>
        <td style="padding:2px 8px;font-family:Consolas,monospace">${b.out === null && b.micro.indexOf('Ext') >= 0 ? b.micro + ' ★不占总线' : b.micro}</td>
        <td style="padding:2px 8px;font-family:Consolas,monospace;color:#6d28d9">${b.sigs.join(', ')}</td>
        <td style="padding:2px 8px;color:#64748b">${b.note || ''}</td>
      </tr>`;
    }).join('');

    const cards =
      RC408.ui.statCard('当前指令', m.label, '指令字 ' + H(m.code) + '（操作码 ' + H(m.code).slice(0, 1) + 'H）', 'text-indigo-600') +
      RC408.ui.statCard('拍序', s.kind === 'init' ? '0 / ' + s.total : (s.kind === 'done' ? '完成（共 ' + s.total + ' 拍）' : s.idx + ' / ' + s.total),
        s.kind === 'init' ? '尚未开始' : (s.kind === 'done' ? '本条指令执行完毕' : s.t + '：' + s.micro.slice(0, 18)), 'text-slate-800') +
      RC408.ui.statCard('单总线驱动者', s.out || '（无）', '单总线铁律：一拍至多一个输出', s.out ? 'text-amber-600' : 'text-slate-400') +
      RC408.ui.statCard('Ext / 扩展结果', (m.ext ? 'Ext = 1 符号扩展' : 'Ext = 0 零扩展'), H(m.imm8).slice(2) + ' → ' + H(m.immExt), 'text-emerald-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('单总线数据通路（橙 = 本拍驱动总线，绿 = 本拍从总线接收；★ = 该拍不经总线）')}
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
            <div style="display:flex;gap:10px">
              <div style="display:flex;flex-direction:column;gap:6px;width:168px">${left}</div>
              <div style="display:flex;flex-direction:column;gap:6px;width:168px">${right}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;flex:1 1 400px;min-width:380px">
              <div class="dp-bus" style="border:1.5px dashed #6366f1;background:#eef2ff;border-radius:8px;padding:6px 10px;font:600 12px system-ui;color:#3730a3">${busTxt}</div>
              <div style="display:flex;flex-direction:column;gap:6px">${memRows.join('')}</div>
              <div style="font:500 11px system-ui;color:#94a3b8">主存窗口 ${H(DP_WIN0)} ~ ${H(DP_WIN0 + 15)}；<span style="color:#b45309">黄框</span> = 当前指令字所在的 0010，<span style="color:#4338ca">蓝框</span> = 本拍 MAR 指向的单元</div>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('微操作状态表（当前拍高亮；"控制信号"列就是真题要你写的东西）')}
          <table class="w-full text-sm" style="border-collapse:collapse">
            <thead><tr style="color:#94a3b8;font-size:11px">
              <th style="text-align:left;padding:2px 8px">拍</th><th style="text-align:left;padding:2px 8px">微操作</th>
              <th style="text-align:left;padding:2px 8px">有效控制信号</th><th style="text-align:left;padding:2px 8px">说明</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>① <b>单总线一拍只能有一个部件输出</b>——某拍出现两个 Xout 一定是错的；
          ② <b>PC + 1 由独立增量器完成、不占总线</b>，所以能与总线上的一步同拍；
          ③ ALU 的两个输入要靠<b>暂存器 Y</b> 错开、输出要靠 <b>Z</b> 缓存，否则 A、B 两端会同拍拿到同一份数据；
          ④ 立即数与转移目标经 <b>Ext</b> 扩展后<b>直接送 ALU / PC，不经总线</b>；
          ⑤ 控制信号命名法 <b>Xout / Xin</b>、<b>MemR / MemW</b>、<b>ALUop</b>、<b>Ext</b>。
        </div>
      </div>`;
  },
});
