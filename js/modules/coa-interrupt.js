'use strict';
/* ============================================================================
 * coa-interrupt.js —— 【计算机组成原理】异常与中断机制（前缀 _ir）
 * 模式：stepper（一拍一帧；首帧 init、末帧 done）
 * 三个场景（用 inputs.scene 切换）：
 *   ① seq  外中断从请求到返回的**全过程 10 拍**：分清"中断隐指令（硬件 3 件）"与"服务程序（软件 4 件）"；
 *   ② nest 多重中断嵌套：4 个中断源 A>B>C>D + **中断屏蔽字**，逐拍看"谁能打断谁、谁被屏蔽挂起"；
 *   ③ kind 故障 / 自陷 / 终止三类内部异常：差别只在**返回哪条指令**。
 *
 * 考情（**窗27 从零核定**：子代理只读 考情缓存/，主线程逐条复核证据行）：
 *   · 18 年中 **16 年**考过（**只有 2013、2023 两年整卷未涉及**），共 **31 题 = 选 25 + 大题 6**。
 *   · 选择题 25 道：2009-22；2010-21；2011-19·21；2012-22·24；2014-22；2015-22·23·24；2016-22；
 *     2017-22；2018-22；2019-14；2020-18·20·21·25；2021-21·22；2022-31；2024-21·23；2026-17·22。
 *   · 大题 6 道（按 §2.0① "大题可对应多个知识点"登记，其中 3 道只在个别小问上用到本考点）：
 *     2016-44（中断响应阶段做哪三件事：关中断、保护断点与程序状态、识别中断源；2016_解析.txt:641）、
 *     2018-43（用"中断响应 + 中断处理时间 0.8µs"判定设备 B 不适合中断方式；2018_解析.txt:427-429）、
 *     2019-45 第 5 问（溢出时转异常处理该加什么指令；2019_真题.txt:525）、
 *     2020-43（中断处理各步骤由硬件 / 操作系统完成；2020_解析.txt:284-288）、
 *     2021-43 第 3 问（用户程序能否用开 / 关中断指令实现临界区互斥；2021_真题.txt:497）、
 *     2025-44 第 2 问（除法异常与"保存 PC、切换处理程序"；2025_解析.txt:297）。
 *     ⚠ 2016-44 / 2020-43 / 2021-43 / 2025-44 / 2019-45 在别的条目里也登记着（coa-muldiv / coa-io /
 *     coa-disk / coa-fixadd / coa-mainmem），按 §2.0① 各自登记，**不是重复**。
 *   · **不登记（选择题按 §2.0② 归更"专"的那个模块）**：2014-25（trap 与关中断指令的特权级 → `os-intro`）、
 *     2022-24（OS 初始化创建中断向量表 → `os-ipc`）、2025-22（外部中断与内部事件划分 → `coa-io`）、
 *     2026-16（向量中断属 ISA 规定 → `coa-inst-format`）、2026-21（关中断 / 中断返回是特权指令 → `os-ioctl`）、
 *     2026-24（异常由操作系统处理 → `os-vm-paging` / `coa-vm`）。
 *   · **无法核对（不猜，留白）**：2019 全卷解析 12 页无文本层（2019-14 只据真题卷）；
 *     2013、2023 两年真题卷文本层废（CJK 1 字 / 14 字乱码）且解析无中断字样 ⟹ "未考"只建于解析文本层；
 *     2026-22 选项 B 在真题卷与解析均为空白行，B 项内容无法核对。
 *
 * 数据模型（口径写死在代码里，避免后来者改错）：
 *   · 中断响应（**中断隐指令**，硬件，3 件）：① 关中断 ② 保存断点（PC 入栈）③ 取服务程序入口（中断向量 → PC）。
 *   · 中断服务程序（**软件**）：④ 保存现场（PSW / 通用寄存器入栈）+ 开中断 ⑤ 执行服务 ⑥ 关中断 + 恢复现场
 *     + 开中断 + 中断返回（IRET，断点出栈 → PC）。
 *     ⚠ **保存 PSW 归硬件还是软件，真题口径不一致**：2016-44 解析把"保护程序状态"算进响应阶段；
 *     2020-43 解析把 PSW / 屏蔽字 / 通用寄存器的保存归给中断服务程序。本演示按 2020-43 的口径排拍，
 *     并在"考点提醒"里写明两种口径，避免后来者按一种口径去改另一种。
 *   · 多重中断：**响应优先级**由硬件排队电路决定（固定 A>B>C>D）；**中断屏蔽字**改变的是**处理优先级**
 *     （能否被打断）。屏蔽字 4 位按 A B C D 排列，**1 = 屏蔽**。默认 A=1111、B=0111、C=0011、D=0001。
 *
 * 不变量（冒烟断言的对象）：
 *   ① 首帧 init / 末帧 done；
 *   ② seq 场景前 3 拍必须是**硬件**（中断隐指令）且动作依次为 关中断 / 保存断点 / 取入口；
 *   ③ seq 场景：保存断点那一拍**栈深度 +1**，中断返回那一拍**栈深度回到 0 且 PC 恢复成断点**；
 *   ④ nest 场景：出现 **嵌套深度 = 2**（A 打断 B）；C 在 A、B 服务期间**始终未被响应**（被屏蔽字挡住）；
 *      4 个中断源最终**全部被响应**；
 *   ⑤ kind 场景：三类异常的"返回点"必须写进快照（fault 回当前指令 / trap 回下一条 / abort 终止）；
 *   ⑥ 快照里的栈、屏蔽字一律**深拷贝**（§1.3 全量携带）。
 * ========================================================================== */

/* ------------------------------ 场景①：外中断全过程 10 拍 ------------------------------ */
function irBuildSeq(m) {
  const H = m.hx;
  const BREAK = 0x1040;                       // 用户程序被中断处（断点）
  const st = { pc: 0x1040, if_: true, sp: 0x7FF0, r0: 0x0001, r1: 0x0002, psw: 'IF=1', prio: 5,
    running: '用户程序', stack: [], intr: 0 };
  const steps = [];
  const S = o => steps.push(o);
  S({ t: 'T1', by: '硬件', action: '设备发出中断请求（INTR ← 1）', detail: 'CPU 要到**一条指令执行结束**时才检测请求，所以本拍用户程序照常执行完。',
    run() { st.intr = 1; },
    say: () => '第 1 拍：设备把中断请求信号置起（INTR = 1）。CPU 只在**一条指令执行结束时**采样请求，异常则是在**指令执行过程中**就被检测到。',
    log: () => 'T1 中断请求到达：INTR ← 1（用户程序继续执行到本条指令结束）' });
  S({ t: 'T2', by: '硬件', action: '判中断允许 → 响应（进入中断响应周期）', detail: '响应要同时满足：有请求、CPU 开中断（IF = 1）、一条指令已执行完。',
    run() { st.running = '中断响应周期'; },
    say: () => '第 2 拍：判中断允许。当前 IF = 1（开中断）且有未屏蔽请求 ⇒ **响应**，CPU 进入中断响应周期。若 IF = 0 则请求被挂起，直到重新开中断。',
    log: () => 'T2 判中断允许：IF = 1 且有请求 ⇒ 响应' });
  S({ t: 'T3', by: '硬件（中断隐指令①）', action: '关中断：IF ← 0', detail: '隐指令第一步，由硬件自动完成，不是一条指令。',
    run() { st.if_ = false; st.psw = 'IF=0'; st.running = '中断隐指令'; },
    say: () => '第 3 拍：**关中断**（IF ← 0）——这是**中断隐指令**的第 1 件，由硬件自动完成。关中断是为了不让响应过程本身再被打断。',
    log: () => 'T3 关中断：IF ← 0（中断隐指令①，硬件）' });
  S({ t: 'T4', by: '硬件（中断隐指令②）', action: '保存断点：PC → 栈，SP ← SP − 1', detail: '断点 = 被中断的地址（' + H(BREAK) + '），由硬件自动压栈。',
    run() { st.stack.push({ label: '返回地址（断点）', value: H(BREAK) }); st.sp = (st.sp - 1) & 0xFFFF; },
    say: () => '第 4 拍：**保存断点**——把 PC（' + H(BREAK) + '）压入栈，SP ← ' + H(st.sp) + '，这是中断隐指令的第 2 件。通用寄存器**不在**这一拍保存。',
    log: () => 'T4 保存断点：栈 ← ' + H(BREAK) + '，SP ← ' + H(st.sp) + '（中断隐指令②，硬件）' });
  S({ t: 'T5', by: '硬件（中断隐指令③）', action: '取中断服务程序入口：中断向量 → PC', detail: '硬件用中断类型号查中断向量表（表由操作系统初始化），把入口地址送 PC。',
    run() { st.pc = 0x2000; },
    say: () => '第 5 拍：**取中断服务程序入口**——硬件按中断类型号查**中断向量表**（表由操作系统初始化），入口地址送 PC ⇒ PC = ' + H(st.pc) + '。至此中断隐指令 3 件做完；注意**类型号不用压栈**，它只用来查表。',
    log: () => 'T5 取服务程序入口：PC ← ' + H(st.pc) + '（中断隐指令③，硬件）' });
  S({ t: 'T6', by: '软件（服务程序）', action: '保存现场（PSW / R0 / R1 入栈）并开中断：IF ← 1', detail: '现场由操作系统 / 服务程序保存；保存完再开中断，才允许更高优先级中断嵌套。',
    run() {
      st.stack.push({ label: 'PSW', value: 'IF=0' }); st.sp = (st.sp - 1) & 0xFFFF;
      st.stack.push({ label: 'R0', value: H(st.r0) }); st.sp = (st.sp - 1) & 0xFFFF;
      st.stack.push({ label: 'R1', value: H(st.r1) }); st.sp = (st.sp - 1) & 0xFFFF;
      st.if_ = true; st.psw = 'IF=1'; st.running = '中断服务程序';
    },
    say: () => '第 6 拍：进入服务程序后先**保存现场**（PSW 与通用寄存器入栈），**再开中断**（IF ← 1）。顺序不能颠倒：先开中断就可能把还没保存的现场冲掉；单重中断则全程不开中断。',
    log: () => 'T6 保存现场（PSW/R0/R1 入栈，SP ← ' + H(st.sp) + '）并开中断（软件）' });
  S({ t: 'T7', by: '软件（服务程序）', action: '执行中断服务程序', detail: '本拍已开中断 ⇒ 可以被更高优先级的中断嵌套（见场景②）。',
    run() { st.running = '中断服务程序（执行中）'; },
    say: () => '第 7 拍：执行中断服务程序主体。因为已经开中断，**更高优先级**的中断可以在这时候嵌套进来（场景② 演示）。',
    log: () => 'T7 执行中断服务程序（本拍可被更高优先级中断嵌套）' });
  S({ t: 'T8', by: '软件（服务程序）', action: '关中断并恢复现场（PSW / R1 / R0 出栈）', detail: '恢复现场期间必须关中断，否则恢复一半又被打断会丢现场。',
    run() {
      st.if_ = false; st.psw = 'IF=0';
      st.stack.pop(); st.stack.pop(); st.stack.pop();
      st.sp = (st.sp + 3) & 0xFFFF;
    },
    say: () => '第 8 拍：**关中断**后恢复现场（PSW、R1、R0 依次出栈）。恢复现场期间关中断，是为了防止恢复了一半又被打断。',
    log: () => 'T8 关中断并恢复现场（SP ← ' + H(st.sp) + '）（软件）' });
  S({ t: 'T9', by: '软件（服务程序）', action: '开中断并中断返回：断点出栈 → PC（IRET）', detail: '中断返回是特权指令；断点从栈里弹回 PC。',
    run() { st.if_ = true; st.psw = 'IF=1'; st.stack.pop(); st.sp = (st.sp + 1) & 0xFFFF; st.pc = BREAK; st.running = '用户程序'; },
    say: () => '第 9 拍：**开中断**并执行**中断返回**（IRET，特权指令）：断点出栈 → PC = ' + H(st.pc) + '。中断返回后 IF 恢复成 1。',
    log: () => 'T9 开中断并中断返回：PC ← ' + H(st.pc) + '（断点出栈，IRET 是特权指令）' });
  S({ t: 'T10', by: '—', action: '回到用户程序继续执行', detail: '用户程序从断点处接着跑，就像什么都没发生过。',
    run() { st.running = '用户程序'; },
    say: () => '第 10 拍：回到用户程序，从断点 ' + H(BREAK) + ' 继续执行。**外中断处理完返回的是断点（当前指令的下一条）**，这与故障返回当前指令不同（场景③）。',
    log: () => 'T10 回到用户程序：PC = ' + H(BREAK) + '（外中断返回到断点）' });

  const clone = () => ({
    pc: st.pc, if_: st.if_, sp: st.sp, r0: st.r0, r1: st.r1, psw: st.psw, prio: st.prio,
    running: st.running, intr: st.intr, stack: st.stack.map(x => ({ label: x.label, value: x.value })),
  });
  const phases = steps.map(s => s.action);
  const meta = steps.map((s, i) => ({ idx: i + 1, t: s.t, by: s.by, action: s.action, detail: s.detail }));
  const snaps = [];
  const frame = (kind, extra) => snaps.push(Object.assign({
    kind, scene: 'seq', total: steps.length, breakPC: BREAK, phases, beats: meta.map(x => Object.assign({}, x)),
  }, clone(), extra));
  frame('init', {
    idx: 0, t: '—', by: '—', action: '（未开始）', detail: '', notes: [],
    desc: '就绪：用户程序执行到 ' + H(BREAK) + ' 附近，此时设备尚未请求中断。共 ' + steps.length + ' 拍：硬件（中断隐指令）3 件 + 软件（服务程序）4 件。点"单步"逐拍看。',
    log: '就绪：外中断全过程共 ' + steps.length + ' 拍（隐指令 3 件由硬件完成）', logType: 'info',
  });
  steps.forEach((s, i) => {
    s.run();
    const last = i === steps.length - 1;
    frame('beat', {
      idx: i + 1, t: s.t, by: s.by, action: s.action, detail: s.detail, notes: [],
      desc: s.say(), log: s.log(), logType: last ? 'success' : 'info',
    });
  });
  frame('done', {
    idx: steps.length + 1, t: '完成', by: '—', action: '（中断处理完毕）', detail: '', notes: [],
    desc: '完成：一次外中断从请求到返回共 ' + steps.length + ' 拍。请记住分工——**关中断、保存断点、取服务程序入口 = 中断隐指令（硬件）**；**保存 / 恢复现场、开中断、中断返回 = 服务程序（软件）**。',
    log: '完成：中断隐指令 3 件（硬件）+ 服务程序 4 件（软件）｜返回断点 ' + H(BREAK), logType: 'success',
  });
  return snaps;
}

/* ------------------------------ 场景②：多重中断嵌套（屏蔽字驱动） ------------------------------ */
function irBuildNest(m) {
  const SRC = ['A', 'B', 'C', 'D'];
  const PRIO = { A: 1, B: 2, C: 3, D: 4 };          // 响应优先级：数字越小越高（由硬件排队电路决定）
  const SVC_LEN = 4;                                // 服务程序主体占几拍（给"嵌套/屏蔽"留出观察窗口）
  const acts = [];                                  // 嵌套栈：栈顶 = 当前运行的服务程序
  const pending = {};                               // 已请求、未响应
  const handled = {};                               // 已处理完并返回
  const fired = {};
  const top = () => acts.length ? acts[acts.length - 1] : null;
  const curMask = () => { const a = top(); return a ? m.masks[a.src] : [0, 0, 0, 0]; };
  const curPrio = () => { const a = top(); return a ? PRIO[a.src] : 5; };
  const levels = () => ['主程序'].concat(acts.map(a => a.src + ' 的中断服务程序'));

  /* 到达规则：按"当前状态"触发，保证每次演示都命中"嵌套"与"被屏蔽"两个教学点（不靠绝对拍号） */
  const TRIG = [
    { src: 'B', when: () => acts.length === 0 && beats.length >= 1 },
    { src: 'A', when: () => { const a = top(); return a && a.src === 'B' && a.step === 4 && a.svcDone >= 2; } },
    { src: 'C', when: () => { const a = top(); return a && a.src === 'A' && a.step === 4 && a.svcDone >= 2; } },
    { src: 'D', when: () => { const a = top(); return a && a.src === 'C' && a.step === 4 && a.svcDone >= 2; } },
  ];
  const beats = [];
  let t = 0;
  while (t < 90) {
    t++;
    const notes = [];
    TRIG.forEach(g => {
      if (fired[g.src]) return;
      if (!g.when()) return;
      fired[g.src] = true; pending[g.src] = true;
      notes.push(g.src + ' 级发出中断请求');
    });
    const a = top();
    /* 可响应点：主程序，或正处于"服务程序主体"那一拍（此时已开中断） */
    const respPoint = !a ? true : (a.step === 4);
    let starting = null;
    if (respPoint) {
      SRC.forEach(x => {
        if (!pending[x]) return;
        if (curMask()[SRC.indexOf(x)] === 1) return;      // 被当前屏蔽字屏蔽
        if (PRIO[x] >= curPrio()) return;                 // 优先级不高于当前 ⇒ 不能打断
        if (!starting || PRIO[x] < PRIO[starting]) starting = x;
      });
    }
    let rec;
    if (starting) {
      const brokeIn = a ? `${a.src} 的服务程序（第 ${a.svcDone + 1} 拍）` : '主程序';
      pending[starting] = false;
      acts.push({ src: starting, step: 0, svcDone: 0, brokeIn });
      const na = top();
      rec = { by: '硬件（中断隐指令①）', action: `${starting} 级响应开始：关中断 IF ← 0`,
        detail: `被打断的是${brokeIn}；${starting} 的响应优先级高于它，且没有被它的屏蔽字屏蔽` };
      na.step = 1;
      notes.push(`${starting} 级被响应（打断${brokeIn}）`);
    } else if (a) {
      if (a.step === 0) { a.step = 1; rec = { by: '硬件（中断隐指令①）', action: `${a.src} 级：关中断 IF ← 0`, detail: '中断隐指令第 1 件，硬件自动完成' }; }
      else if (a.step === 1) { a.step = 2; rec = { by: '硬件（中断隐指令②）', action: `${a.src} 级：保存断点（PC → 栈）`, detail: `断点 = ${a.brokeIn}，由硬件自动压栈` }; }
      else if (a.step === 2) { a.step = 3; rec = { by: '硬件（中断隐指令③）', action: `${a.src} 级：取服务程序入口（中断向量 → PC）`, detail: '中断向量表由操作系统初始化' }; }
      else if (a.step === 3) { a.step = 4; a.svcDone = 0; rec = { by: '软件（服务程序）', action: `${a.src} 级：保存现场并开中断 IF ← 1`, detail: '先保存现场再开中断，之后才允许更高优先级嵌套' }; }
      else if (a.step === 4) {
        a.svcDone++;
        if (a.svcDone >= SVC_LEN) a.step = 5;
        rec = { by: '软件（服务程序）', action: `${a.src} 级：执行服务程序主体（第 ${a.svcDone}/${SVC_LEN} 拍）`, detail: '本拍已开中断 ⇒ 可被更高优先级中断嵌套' };
      } else {
        acts.pop();
        handled[a.src] = true;
        rec = { by: '软件（服务程序）', action: `${a.src} 级：关中断 → 恢复现场 → 开中断 → 中断返回`,
          detail: `返回被它打断的${acts.length ? acts[acts.length - 1].src + ' 的服务程序' : '主程序'}` };
      }
    } else {
      rec = { by: '—（主程序，开中断）', action: '执行主程序', detail: '主程序屏蔽字全 0、响应优先级最低，任何未被屏蔽的请求都能打断它' };
    }
    beats.push({
      idx: t, t: 't' + t, by: rec.by, action: rec.action, detail: rec.detail, notes,
      cur: acts.length ? acts[acts.length - 1].src : 'main',
      depth: acts.length,
      levels: levels(),
      pending: SRC.filter(x => pending[x]),
      mask: curMask().slice(),
    });
    if (SRC.every(x => handled[x]) && acts.length === 0 && t > 1) break;
  }
  if (beats.length >= 89) throw { message: '内部错误：多重中断模拟没有收敛（超过 90 拍）' };

  const maskText = x => m.masks[x].join('');
  const cloneBeat = b => Object.assign({}, b, { levels: b.levels.slice(), pending: b.pending.slice(), mask: b.mask.slice() });
  const maskRows = SRC.map(x => ({ src: x, mask: m.masks[x].slice(), text: maskText(x) }));
  const snaps = [];
  const frame = (kind, idx, extra) => snaps.push(Object.assign({
    kind, scene: 'nest', total: beats.length, beats: beats.map(cloneBeat),
    allBeats: beats.map(cloneBeat), maskRows: maskRows.map(r => Object.assign({}, r, { mask: r.mask.slice() })),
    prio: PRIO, srcs: SRC.slice(),
  }, extra));
  frame('init', 0, {
    idx: 0, t: '—', by: '—', action: '（未开始）', detail: '', notes: [],
    cur: 'main', depth: 0, levels: ['主程序'], pending: [], mask: [0, 0, 0, 0],
    desc: `就绪：4 个中断源 A > B > C > D（响应优先级由硬件排队电路决定）。屏蔽字默认 A=${maskText('A')}、B=${maskText('B')}、C=${maskText('C')}、D=${maskText('D')}（位序 A B C D，1 = 屏蔽）。共 ${beats.length} 拍，点"单步"看谁打断谁、谁被屏蔽挂起。`,
    log: `就绪：多重中断演示，共 ${beats.length} 拍｜屏蔽字 A=${maskText('A')} B=${maskText('B')} C=${maskText('C')} D=${maskText('D')}`,
    logType: 'info',
  });
  beats.forEach((b, i) => {
    const nx = beats[Math.min(i + 1, beats.length - 1)];
    const log = `t${b.idx} [${b.by}] ${b.action}` + (b.notes.length ? `（${b.notes.join('；')}）` : '');
    frame('beat', i + 1, {
      idx: i + 1, t: b.t, by: b.by, action: b.action, detail: b.detail, notes: b.notes.slice(),
      cur: b.cur, depth: b.depth, levels: b.levels.slice(), pending: b.pending.slice(), mask: b.mask.slice(),
      desc: `第 ${b.idx} 拍：${b.action}。当前运行 ${b.cur === 'main' ? '主程序' : b.cur + ' 的服务程序'}，嵌套深度 ${b.depth}，`
        + `当前屏蔽字 ${b.mask.join('')}，待处理请求 ${b.pending.length ? b.pending.join('/') : '无'}。${b.detail ? '说明：' + b.detail + '。' : ''}`,
      log, logType: nx && nx.depth > b.depth ? 'error' : 'info',
    });
  });
  frame('done', beats.length + 1, {
    idx: beats.length + 1, t: '完成', by: '—', action: '（全部中断处理完毕）', detail: '', notes: [],
    cur: 'main', depth: 0, levels: ['主程序'], pending: [], mask: [0, 0, 0, 0],
    desc: `完成：共 ${beats.length} 拍。请看两件事——① **A 在 B 的服务过程中嵌套进来**（打断的必要条件是"未被屏蔽 + 响应优先级更高"）；② **C 在 A、B 服务期间一直没被响应**（被 A 的 1111 与 B 的 0111 屏蔽），直到回到主程序才处理；D 在 C 服务期间同样被屏蔽。`,
    log: `完成：共 ${beats.length} 拍｜嵌套发生过（A 打断 B），C / D 都曾因屏蔽字被挂起`, logType: 'success',
  });
  return snaps;
}

/* ------------------------------ 场景③：故障 / 自陷 / 终止 ------------------------------ */
function irBuildKind(m) {
  const H = m.hx;
  const TYPES = {
    page: { key: 'fault', name: '缺页（故障 Fault）', ret: '重新执行当前指令', retShort: '当前指令',
      why: '缺页处理程序把缺失的页从外存调入后，必须**重新执行**那条访问指令，否则这次访问就丢了。',
      eg: '2019-14（该题错项正是"回到下一条指令执行"）、2021-21（正确叙述是"回到当前指令重新执行"）',
      step: '地址转换时 CPU 检测到页不在内存 → 触发缺页异常' },
    divzero: { key: 'fault', name: '除数为 0（故障，机型相关）', ret: '重新执行当前指令 / 直接终止', retShort: '当前指令（机型相关）',
      why: '多数教材把除零算作故障；但 2015-22 的解析认为它"自动跳过、不返回当前指令"——**以题目给的机型和分工表为准**。',
      eg: '2015-22 解析（除零"会跳过"）、2025-44 第 2 问（除法异常与保存 PC）',
      step: '执行除法指令时发现除数为 0 → 触发异常' },
    syscall: { key: 'trap', name: '系统调用（自陷 Trap）', ret: '执行下一条指令', retShort: '下一条指令',
      why: '自陷由**陷阱指令预先设定**，是程序**有意安排**的；处理程序做完后接着执行陷阱指令的**下一条**。',
      eg: '2022-31（系统调用执行陷入）、2020-18（自陷叙述改错）',
      step: '执行访管 / 陷阱指令 → 主动陷入（自陷）' },
    brk: { key: 'trap', name: '断点 / 单步（自陷 Trap）', ret: '执行下一条指令', retShort: '下一条指令',
      why: '调试用的断点、单步跟踪都是靠陷阱指令实现的，属于**内部异常**而不是外部中断。',
      eg: '2020-18（自陷用于断点与单步）、2026-17（陷阱指令与条件跳转等并列）',
      step: '执行到陷阱指令 → 转到内核相应程序' },
    bus: { key: 'abort', name: '总线错误 / 校验错（终止 Abort）', ret: '程序无法继续，直接终止', retShort: '不返回（终止）',
      why: '硬件出了致命故障，现场不可靠，处理程序只能终止当前程序。',
      eg: '408 未直接考（概念辨析用）',
      step: '总线出错 / 校验错 → 硬件强制终止' },
  };
  const info = TYPES[m.etype] || TYPES.page;
  const KINDS = [
    { key: 'fault', name: '故障（Fault）', src: '内部异常', when: '指令执行过程中检测到', ret: '重新执行**当前**指令', sig: '可恢复' },
    { key: 'trap', name: '自陷（Trap）', src: '内部异常', when: '由陷阱指令预先设定、执行中触发', ret: '执行**下一条**指令', sig: '程序有意安排' },
    { key: 'abort', name: '终止（Abort）', src: '内部异常', when: '硬件致命故障（总线错误、校验错）', ret: '程序**无法继续**，直接终止', sig: '不可恢复' },
  ];
  const steps = [
    { t: 'A1', by: '硬件', action: `检测到异常：${info.step}`, detail: '异常在**当前指令执行过程中**就被检测到（外中断要等指令执行结束才检测）。',
      say: () => `第 1 拍：${info.step}。注意**异常在当前指令执行过程中就检测到**，而外中断请求要等一条指令执行结束才采样——这是 2021-21 的判据。`,
      log: () => `A1 检测到异常：${info.step}` },
    { t: 'A2', by: '硬件（中断隐指令）', action: '关中断 → 保存断点 → 取异常处理程序入口',
      detail: '与中断完全一样，也是中断隐指令那 3 件；差别在**断点保存的是哪条指令的地址**。',
      say: () => `第 2 拍：关中断、保存断点、取处理程序入口（中断隐指令 3 件，与中断相同）。关键在断点：本类型保存的是**${info.retShort}**的地址。`,
      log: () => `A2 中断隐指令 3 件：断点 = ${info.retShort}（与中断相同，差别在返回点）` },
    { t: 'A3', by: '软件（异常处理程序）', action: `处理完毕，返回点 = ${info.ret}`,
      detail: info.why,
      say: () => `第 3 拍：异常处理程序做完，返回点是 **${info.ret}**。${info.why}`,
      log: () => `A3 返回点 = ${info.ret}（${info.name}）` },
  ];
  const st = { pc: 0x1040, if_: true, running: '用户程序', ret: info.ret };
  const clone = () => ({ pc: st.pc, if_: st.if_, running: st.running, ret: st.ret });
  const meta = steps.map((s, i) => ({ idx: i + 1, t: s.t, by: s.by, action: s.action, detail: s.detail }));
  const snaps = [];
  const frame = (kind, extra) => snaps.push(Object.assign({
    kind, scene: 'kind', total: steps.length, etype: m.etype, info: Object.assign({}, info),
    kinds: KINDS.map(k => Object.assign({}, k)), beats: meta.map(x => Object.assign({}, x)),
  }, clone(), extra));
  frame('init', {
    idx: 0, t: '—', by: '—', action: '（未开始）', detail: '', notes: [],
    desc: `就绪：${info.name}。三类内部异常的差别**只在返回哪条指令**——本类型处理后 ${info.ret}。共 3 拍。`,
    log: `就绪：${info.name}｜返回点 ${info.ret}`, logType: 'info',
  });
  steps.forEach((s, i) => {
    if (i === 1) { st.if_ = false; st.running = '异常处理程序（隐指令阶段）'; }
    if (i === 2) { st.if_ = true; st.running = info.key === 'abort' ? '已终止' : '用户程序'; }
    const last = i === steps.length - 1;
    frame('beat', {
      idx: i + 1, t: s.t, by: s.by, action: s.action, detail: s.detail, notes: [],
      desc: s.say(), log: s.log(), logType: info.key === 'abort' ? 'error' : (last ? 'success' : 'info'),
    });
  });
  frame('done', {
    idx: steps.length + 1, t: '完成', by: '—', action: '（异常处理完毕）', detail: '', notes: [],
    desc: `完成：${info.name} 的处理结束，返回点 = ${info.ret}。记住判据——**故障返回当前指令重新执行、自陷返回下一条指令、终止不返回**；三者都是**内部异常**，都不可以被屏蔽。`,
    log: `完成：${info.name}｜返回点 ${info.ret}${info.key === 'abort' ? '（程序终止）' : ''}`, logType: info.key === 'abort' ? 'error' : 'success',
  });
  return snaps;
}

RC408.registerModule({
  id: 'coa-interrupt',
  mode: 'stepper',
  title: '异常与中断机制（中断隐指令 · 故障与自陷 · 多重中断）',

  theory: `
> **为什么要有它**：CPU 要能"随时被外部设备打断、又能准确回到原处"，也要能处理自己执行中出的错（缺页、除零、系统调用）。搞清**哪些事由硬件自动做、哪些事由操作系统做、处理完回到哪条指令**，就抓住了这一章的全部考点。
> **怎么实现**：硬件用**中断隐指令**做 3 件（关中断 → 保存断点 → 取服务程序入口），软件在**中断服务程序**里做其余（保存现场 → 开中断 → 服务 → 关中断 → 恢复现场 → 开中断 → 中断返回）；**中断屏蔽字**决定谁能打断谁。
> **记住什么**：**中断隐指令 3 件** + **PC 由硬件保存、通用寄存器由软件保存** + **响应优先级由硬件排队器定、处理优先级由屏蔽字定** + **故障回当前指令、自陷回下一条**。

## 一、中断与异常的分类
| 类别 | 来源 | 能不能屏蔽 | 例子 |
| --- | --- | --- | --- |
| 外中断（可屏蔽） | CPU 外部，经 INTR | 能（受 IF 与屏蔽字影响） | 设备 I/O 完成、键盘 |
| 外中断（不可屏蔽 NMI） | CPU 外部，经 NMI | **不能**（关中断也响应） | 电源故障 |
| 内部异常：故障 Fault | CPU 内部 | **不能** | 缺页、除数为 0、非法操作码 |
| 内部异常：自陷 Trap | CPU 内部，由陷阱指令预先设定 | **不能** | 系统调用、断点、单步 |
| 内部异常：终止 Abort | CPU 内部，硬件致命故障 | **不能** | 总线错误、校验错 |

## 二、中断响应：中断隐指令（硬件做的 3 件，不是指令）
1. **关中断**（IF ← 0）：保证响应过程本身不被打断；
2. **保存断点**（PC 入栈）：断点 = 被中断处**下一条**指令的地址；
3. **取中断服务程序入口**（中断向量 → PC）：按中断类型号查**中断向量表**（表由操作系统初始化）。
- **中断隐指令不是指令**：它由硬件自动完成、程序员看不见、不在指令系统中。
- **PSW 归谁保存，真题有两种口径**：2016-44 的解析把"保护程序状态"算进响应阶段；2020-43 的解析把 PSW、屏蔽字、通用寄存器都归**中断服务程序**。答题看题目给的"硬件 / 软件分工"。
- **中断向量表由操作系统初始化**，硬件只负责"拿类型号去查表"。

## 三、中断服务程序（软件）：保护现场 → 开中断 → 服务 → 关中断 → 恢复现场 → 开中断 → 中断返回
- **顺序的道理**：保存现场**之后**才能开中断（先开就可能把没保存完的现场冲掉）；恢复现场**之前**必须关中断。
- **单重中断**：全程关中断，不响应任何新请求；**多重中断**：保存现场后开中断，允许更高优先级嵌套。
- 中断返回指令（IRET）与开中断 / 关中断指令都是**特权指令**，用户程序不能执行。

## 四、响应优先级与处理优先级（最容易记反）
- **响应优先级**：由**硬件排队电路**决定，同一时刻多个请求都到就按它选，**固定不变**；
- **处理优先级**：由**中断屏蔽字**决定，也就是"我正在处理时，谁能打断我"——**可编程**。
- 屏蔽字格式：每位对应一级中断，**1 = 屏蔽**。默认 A=1111、B=0111、C=0011、D=0001（A 级最高），含义是"高优先级服务程序中屏蔽所有低优先级"。
- 一个请求能被响应，要同时满足：**有请求** + **当前开中断** + **没被当前屏蔽字屏蔽** + **响应优先级高于当前正在处理的那一级**。

## 五、故障 / 自陷 / 终止：差别只在"返回哪条指令"
| 类型 | 触发方式 | 处理完返回到 |
| --- | --- | --- |
| 故障 Fault | 指令执行中检测到（缺页、除零、非法操作码） | **当前**指令，**重新执行** |
| 自陷 Trap | 陷阱指令**预先设定**（系统调用、断点、单步） | **下一条**指令 |
| 终止 Abort | 硬件致命故障（总线错误、校验错） | 不返回，直接终止 |

## 考点提醒（易错点）
1. **中断隐指令不是指令、也不在指令系统里**：关中断、保存断点、取服务程序入口这三件由**硬件**自动完成（2012-22、2026-22）。
2. **谁保存什么**：**PC（断点）由硬件（中断隐指令）保存**，**通用寄存器（现场）由操作系统 / 服务程序保存**（2015-23；2024-21 的 C 项"保存通用寄存器和设置新中断屏蔽字由软件实现"是**正确**叙述）。
3. **屏蔽字改的是"处理优先级"不是"响应优先级"**：2024-21 的错项就是"中断屏蔽字用于确定中断**响应**的优先级"；2020-21 的 D 项"可通过中断屏蔽字改变可屏蔽中断的**处理**优先级"才是对的。
4. **检测时机**：**中断请求**在**一条指令执行结束**时采样；**异常**在**当前指令执行过程中**就被检测到（2021-21 的题干、2020-21 的解析）。
5. **保护现场时关中断、执行服务程序时开中断**；单重中断全程关中断（2017-22 的错项就是把它说反；2024-21 的 D 项"单重中断方式下中断处理时 CPU 处于关中断状态"是对的）。
6. **内中断（异常）一律不可屏蔽**；外中断里 NMI 不可屏蔽、且**关中断时也响应**（2015-22 的 C 项、2020-21 的 A 项）。
7. **返回点是故障与自陷的唯一判据**：缺页 → 重新执行**当前**指令（2019-14 的错项正是"回到下一条"；2021-21 的正确叙述是"回到当前指令重新执行"）；系统调用 / 断点 → **下一条**指令（2020-18 的 D 项是正确叙述）。
8. **除零要小心**：多数教材把它算作故障（重新执行），但 2015-22 的解析认为它会"自动跳过、不返回当前指令"——**以题目给的机型为准**，别硬套。
9. **自陷是内部异常、不是外部中断**：2020-18 的错项就是"自陷是通过陷阱指令预先设定的一类**外部中断**事件"。
10. **开中断 / 关中断 / 中断返回都是特权指令**：所以**用户程序不能用关中断实现临界区互斥**（2021-43 第 3 问、2026-21）；向量中断方式的采用属于**指令集体系结构（ISA）**的规定（2026-16）。

> **真题考情**：**16/18 年（选 25 + 大题 6）**——只有 2013、2023 两年整卷未涉及。选：2009-22、2010-21、2011-19·21、2012-22·24、2014-22、2015-22·23·24、2016-22、2017-22、2018-22、2019-14、2020-18·20·21·25、2021-21·22、2022-31、2024-21·23、2026-17·22；大：2016-44（响应阶段三件事）、2018-43（中断响应时间判定）、2019-45(5)、2020-43（硬件与 OS 分工）、2021-43(3)（能否用关中断互斥）、2025-44(2)。
`,

  inputs: [
    {
      key: 'scene', label: '演示场景', type: 'select', default: 'seq', wide: true,
      options: [
        { v: 'seq', t: '① 外中断全过程逐拍（中断隐指令 3 件 + 服务程序 4 件，共 10 拍）' },
        { v: 'nest', t: '② 多重中断嵌套（4 个中断源 + 中断屏蔽字，看谁能打断谁）' },
        { v: 'kind', t: '③ 故障 / 自陷 / 终止（三类内部异常的返回点差别）' },
      ],
    },
    {
      key: 'masks', label: '中断屏蔽字（4 行 = A B C D 四级；每行 4 位，位序 A B C D，1 = 屏蔽）',
      type: 'textarea', rows: 4, wide: true, default: '1111\n0111\n0011\n0001',
      help: '只被场景②使用。默认值 = "高优先级服务程序屏蔽所有低优先级"：改某一位为 0，就能看到那一级能嵌套进来',
    },
    {
      key: 'etype', label: '异常类型（只被场景③使用）', type: 'select', default: 'page', wide: true,
      options: [
        { v: 'page', t: '缺页（故障 Fault → 重新执行当前指令）' },
        { v: 'divzero', t: '除数为 0（故障 Fault，机型相关 → 见考点提醒 8）' },
        { v: 'syscall', t: '系统调用（自陷 Trap → 执行下一条指令）' },
        { v: 'brk', t: '断点 / 单步（自陷 Trap → 执行下一条指令）' },
        { v: 'bus', t: '总线错误 / 校验错（终止 Abort → 不返回）' },
      ],
    },
  ],

  quickActions: [
    { label: '📘 教材例①：外中断全过程（隐指令 3 件 + 服务程序 4 件）', run(rt) { rt.setInput('scene', 'seq'); rt.load(); } },
    { label: '🎯 2016-44 / 2020-43 同款：哪几件事由硬件做、哪几件由 OS 做', run(rt) { rt.setInput('scene', 'seq'); rt.load(); } },
    { label: '🎯 2012-22 / 2015-23 同款：中断隐指令除保护断点外还做什么', run(rt) { rt.setInput('scene', 'seq'); rt.load(); } },
    { label: '🎯 2017-22 / 2024-21 同款：多重中断（默认屏蔽字 A=1111 B=0111 C=0011 D=0001）', run(rt) { rt.setInput('scene', 'nest'); rt.setInput('masks', '1111\n0111\n0011\n0001'); rt.load(); } },
    { label: '🎯 2011-21 同款：把 B 级屏蔽字的 A 位改成 1（A 不能打断 B ⇒ 嵌套消失）', run(rt) { rt.setInput('scene', 'nest'); rt.setInput('masks', '1111\n1111\n0011\n0001'); rt.load(); } },
    { label: '🎯 屏蔽字全 0：谁都能打断（极端可编程情形，与默认值对比看嵌套变多）', run(rt) { rt.setInput('scene', 'nest'); rt.setInput('masks', '0000\n0000\n0000\n0000'); rt.load(); } },
    { label: '🎯 2019-14 / 2021-21 同款：缺页是故障 ⇒ 返回当前指令重新执行', run(rt) { rt.setInput('scene', 'kind'); rt.setInput('etype', 'page'); rt.load(); } },
    { label: '🎯 2020-18 / 2026-17 同款：自陷 ⇒ 返回下一条指令', run(rt) { rt.setInput('scene', 'kind'); rt.setInput('etype', 'syscall'); rt.load(); } },
  ],

  parse(vals) {
    const scene = ['seq', 'nest', 'kind'].indexOf(vals.scene) >= 0 ? vals.scene : 'seq';
    /* 屏蔽字：4 行 × 4 位 0/1 */
    const lines = String(vals.masks == null ? '' : vals.masks).split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length !== 4) throw { message: `中断屏蔽字要 4 行（A、B、C、D 各一行），现在给了 ${lines.length} 行` };
    const masks = {};
    ['A', 'B', 'C', 'D'].forEach((src, i) => {
      if (!/^[01]{4}$/.test(lines[i])) throw { message: `${src} 级的屏蔽字「${lines[i]}」必须是 4 个 0/1（位序 A B C D，1 = 屏蔽）` };
      masks[src] = lines[i].split('').map(c => +c);
    });
    const etype = ['page', 'divzero', 'syscall', 'brk', 'bus'].indexOf(vals.etype) >= 0 ? vals.etype : 'page';
    const hx4 = v => v.toString(16).toUpperCase().padStart(4, '0');
    return { scene, masks, etype, hx: hx4, kind: 'ok', err: '' };
  },

  buildSnapshots(model) {
    if (model.scene === 'nest') return irBuildNest(model);
    if (model.scene === 'kind') return irBuildKind(model);
    return irBuildSeq(model);
  },

  render(ctx) {
    const { snap: s, model: m, stage } = ctx;
    const H = m.hx;
    const SRC = ['A', 'B', 'C', 'D'];

    const seqFlow = () => {
      const PH = ['中断请求', '判允许并响应', '关中断', '保存断点', '取服务程序入口', '保存现场·开中断', '执行服务程序', '关中断·恢复现场', '开中断·中断返回', '回到用户程序'];
      const cells = PH.map((p, i) => {
        const cur = s.kind === 'beat' && i === s.idx - 1;
        const hw = i >= 2 && i <= 4;
        const bc = cur ? '#4f46e5' : (hw ? '#c7d2fe' : '#e2e8f0');
        const bg = cur ? '#eef2ff' : (hw ? '#f5f7ff' : '#ffffff');
        return `<div class="ir-stage" data-stage="${i + 1}" style="border:1.5px solid ${bc};background:${bg};border-radius:8px;padding:4px 8px;font:600 11px system-ui;color:#3730a3;white-space:nowrap">
          <span style="color:#94a3b8">${i + 1}</span> ${p}<br><span style="color:#b45309;font-weight:500">${hw ? '硬件·中断隐指令' : (i >= 5 && i <= 8 ? '软件·服务程序' : '流程')}</span></div>`;
      });
      return `<div style="display:flex;flex-wrap:wrap;gap:6px">${cells.join('')}</div>`;
    };
    const stackBox = () => {
      const cells = s.stack.map((x, i) => `<div class="ir-frame" data-slot="${x.label}" style="border:1.5px solid #e2e8f0;background:#fff;border-radius:6px;padding:2px 8px;font:600 11px Consolas,monospace;min-width:190px;box-sizing:border-box">
        <span style="color:#94a3b8">${x.label}</span> <span style="color:#0f172a">${x.value}</span></div>`);
      const empty = `<div class="ir-frame-empty" style="border:1.5px dashed #e2e8f0;background:#fafafa;border-radius:6px;padding:2px 8px;font:600 11px system-ui;color:#cbd5e1;min-width:190px;box-sizing:border-box">（栈空）</div>`;
      return `<div style="display:flex;flex-direction:column;gap:5px">${s.stack.length ? cells.join('') : empty}</div>`;
    };
    const regBox = () => {
      const P = (n, v) => `<div class="ir-reg" data-reg="${n}" style="display:flex;justify-content:space-between;gap:12px;border:1.5px solid #e2e8f0;background:#fff;border-radius:8px;padding:3px 8px;font:600 12px Consolas,monospace;min-width:150px;box-sizing:border-box">
        <span style="color:#475569">${n}</span><span style="color:#0f172a">${v}</span></div>`;
      return [P('PC', H(s.pc)), P('IF', s.if_ ? '1（开中断）' : '0（关中断）'), P('SP', H(s.sp)),
        P('R0', H(s.r0)), P('R1', H(s.r1)), P('PSW', s.psw), P('当前优先级', String(s.prio)), P('当前运行', s.running)].join('');
    };

    const nestTimeline = () => {
      const all = s.allBeats || [];
      const rows = ['main'].concat(SRC);
      const name = x => x === 'main' ? '主程序' : x + ' 服务程序';
      const head = all.map(b => `<div style="width:13px;text-align:center;font:500 8px system-ui;color:#94a3b8">${b.idx % 5 === 0 ? b.idx : ''}</div>`).join('');
      const lanes = rows.map(rk => {
        const cells = all.map(b => {
          const inStack = rk === 'main' ? true : b.levels.some(l => l.indexOf(rk + ' ') === 0);
          const running = rk === 'main' ? b.cur === 'main' : b.cur === rk;
          const bg = running ? '#4f46e5' : (inStack ? '#fde68a' : '#f8fafc');
          return `<div class="ir-cell${running ? ' ir-cell-run' : ''}" data-t="${b.idx}" data-prog="${rk}" style="width:13px;height:15px;border-radius:2px;background:${bg};border:1px solid #eef2f7"></div>`;
        }).join('');
        return `<div class="ir-lane" data-prog="${rk}" style="display:flex;gap:6px;align-items:center;margin-top:3px">
          <div style="width:96px;font:600 10px system-ui;color:#475569;white-space:nowrap;text-align:right">${name(rk)}</div>
          <div style="display:flex;gap:2px">${cells}</div></div>`;
      }).join('');
      return `<div style="overflow-x:auto"><div style="display:inline-block">
        <div style="display:flex;gap:6px;align-items:center">
          <div style="width:96px"></div><div style="display:flex;gap:2px">${head}</div></div>
        ${lanes}
      </div></div>
      <div style="font:500 10px system-ui;color:#94a3b8;margin-top:4px">
        <span style="color:#4f46e5">■</span> 正在运行　<span style="color:#fde68a">■</span> 已在嵌套栈里（被更高优先级挂起）　<span style="color:#f8fafc;border:1px solid #e2e8f0">■</span> 尚未进入
      </div>`;
    };
    const maskTable = () => {
      const rows = (s.maskRows || []).map(r => {
        const bits = r.mask.map((b, i) => `<span class="ir-mask" data-bit="${SRC[i]}" style="display:inline-block;width:18px;text-align:center;font:700 12px Consolas,monospace;color:${b ? '#b91c1c' : '#047857'}">${b}</span>`).join('');
        const blocked = SRC.filter((x, i) => r.mask[i] === 1).join('/') || '（谁都不屏蔽）';
        const live = s.cur === r.src && s.kind === 'beat';
        return `<tr class="ir-maskrow${live ? ' ir-maskrow-cur' : ''}" style="background:${live ? '#eef2ff' : 'transparent'}">
          <td style="padding:2px 8px;font-weight:700">${r.src} 级</td>
          <td style="padding:2px 8px">${bits}</td>
          <td style="padding:2px 8px;color:#64748b">${r.text}｜屏蔽：${blocked}</td></tr>`;
      }).join('');
      return `<table class="w-full text-sm" style="border-collapse:collapse">
        <thead><tr style="color:#94a3b8;font-size:11px">
          <th style="text-align:left;padding:2px 8px">中断源</th>
          <th style="text-align:left;padding:2px 8px">屏蔽字 A B C D</th>
          <th style="text-align:left;padding:2px 8px">这一级在服务时，屏蔽了谁</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    };
    const kindTable = () => {
      const rows = (s.kinds || []).map(k => {
        const live = s.info && s.info.key === k.key;
        return `<tr class="ir-kind" data-kind="${k.key}" style="background:${live ? '#eef2ff' : 'transparent'};${live ? 'font-weight:700' : ''}">
          <td style="padding:2px 8px">${k.name}</td>
          <td style="padding:2px 8px;color:#64748b">${k.src}｜${k.when}</td>
          <td style="padding:2px 8px;color:#b91c1c">${k.ret}</td>
          <td style="padding:2px 8px;color:#64748b">${k.sig}</td></tr>`;
      }).join('');
      return `<table class="w-full text-sm" style="border-collapse:collapse">
        <thead><tr style="color:#94a3b8;font-size:11px">
          <th style="text-align:left;padding:2px 8px">类型</th><th style="text-align:left;padding:2px 8px">来源与触发</th>
          <th style="text-align:left;padding:2px 8px">处理完返回到</th><th style="text-align:left;padding:2px 8px">可否恢复</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    };

    const tableRows = (s.beats || []).map(b => {
      const cur = b.idx === s.idx;
      return `<tr class="ir-seq${cur ? ' ir-cur' : ''}" style="background:${cur ? '#eef2ff' : 'transparent'};${cur ? 'font-weight:700' : ''}">
        <td style="padding:2px 8px;color:#475569">${b.t}</td>
        <td style="padding:2px 8px;color:#b45309;white-space:nowrap">${b.by}</td>
        <td style="padding:2px 8px">${b.action}</td>
        <td style="padding:2px 8px;color:#64748b">${b.detail || ''}</td></tr>`;
    }).join('');

    const cards = s.scene === 'seq'
      ? RC408.ui.statCard('当前拍', s.kind === 'init' ? '0 / ' + s.total : s.idx + ' / ' + s.total,
          s.kind === 'beat' ? s.t + '：' + s.action.slice(0, 16) : (s.kind === 'done' ? '处理完毕' : '尚未开始'), 'text-indigo-600')
        + RC408.ui.statCard('由谁完成', s.by || '—', s.t ? '' : '', 'text-amber-600')
        + RC408.ui.statCard('中断允许标志 IF', s.if_ ? '1（开中断）' : '0（关中断）', '关中断是中断隐指令第 1 件', s.if_ ? 'text-emerald-600' : 'text-rose-600')
        + RC408.ui.statCard('栈深度 / SP', s.stack.length + ' / ' + H(s.sp), '断点与现场都压在这里', 'text-slate-800')
      : s.scene === 'nest'
        ? RC408.ui.statCard('当前运行', s.cur === 'main' ? '主程序' : s.cur + ' 的服务程序', '第 ' + s.idx + ' / ' + s.total + ' 拍', 'text-indigo-600')
          + RC408.ui.statCard('嵌套深度', String(s.depth), s.depth >= 2 ? '★ 已发生嵌套' : '未嵌套', s.depth >= 2 ? 'text-rose-600' : 'text-slate-800')
          + RC408.ui.statCard('当前屏蔽字', (s.mask || []).join(''), '位序 A B C D，1 = 屏蔽', 'text-amber-600')
          + RC408.ui.statCard('待处理请求', (s.pending || []).join(' / ') || '（无）', '已请求但没被响应的', (s.pending || []).length ? 'text-rose-600' : 'text-slate-400')
        : RC408.ui.statCard('异常类型', s.info ? s.info.name : '—', '第 ' + s.idx + ' / ' + s.total + ' 拍', 'text-indigo-600')
          + RC408.ui.statCard('返回点', s.info ? s.info.ret : '—', '★ 三类异常的判据就在这一栏', 'text-rose-600')
          + RC408.ui.statCard('可否屏蔽', '不可屏蔽', '内中断（异常）一律不能被屏蔽', 'text-emerald-600')
          + RC408.ui.statCard('检测时机', '指令执行过程中', '外中断要等指令执行结束', 'text-amber-600');

    const body = s.scene === 'seq'
      ? `<div class="rounded-2xl border border-slate-200 bg-white p-3">
           ${RC408.ui.sectionTitle('中断处理流程（浅蓝 = 中断隐指令，由硬件完成；白底 = 服务程序，由软件完成）')}
           ${seqFlow()}
           <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;align-items:flex-start">
             <div style="display:flex;flex-direction:column;gap:5px">${regBox()}</div>
             <div style="display:flex;flex-direction:column;gap:5px">
               <div style="font:600 11px system-ui;color:#94a3b8">主存栈区（栈顶在上）</div>
               ${stackBox()}
             </div>
           </div>
         </div>`
      : s.scene === 'nest'
        ? `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start">
             <div class="rounded-2xl border border-slate-200 bg-white p-3" style="flex:1 1 460px;min-width:420px">
               ${RC408.ui.sectionTitle('嵌套时间轴（横轴 = 拍；蓝 = 正在运行，黄 = 已在嵌套栈里被挂起）')}
               ${nestTimeline()}
             </div>
             <div class="rounded-2xl border border-slate-200 bg-white p-3" style="flex:1 1 380px;min-width:360px">
               ${RC408.ui.sectionTitle('中断屏蔽字（当前运行那一级高亮）')}
               ${maskTable()}
               <div style="font:500 11px system-ui;color:#64748b;margin-top:6px;line-height:1.6">
                 响应优先级（硬件排队电路，固定）：<b>A &gt; B &gt; C &gt; D</b><br>
                 处理优先级（屏蔽字决定，可编程）：把某一位改成 0，那一级就能在服务期间打断进来。
               </div>
             </div>
           </div>`
        : `<div class="rounded-2xl border border-slate-200 bg-white p-3">
             ${RC408.ui.sectionTitle('三类内部异常对照（当前类型高亮）；外中断的可屏蔽性见下方考点提醒')}
             ${kindTable()}
             <div style="font:500 11px system-ui;color:#64748b;margin-top:8px;line-height:1.6">
               本场景选中：<b>${s.info ? s.info.name : ''}</b>｜返回点 <b style="color:#b91c1c">${s.info ? s.info.ret : ''}</b><br>
               依据：${s.info ? s.info.eg : ''}
             </div>
           </div>`;

    stage.innerHTML = `
      <div class="space-y-4">
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>
        ${body}
        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('逐拍状态迁移表（当前拍高亮）')}
          <table class="w-full text-sm" style="border-collapse:collapse">
            <thead><tr style="color:#94a3b8;font-size:11px">
              <th style="text-align:left;padding:2px 8px">拍</th><th style="text-align:left;padding:2px 8px">由谁完成</th>
              <th style="text-align:left;padding:2px 8px">动作</th><th style="text-align:left;padding:2px 8px">说明</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>① <b>中断隐指令 3 件（硬件）</b>＝关中断、保存断点、取服务程序入口，它<b>不是指令</b>、不在指令系统里；
          ② <b>PC（断点）由硬件保存，通用寄存器（现场）由操作系统保存</b>；
          ③ <b>响应优先级由硬件排队电路定（固定），屏蔽字改的是处理优先级</b>——2024-21 的错项就是把这两个说反；
          ④ <b>异常在当前指令执行过程中检测，中断请求在一条指令执行结束后才采样</b>；
          ⑤ <b>保护现场时关中断、执行服务程序时开中断</b>（单重中断全程关中断）；
          ⑥ 返回点：<b>故障回当前指令重新执行、自陷回下一条指令、终止不返回</b>；内中断一律<b>不可屏蔽</b>；
          ⑦ 开中断 / 关中断 / 中断返回都是<b>特权指令</b>，用户程序不能用来做临界区互斥。
        </div>
      </div>`;
  },
});
