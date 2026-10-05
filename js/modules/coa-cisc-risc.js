'use strict';
/* ============================================================================
 * coa-cisc-risc.js —— 【计算机组成原理】CISC 与 RISC 对比（前缀 _cr）
 * ----------------------------------------------------------------------------
 * 考情：**4/18 年（选 3 + 大 1）**——选 2009-17（RISC 特点辨析）、2011-18（哪些指令系统特点
 *      有利于实现指令流水线）、2025-17（RISC 叙述纠错）；大 2017-44(1)（判定 M 为 CISC，
 *      依据是"指令长短不一"）。
 *      ★ **窗32** 从零核定：原登记只有 3 道选择题，**补登 2017-44(1) 这道大题**（按 §2.0 口径①：
 *      该小问的标准解就是 CISC/RISC 对比判据）。依据 `考情缓存/逐年速查.md:435`、
 *      `考情缓存/2017_解析.txt:379`；三条选择题依据 `考情缓存/关键词索引.md:770 / :795 / :865`。
 *
 * ============================================================================
 * 数据模型与不变量（§3.9 P2：先把这一段写清，再写实现）
 * ----------------------------------------------------------------------------
 * · 单位：指令长度 = **字节 B**；`mem` = 该指令执行期间访问**数据**存储器的次数
 *   （**取指令的访存不计入** —— 考题说的"访存"指访问数据；故 `mem` 只数操作数访存）。
 * · 两侧都是**教学示意指令系统**（与 coa-assembly 自定 ISA 同一做法，不是某台真机的逐字节编码）：
 *     CISC 侧 = 类 x86 **变长**编码，保留"多数指令可直接访存、寻址方式丰富、微程序控制"三个特征；
 *     RISC 侧 = 类 MIPS **32 位定长**，保留"只有 LW/SW 访存、寄存器传参、硬布线"三个特征。
 *   示意只保留教材要对比的差异；**长度、访存次数、条数三项在模块内自洽**（见 I4/I6）。
 * · 不变量（Node 冒烟逐条断言，参考实现独立重算）：
 *   I1 **RISC 每条恒为 4 B**；每个片段的 CISC 侧**至少出现两种不同长度**（变长）。
 *   I2 第 k 帧的累计条数 / 字节 / 访存 = 两侧各取"前 k 条"的**前缀和**。
 *   I3 累计量**单调不减**；末帧 = 全部指令之和。
 *   I4 每条指令 `bytes` = 它的字段字节数之和（不许手写与字段矛盾的总长）。
 *   I5 `mem ∈ {0,1,2,3}`；"只有 Load/Store 访存"**只对 RISC 成立**。
 *   I6 每个片段：RISC 代码字节 **>** CISC 代码字节；RISC 数据访存次数 **≤** CISC。
 *      （条数不设此不变量：片段③ CISC 压栈传参要 5 条、反比 RISC 的 4 条多 —— 这是真事实，
 *        也是"条数少 ≠ 更省"的最好例子。）
 *   I7 帧数 = max(CISC 条数, RISC 条数) + 2（init + 逐条取指 + done）。
 * ========================================================================== */
(function () {
  /* ---------- 指令定义：I(汇编, [[字段名, 字节数], …], 数据访存次数, 一句话) ---------- */
  function I(asm, f, mem, t) {
    return { asm, f, bytes: f.reduce(function (s, x) { return s + x[1]; }, 0), mem, t };
  }

  /* CISC 侧：字段边界随指令变化 ⟹ 长度在 1 ~ 6 B 之间浮动 */
  const CI = {
    movEaxA: I('MOV EAX,[A]', [['op', 1], ['modrm', 1], ['disp', 1]], 1, '取内存 A 到寄存器'),
    addEaxB: I('ADD EAX,[B]', [['op', 1], ['modrm', 1], ['disp', 2]], 1, '寄存器加内存 B'),
    movC: I('MOV [C],EAX', [['op', 1], ['modrm', 1], ['disp', 1]], 1, '寄存器写回内存 C'),
    movEaxI: I('MOV EAX,[i]', [['op', 1], ['modrm', 1], ['disp', 1]], 1, '取下标 i'),
    movEaxAI: I('MOV EAX,[a+EAX*4]', [['op', 1], ['modrm', 1], ['sib', 1], ['disp', 1]], 1, '比例变址：下标 ×4、加基址、访存一条做完'),
    addSum: I('ADD [sum],EAX', [['op', 1], ['modrm', 1], ['disp', 2]], 2, '直接对内存做加法：读 + 写'),
    pushY: I('PUSH [y]', [['op', 1], ['modrm', 1]], 2, '取内存 y 并压栈'),
    pushX: I('PUSH [x]', [['op', 1], ['modrm', 1]], 2, '取内存 x 并压栈'),
    callF: I('CALL f', [['op', 1], ['rel', 4]], 1, '返回地址压栈'),
    ret: I('RET', [['op', 1]], 1, '从栈弹回返回地址'),
    addEsp: I('ADD ESP,8', [['op', 1], ['modrm', 1], ['imm', 1]], 0, '调用者清栈'),
    cmpB: I('CMP EAX,[B]', [['op', 1], ['modrm', 1], ['disp', 1]], 1, '比较指令直接访存'),
    jgL: I('JG L', [['op', 1], ['rel', 1]], 0, '条件转移'),
  };

  /* RISC 侧：全部 4 B（32 位定长）；只有 LW / SW 访存 */
  const RI = {
    lwR1A: I('LW R1,A', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    lwR2B: I('LW R2,B', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    addR3: I('ADD R3,R1,R2', [['op', 1], ['rs', 1], ['rt', 1], ['rd', 1]], 0, '寄存器间运算'),
    swC: I('SW C,R3', [['op', 1], ['rs', 1], ['imm', 2]], 1, '存数 Store'),
    lwR1I: I('LW R1,i', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    sllR1: I('SLLI R1,R1,2', [['op', 1], ['rs', 1], ['rt', 1], ['shamt', 1]], 0, '下标 ×4 得自己算'),
    addRa: I('ADD R1,R1,Ra', [['op', 1], ['rs', 1], ['rt', 1], ['rd', 1]], 0, '基址相加'),
    lwR2: I('LW R2,0(R1)', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    lwR3: I('LW R3,sum', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    addR3R2: I('ADD R3,R3,R2', [['op', 1], ['rs', 1], ['rt', 1], ['rd', 1]], 0, '寄存器间运算'),
    swSum: I('SW sum,R3', [['op', 1], ['rs', 1], ['imm', 2]], 1, '存数 Store'),
    lwR4X: I('LW R4,x', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    lwR5Y: I('LW R5,y', [['op', 1], ['rs', 1], ['imm', 2]], 1, '取数 Load'),
    jalF: I('JAL f', [['op', 1], ['addr', 3]], 0, '返回地址写 R31 寄存器，不访存'),
    jrR31: I('JR R31', [['op', 1], ['rs', 1], ['pad', 2]], 0, '从寄存器返回，不访存'),
    sltR3: I('SLT R3,R1,R2', [['op', 1], ['rs', 1], ['rt', 1], ['rd', 1]], 0, '比较只能在寄存器间做'),
    bneL: I('BNE R3,R0,L', [['op', 1], ['rs', 1], ['rt', 1], ['imm', 1]], 0, '条件转移'),
  };

  /* ---------- 四个程序片段：同一段程序，两侧各自怎么做完 ---------- */
  const FRAGS = [
    {
      id: 'f1', label: '① C = A + B（内存-内存加法）', src: 'C = A + B;',
      c: ['movEaxA', 'addEaxB', 'movC'],
      r: ['lwR1A', 'lwR2B', 'addR3', 'swC'],
    },
    {
      id: 'f2', label: '② sum += a[i]（数组元素累加 · 循环体）', src: 'sum += a[i];',
      c: ['movEaxI', 'movEaxAI', 'addSum'],
      r: ['lwR1I', 'sllR1', 'addRa', 'lwR2', 'lwR3', 'addR3R2', 'swSum'],
    },
    {
      id: 'f3', label: '③ f(x, y)（过程调用传参）', src: 'f(x, y);',
      c: ['pushY', 'pushX', 'callF', 'ret', 'addEsp'],
      r: ['lwR4X', 'lwR5Y', 'jalF', 'jrR31'],
    },
    {
      id: 'f4', label: '④ if (a > b) goto L（比较与转移）', src: 'if (a > b) goto L;',
      c: ['movEaxA', 'cmpB', 'jgL'],
      r: ['lwR1A', 'lwR2B', 'sltR3', 'bneL'],
    },
  ];

  /* 判据裁决表（ISA 级静态事实，不随片段变；"利于流水线"一栏是结论，不是数字） */
  const VERDICT = [
    ['指令长度', '变长（本模块示意 1 ~ 5 B，逐条不同）', '<b>定长 32 位（恒 4 B）</b>', 'RISC'],
    ['访存指令', '多数指令可直接访存（ADD [sum],EAX、CMP EAX,[B]）', '<b>只有 LW / SW</b>', 'RISC'],
    ['控制器', '多用微程序（查控制存储器）', '<b>多用硬布线（组合逻辑）</b>', 'RISC'],
    ['寻址方式', '丰富（十几种，含比例变址 SIB）', '较少（几种）', 'RISC'],
    ['通用寄存器', '较少，过程调用多压栈传参', '<b>大量，用寄存器传参</b>', 'RISC'],
    ['目标代码长度', '短（本模块 4 个片段都是 CISC 更短）', '长（定长指令有冗余）', 'CISC（不是流水线判据）'],
  ];

  const sumBy = function (list, key) {
    return list.reduce(function (s, x) { return s + x[key]; }, 0);
  };

  RC408.registerModule({
    id: 'coa-cisc-risc',
    mode: 'stepper',
    title: 'CISC 与 RISC 对比',

    theory: `
> **为什么要有它**：CISC 想让"一条指令干完一件事"，指令越来越复杂、译码与流水线越难做；RISC 反过来只留常用简单指令、把复杂度推给编译器，才让**定长译码 + 流水线**成为可能——这是两种设计哲学的分水岭。
> **怎么实现**：CISC 多用**微程序**控制、指令**变长**、多数指令可访存；RISC 多用**硬布线（组合逻辑）**控制、指令**定长**、只有 **Load/Store 访存**、通用寄存器多、用寄存器传参。
> **记住什么**：4 个高频判据——**定长指令、仅 Load/Store 访存、硬布线控制、适合流水线**；x86 是 CISC，MIPS 与经典 ARM 是 RISC。

## 关键机制
| 比较项 | CISC | RISC |
| --- | --- | --- |
| 指令系统 | 复杂庞大，指令数目多 | 简单精简，指令数目少 |
| 指令长度 | **不固定（变长）** | **定长** |
| 寻址方式 | 丰富（十几种） | 较少（几种） |
| 访存指令 | 大多可访存 | **只有 Load/Store 可访存** |
| 通用寄存器 | 较少 | **大量** |
| 控制器 | 多用**微程序**控制 | 多用**硬布线（组合逻辑）** |
| 流水线 | 难以优化 | **适合流水线** |
| 目标代码 | 程序代码短 | 程序代码较长 |
| 代表机型 | x86 | MIPS、经典 ARM |

- **RISC 的三条硬特征**：指令**定长**、指令与数据**按边界对齐**、**仅 Load/Store 访存**——三条都直接服务于流水线：译码简单、一个存取周期取完、取指与取操作数时间固定。
- **为什么定长有利于流水线**：流水线要求各段"每拍一步"；指令变长则取指长度与译码时间都不固定，各段无法对齐（2011-18 的题眼就在这里）。
- **为什么 RISC 用硬布线**：指令少而规整，译码可用组合逻辑直接实现，比查控制存储器快；CISC 指令复杂多变，用微程序更规整、易扩展。
- **寄存器传参**：RISC 的过程调用用寄存器传参数（返回地址也放寄存器 R31），配合大量寄存器减少访存；CISC 常压栈传参（CALL 压返回地址、RET 弹出）。

## 考点提醒（易错点）
1. RISC 用**硬布线**、CISC 用**微程序**——把 RISC 说成"用微程序控制器"就是错项（2009-17 就考在这）。
2. "只有 Load/Store 访存"是 RISC 特征，别扩大成"RISC 不能访存"。
3. 定长、对齐、仅 Load/Store 这三条要答出**为什么**：都是为了简化译码、便于流水线（2011-18）。
4. 目标代码长度别记反：CISC 代码**短**、RISC 代码**长**（定长指令有冗余）。
5. **指令条数少不等于更省**：过程调用里 RISC 用寄存器传参，反而可能比 CISC 的压栈传参**指令更少、访存更少**（本模块片段③就是活例）。
6. x86 始终是 CISC 代表；题给"经典 RISC 特征"时按上表判断，不要用后来的混合形态去推翻结论。

> **真题考情**：**4/18 年（选 3 + 大 1）**：选 2009-17（RISC 特点辨析）、2011-18（哪些特点有利于指令流水线）、
> 2025-17（RISC 叙述纠错）；大 2017-44(1)（判定 M 为 CISC——依据"指令长短不一"）。
`,

    inputs: [
      {
        key: 'prog', label: '程序片段（同一段程序，看两侧各自怎么做完）', type: 'select', wide: true,
        default: 'f1',
        options: FRAGS.map(function (f) { return { v: f.id, t: f.label }; }),
        help: 'CISC 侧 = 类 x86 变长示意指令；RISC 侧 = 类 MIPS 32 位定长示意指令。长度 / 访存次数只数操作数访存，取指访存不计入。',
      },
    ],

    quickActions: FRAGS.map(function (f) {
      return {
        label: '📄 ' + f.label,
        run: function (rt) { rt.setInput('prog', f.id); rt.load(); },
      };
    }),

    parse(vals) {
      const frag = FRAGS.filter(function (f) { return f.id === vals.prog; })[0];
      if (!frag) throw { message: '未知的程序片段：' + vals.prog };
      const pick = function (dict, keys, side) {
        return keys.map(function (k) {
          if (!dict[k]) throw { message: side + ' 侧缺少示意指令定义：' + k };
          const o = dict[k];
          const f = o.f.map(function (x) { return [x[0], x[1]]; });
          const bytes = f.reduce(function (s, x) { return s + x[1]; }, 0);
          if (bytes !== o.bytes) throw { message: side + ' 指令 ' + o.asm + ' 的字长与字段矛盾' };
          return { asm: o.asm, f: f, bytes: bytes, mem: o.mem, t: o.t };
        });
      };
      const cisc = pick(CI, frag.c, 'CISC');
      const risc = pick(RI, frag.r, 'RISC');
      if (!cisc.length || !risc.length) throw { message: '两侧指令都不能为空' };
      return { fragId: frag.id, label: frag.label, src: frag.src, cisc: cisc, risc: risc };
    },

    buildSnapshots(model) {
      const cisc = model.cisc, risc = model.risc;
      const cLen = cisc.length, rLen = risc.length;
      const maxLen = Math.max(cLen, rLen);
      /* 前缀和（与参考实现同口径：第 k 帧 = 前 k 条之和；k 超过某侧长度就取满） */
      const cut = function (list, k) { return list.slice(0, Math.min(k, list.length)); };
      const tot = function (k) {
        const c = cut(cisc, k), r = cut(risc, k);
        return {
          cN: c.length, rN: r.length,
          cBytes: sumBy(c, 'bytes'), rBytes: sumBy(r, 'bytes'),
          cMem: sumBy(c, 'mem'), rMem: sumBy(r, 'mem'),
          cMax: c.length ? Math.max.apply(null, c.map(function (x) { return x.bytes; })) : 0,
          cMin: c.length ? Math.min.apply(null, c.map(function (x) { return x.bytes; })) : 0,
        };
      };

      const snaps = [];
      const push = function (step, k, o) {
        snaps.push(Object.assign({
          step: step, k: k, kC: Math.min(k, cLen), kR: Math.min(k, rLen),
          cLen: cLen, rLen: rLen, label: model.label, src: model.src,
          cisc: cut(cisc, cLen).map(function (x) { return Object.assign({}, x, { f: x.f.map(function (y) { return [y[0], y[1]]; }) }); }),
          risc: cut(risc, rLen).map(function (x) { return Object.assign({}, x, { f: x.f.map(function (y) { return [y[0], y[1]]; }) }); }),
          tot: tot(k), verdict: false, log: '', logType: 'info', desc: '',
        }, o || {}));
      };

      push('init', 0, { logType: 'info' });
      snaps[snaps.length - 1].desc = '就绪：' + model.label + ' —— CISC 侧 ' + cLen + ' 条 / ' +
        sumBy(cisc, 'bytes') + ' B，RISC 侧 ' + rLen + ' 条 / ' + sumBy(risc, 'bytes') +
        ' B。按「单步 ▶」逐条取指，看两侧怎么把同一段程序做完。';
      snaps[snaps.length - 1].log = snaps[snaps.length - 1].desc;

      for (let k = 1; k <= maxLen; k++) {
        const hasC = k <= cLen, hasR = k <= rLen;
        let d;
        if (hasC && hasR) {
          d = '第 ' + k + ' 条：CISC 取「' + cisc[k - 1].asm + '」（' + cisc[k - 1].bytes +
            ' B）｜RISC 取「' + risc[k - 1].asm + '」（' + risc[k - 1].bytes + ' B）。';
        } else if (hasC) {
          d = '第 ' + k + ' 条：CISC 取「' + cisc[k - 1].asm + '」（' + cisc[k - 1].bytes +
            ' B）——RISC 侧 ' + rLen + ' 条已取完，它更早结束。';
        } else {
          d = '第 ' + k + ' 条：RISC 取「' + risc[k - 1].asm + '」（' + risc[k - 1].bytes +
            ' B）——CISC 侧 ' + cLen + ' 条已全部取完，RISC 还要多取 ' + (k - cLen) + ' 条同样长度的指令。';
        }
        const t = tot(k);
        d += ' 累计：CISC ' + t.cN + ' 条 / ' + t.cBytes + ' B / 访存 ' + t.cMem +
          ' 次；RISC ' + t.rN + ' 条 / ' + t.rBytes + ' B / 访存 ' + t.rMem + ' 次。';
        push('step', k, { desc: d, log: d, logType: 'info' });
      }

      const T = tot(maxLen);
      push('done', maxLen, {
        verdict: true, logType: 'success',
        desc: '完成：CISC ' + T.cN + ' 条 / ' + T.cBytes + ' B / 数据访存 ' + T.cMem +
          ' 次｜RISC ' + T.rN + ' 条 / ' + T.rBytes + ' B / 数据访存 ' + T.rMem +
          ' 次。代码更短的是 CISC，但"适合流水线"的是 RISC —— 理由看下方判据裁决表。',
      });
      snaps[snaps.length - 1].log = snaps[snaps.length - 1].desc;
      return snaps;
    },

    render(ctx) {
      const s = ctx.snap, stage = ctx.stage;
      const esc = RC408.util.esc;
      const BW = 26;                                  /* 每字节方块宽度（px），几何断言按它反算字节数 */

      /* 字节尺：一个字段一个方块，宽度 = 字节数 × BW ⟹ 行宽 / BW = 字节数（CISC 逐行不同，RISC 恒 4 B）。
         ⚠ 必须写死 `box-sizing:border-box` 且 `margin:0`：否则边框与间距会叠加进行宽，
            RISC 各行的字段个数不同（3 / 4 / 2 个）就量出不同宽度，"定长"在几何上量不出来（窗32 实测）。
         `data-side` 供 harness 把左右两栏分开做几何断言（C 变长 / R 定长） */
      const ruler = function (ins, taken, side) {
        return ins.f.map(function (fd) {
          return '<span class="cr-fld' + (taken ? '' : ' cr-off') + '" data-b="' + fd[1] +
            '" data-side="' + side + '" title="' + esc(fd[0]) + ' ' + fd[1] + ' B" style="display:inline-block;width:' +
            (fd[1] * BW) + 'px;height:18px;line-height:16px;text-align:center;font:600 8.5px/16px Consolas,monospace;' +
            'box-sizing:border-box;margin:0;vertical-align:middle;border:1px solid ' + (taken ? '#818cf8' : '#cbd5e1') +
            ';background:' + (taken ? '#eef2ff' : '#f8fafc') +
            ';color:' + (taken ? '#4338ca' : '#94a3b8') + ';border-radius:3px;overflow:hidden">' +
            esc(fd[0]) + '</span>';
        }).join('');
      };
      const cellIns = function (ins, idx, taken, cur) {
        return '<td class="' + (cur ? 'row-cur' : '') + '" style="white-space:nowrap">' +
          '<span style="font:700 11.5px Consolas,monospace;color:' + (taken ? '#1e293b' : '#94a3b8') + '">' +
          esc(ins.asm) + '</span><div style="font-size:10px;color:#94a3b8;margin-top:1px">' + esc(ins.t) + '</div></td>';
      };
      /* 字节数标签与方块**同一行且垂直居中**：inline-block 的默认基线对齐会把这行字推到方块下沿
         （窗32 原分辨率截图抓到，几何断言查不出——§3.8-18 相对位置类缺陷） */
      const cellCode = function (ins, taken, side) {
        return '<td style="white-space:nowrap">' + ruler(ins, taken, side) +
          '<span class="cr-cnt" style="font:700 10.5px Consolas,monospace;vertical-align:middle;margin-left:4px;color:' +
          (taken ? '#4338ca' : '#cbd5e1') + '">' + ins.bytes + ' B</span></td>';
      };
      const cellMem = function (ins, taken) {
        const txt = ins.mem ? ins.mem + ' 次' : '—';
        const cls = !taken ? 'chip-future' : (ins.mem ? 'chip-hit' : '');
        return '<td style="white-space:nowrap"><span class="chip ' + cls + '">' + txt + '</span></td>';
      };

      const rows = [];
      for (let i = 0; i < Math.max(s.cLen, s.rLen); i++) {
        const hasC = i < s.cLen, hasR = i < s.rLen;
        const tc = hasC && i < s.kC, tr = hasR && i < s.kR;
        const cc = hasC && i === s.kC - 1, cr = hasR && i === s.kR - 1;
        rows.push('<tr>' +
          '<td style="text-align:center;color:#94a3b8;font-weight:700">' + (i + 1) + '</td>' +
          (hasC ? cellIns(s.cisc[i], i, tc, cc) + cellCode(s.cisc[i], tc, 'C') + cellMem(s.cisc[i], tc)
            : '<td colspan="3" style="text-align:center;color:#cbd5e1">— CISC 侧已结束 —</td>') +
          '<td style="width:8px;background:#e2e8f0"></td>' +
          (hasR ? cellIns(s.risc[i], i, tr, cr) + cellCode(s.risc[i], tr, 'R') + cellMem(s.risc[i], tr)
            : '<td colspan="3" style="text-align:center;color:#cbd5e1">— RISC 侧已结束 —</td>') +
          '</tr>');
      }

      const T = s.tot;
      const grew = function (c, r) {
        return c === r ? '' : (c < r ? '（RISC 更多 ' + (r - c) + '）' : '（CISC 更多 ' + (c - r) + '）');
      };
      /* 已取指令的长度：**一条都还没取时不许写 "0 ~ 0 B（变长）"**——那一帧这个结论并不成立
         （§0.3「这张表在当前这一帧根本不成立」的语义类缺陷，窗29 的教训），改给"尚未取指"。 */
      const cLenTxt = T.cN === 0 ? '—（尚未取指）' : (T.cMin + ' ~ ' + T.cMax + ' B（变长）');
      const accRows = [
        ['已取指令条数', T.cN + ' 条', T.rN + ' 条'],
        ['已取代码字节', T.cBytes + ' B', T.rBytes + ' B'],
        ['已取指令的数据访存', T.cMem + ' 次', T.rMem + ' 次'],
        ['已取指令的长度', cLenTxt, '4 B（定长）'],
      ].map(function (r) {
        return '<tr><td>' + r[0] + '</td><td style="font-weight:700">' + r[1] +
          '</td><td style="font-weight:700">' + r[2] + '</td></tr>';
      }).join('');

      const verdictRows = VERDICT.map(function (r) {
        return '<tr><td style="font-weight:700">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] +
          '</td><td style="text-align:center;font-weight:800;color:' + (r[3] === 'RISC' ? '#047857' : '#b45309') +
          '">' + r[3] + '</td></tr>';
      }).join('');

      const cur = s.step === 'done'
        ? '本帧 = 末帧：两侧全部指令都已取完，下面是 ISA 级的判据裁决。'
        : (s.step === 'init' ? '本帧 = 就绪帧：一条都还没取，先看两侧各自的指令序列与长度。'
          : '本帧高亮 = 第 ' + s.k + ' 条（深色行 = 已取指，浅灰 = 还没取）。');

      const stats =
        RC408.ui.statCard('指令条数', T.cN + ' / ' + T.rN, 'CISC / RISC' + grew(T.cN, T.rN), 'text-indigo-600') +
        RC408.ui.statCard('代码字节数', T.cBytes + ' / ' + T.rBytes, 'CISC / RISC' + grew(T.cBytes, T.rBytes), 'text-violet-600') +
        RC408.ui.statCard('数据访存次数', T.cMem + ' / ' + T.rMem, 'CISC / RISC（只数操作数访存）' + grew(T.cMem, T.rMem), 'text-emerald-600') +
        RC408.ui.statCard('指令长度', T.cN === 0 ? '— / 4' : T.cMin + '~' + T.cMax + ' / 4',
          'CISC 变长 / RISC 定长（B）', 'text-amber-600');

      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

          <div class="rounded-2xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('双栏指令序列与编码长度（左 CISC 变长 ｜ 右 RISC 32 位定长）')}
            <div style="font-size:11.5px;color:#64748b;margin-bottom:6px">程序片段：<b>${esc(s.src)}</b> · ${esc(cur)}</div>
            <div class="overflow-x-auto" style="overflow-x:auto">
              <table class="tbl">
                <thead><tr>
                  <th style="width:26px">#</th>
                  <th>CISC 指令</th><th>编码（每格 1 B）</th><th>数据访存</th>
                  <th style="width:8px;background:#334155"></th>
                  <th>RISC 指令</th><th>编码（每格 1 B）</th><th>数据访存</th>
                </tr></thead>
                <tbody>${rows.join('')}</tbody>
              </table>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('本帧累计对照（第 k 帧 = 两侧各取前 k 条）')}
            <table class="tbl" style="max-width:640px">
              <thead><tr><th>指标</th><th>CISC</th><th>RISC</th></tr></thead>
              <tbody>${accRows}</tbody>
            </table>
          </div>

          ${s.verdict ? `
          <div class="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3">
            ${RC408.ui.sectionTitle('判据裁决（ISA 级静态事实 —— 谁更适合流水线，看最后一栏）')}
            <div class="overflow-x-auto" style="overflow-x:auto">
              <table class="tbl">
                <thead><tr><th>判据</th><th>CISC</th><th>RISC</th><th>利于流水线</th></tr></thead>
                <tbody>${verdictRows}</tbody>
              </table>
            </div>
            <div class="rounded-xl bg-white border border-emerald-100 px-4 py-2.5 text-xs text-slate-700 leading-relaxed mt-3">
              💡 <b>2011-18 的题眼</b>：<b>指令格式规整且长度一致</b>、<b>按边界对齐</b>、<b>仅 Load/Store 访存</b> ——
              这三条都是 RISC 特征，也都是"有利于实现指令流水线"的答案。<br>
              ⚠ <b>别踩的两个坑</b>：① RISC 用<b>硬布线</b>、CISC 用<b>微程序</b>（说反就是错项，2009-17）；
              ② <b>代码更短 ≠ 更适合流水线</b>——CISC 目标代码短，但变长指令让各段无法对齐。
              RISC 满流后每拍完成 1 条（5 + (N − 1) 拍做完 N 条指令），前提正是指令定长。
            </div>
          </div>` : ''}

          <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
            💡 <b>真题锚点</b>：<b>2009-17</b>（RISC 特点辨析）· <b>2011-18</b>（哪些特点有利于流水线）·
            <b>2017-44(1)</b>（判定 M 为 CISC —— 依据"指令长短不一"）· <b>2025-17</b>（RISC 叙述纠错）。
            <b>共 4/18 年（选 3 + 大 1）</b>。
          </div>
        </div>`;
    },
  });
})();
