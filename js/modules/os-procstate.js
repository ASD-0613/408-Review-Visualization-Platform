'use strict';
/* ============================================================================
 * os-procstate.js —— 【操作系统】进程状态转换（五态模型）（前缀 _ps）
 *
 * 考情（**窗58 回 `考情缓存/` 逐题核对后就地改正，旧文案写"12/18 年、全为选择题、每年就是'下列迁移哪个
 * 不可能发生'这一问"—— 前两条不准、第三条 0 题命中**）：登记口径仍按 `js/exam-history.js`（保持 12 个年份
 * 不变、火苗不动），但其逐题问法实际分成三类 ——
 *   ① 状态/队列转换（6 题）：2014-26 读盘完成后改就绪态、2015-25 哪个操作进阻塞态、2018-27 执行→阻塞、
 *      2019-24 哪些事件能唤醒、2022-28 执行→阻塞、2023-27 线程执行→就绪；
 *   ② 创建与终止（3 题）：2010-24 哪些操作会创建新进程、2021-24 创建新进程必须完成的操作、
 *      2024-24 终止进程时不一定执行的操作；
 *   ③ 同章相邻考点（7 题，靠状态判对错但不以状态为主线）：2010-26 何时降低优先级、2012-30 调度时机、
 *      2017-27 时间片用完该去哪（错项就说"→阻塞"）、2020-29 父子进程与 PCB、2021-27 何时引起调度、
 *      2024-25 进程切换要更新哪些寄存器、2024-28 同进程两线程可共享什么。
 *  ⟹ theory 因此按"**事件 → 进哪个状态/队列**"这个真实问法组织（并补一张 20 问的速查表），
 *     而不是按"哪种迁移不可能"组织。**挂起态 / 七态模型全缓存 0 命中 ⟹ 正文不写。**
 * 快照：每次状态迁移一帧——五态图高亮迁移边，记录各进程当前状态 + 三个队列（运行轨 / 就绪 / 阻塞）。
 * 事件写法（parse 支持）：调度X / X时间片用完 / X被抢占 / X请求I/O / I/O完成唤醒X /
 * X创建完成 / X终止。（事件内部别写全角逗号或分号——那是事件分隔符。）
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 数据模型（先把"量"钉死，再写实现）
 * ---------------------------------------------------------------------------
 *   states : { 进程名 -> 五态之一 }   五态 = 创建 / 就绪 / 运行 / 阻塞 / 终止
 *   队列（**由 states 派生，不单独存** —— 同一个状态在两处各判一次就会不一致）：
 *     运行轨  run      : 该进程（单处理机 ⟹ 至多 1 个）
 *     就绪队列 ready   : 顺序数组（队首在前）
 *     阻塞队列 blocked : 顺序数组
 *   每帧快照额外携带（渲染只读快照，不回查 model）：
 *     qmove     : { proc, from, to, op, pos, illegal } —— 本帧那次迁移对队列做了什么
 *                 op ∈ 入队尾 / 入队首 / 上 CPU / 下 CPU / —（非法事件不动作）
 *                 pos ∈ 队首 / 队首(唤醒) / 队尾 / 第N位出队 / 释放资源 / —
 *     preempted : { proc, from, to, op, pos } —— 单处理机上"被本次调度换下"的那个进程（没有则 null）
 *     ev        : { kind, name, raw }
 *     legal / log / logType / desc / step
 *
 * 不变量（P3 冒烟逐帧断言，见 tmp_t58_smoke.js）：
 *   I1  运行轨至多 1 个进程（单处理机）；
 *   I2  就绪队列 ∪ 阻塞队列 ∪ 运行轨 = 出现过的进程全集，两两不交；
 *   I3  就绪队列 / 阻塞队列内无重复名；
 *   I4  每个进程的状态与它所在的队列自洽（就绪 ⟺ 在 ready 里，阻塞 ⟺ 在 blocked 里）；
 *   I5  就绪队列的排队顺序可解释：新建 → 入队尾；唤醒 → 入队首（标"唤醒"）；
 *       被换下 → 入队尾。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-procstate',
  mode: 'stepper',
  title: '进程状态转换（五态模型）',

  theory: `
> **为什么要有它**：进程要等 I/O、等 CPU，不可能一直占着处理机——必须用状态描述"它此刻在等什么"，用队列描述"它在哪儿排队"。
> **怎么实现**：五态模型 + 一张"谁能把它推到哪"的迁移表；每次迁移都同时改变**状态**与**队列位置**，由创建 / 终止 / 阻塞 / 唤醒四个原语推动。
> **记住什么**：分清**谁触发**（进程自身 / 调度程序 / 中断）与**去哪个队列**，并记住三条不存在的迁移、创建与终止各做什么、切换要保存哪些现场。

## 五态模型与合法迁移

| 从 → 到 | 触发事件 | 谁触发 | 队列动作 |
| --- | --- | --- | --- |
| 创建 → 就绪 | 进程创建完成（PCB 建好） | 系统调用 | 排入**就绪队列队尾** |
| 就绪 → 运行 | 被调度程序选中 | 调度程序 | 离开就绪队列，**上 CPU** |
| 运行 → 就绪 | 时间片用完 / 被高优先级进程抢占 / 主动出让 CPU | 时钟中断 / 调度程序 | **下 CPU**，回**就绪队列** |
| 运行 → 阻塞 | 主动请求等待（I/O、wait、申请资源） | **进程自身** | 离开运行态，排入**阻塞队列** |
| 阻塞 → 就绪 | 等待的事件完成（I/O 完成、被唤醒） | **中断 / 其他进程** | 离开阻塞队列，进**就绪队列队首** |
| 运行 → 终止 | exit / 异常 | 进程自身 | 释放资源（PCB 待回收） |

## 三个队列：状态是"在等什么"，队列是"在哪儿等"

| 队列 | 装哪些状态 | 谁把它放进去 | 谁把它取出来 |
| --- | --- | --- | --- |
| 就绪队列 | 就绪（含刚创建、刚被唤醒） | 创建完成 / 时间片用完 / 被抢占 / 事件完成 | **调度程序** |
| 阻塞队列（每类事件一条） | 阻塞 | 进程**自己**请求等待 | **中断处理程序**（事件完成） |
| 运行轨（CPU） | 运行 | 调度程序 | 时间片用完 / 主动等待 / 终止 |

- **运行轨只坐一个**：单处理机上任何时刻**只有一个**运行态进程——所以"两个进程同时运行"必错。
- **唤醒 ≠ 立刻运行**：事件完成只把进程从"阻塞队列"搬到"就绪队列队首"，能不能上 CPU 要等**调度程序**再选它一次。
- **换下 ≠ 终止**：被抢占或被换下只是回到就绪队列等下一次调度，资源一个都没释放。

## 进程控制：创建、终止、阻塞与唤醒

- **原语**：进程控制动作由**原语**完成——执行期间不可中断（关中断保证原子性），所以"在中断处理中 / 执行原语时"不能切换进程。
- **创建进程要做的四件事**：申请一个**空白 PCB** → 分配资源 → **初始化 PCB**（置 PID、优先级，状态置为**就绪**）→ 插入就绪队列。⚠ 创建完成是"就绪"不是"执行"：把状态置为执行态是错项（2021-24）。
- **会引起创建的事件**：用户登录、作业调度、系统提供服务、应用请求；**设备分配不会创建进程**（2010-24 的错项）。
- **终止进程**：正常结束或异常（越界、非法指令、运行超时）→ 回收它占用的资源 → **撤销 PCB**。
- **父进程终止不强制终止子进程**：子进程成为**孤儿进程**，由 init（Linux 的 1 号进程）接管，资源与 PCB 由系统照常回收（2024-24）。
- **父子进程的关系**：可以并发执行、可以共享一部分资源，但**各有独立的虚拟地址空间和独立的 PCB**——"父子共享虚拟地址空间"是错项（2020-29）。
- **阻塞 / 唤醒的发起者不同**：阻塞由进程**自己**调用（请求 I/O、申请资源、P 操作失败）；唤醒由**别的进程或中断**做（I/O 完成、别的进程退出临界区执行 V）。

## 进程切换：保存什么、开销在哪

- **切换时要保存 / 恢复的现场**：程序计数器 PC、通用寄存器、PSW、栈指针、**页表基址寄存器**（2024-25）——它们共同决定"回来时从哪条指令、用哪套地址空间继续跑"。
- **进程切换 ≠ 模式切换**：同一进程内由系统调用陷入内核只换态不换进程；只有换掉当前占用 CPU 的进程才叫进程切换。
- **开销**：切换的次数越多、总开销越大；时间片太小会让切换过于频繁，开销占比上升（2017-27）。
- **可能触发切换的事件**：中断 / 异常 / 系统调用 / 时间片用完。

## 真题最爱的四种错法

1. **阻塞 → 运行不存在**：被唤醒后必须先回到就绪队列，**再等调度**——哪怕它优先级最高也一样；
2. **就绪 → 阻塞不存在**：就绪态进程**没占用 CPU**，谈不上"等待事件完成"；
3. **时间片用完是 运行 → 就绪**（不是阻塞）；**请求 I/O 是 运行 → 阻塞**（不是就绪）；
4. **只有运行态能自己"动"**：请求 I/O、终止、时间片用完都只发生在运行态进程身上。

## 问法速查：这些操作各把进程推到哪

| 题目里这么问 | 起点 → 终点 | 为什么 |
| --- | --- | --- |
| 等待 I/O、读文件、申请外设、wait / P 操作、等待键盘输入 | 运行 → 阻塞 | 进程**主动**请求等待，进阻塞队列 |
| I/O 完成中断、等待的事件完成、被其他进程唤醒 | 阻塞 → 就绪 | 由**中断 / 别的进程**引发，进就绪队列队首 |
| 时间片用完、被剥夺处理机、主动出让 CPU | 运行 → 就绪 | 交出 CPU 但**没在等任何事件**，回就绪队列 |
| 调度程序选中 | 就绪 → 运行 | 唯一能上 CPU 的入口 |
| 创建完成（PCB 建好） | 创建 → 就绪 | 进就绪队列等调度——创建后**不直接**进运行态 |
| exit、执行结束、运行出错 | 运行 → 终止 | 撤销进程、释放资源 |
| 用户登录、作业调度、启动程序执行 | 无 → 创建 | 这些都是**创建新进程的时机** |
| 某进程释放了一台打印机、退出临界区 | 阻塞 → 就绪 | 等资源的进程被唤醒 |
| 正在运行的进程申请内存失败 | 运行 → 终止 | 异常终止 |

另有一组问法集中在**创建、终止与切换**上：

| 题目里这么问 | 答什么 | 依据 |
| --- | --- | --- |
| 创建新进程时必须完成什么 | 申请空白 PCB、初始化 PCB、置为**就绪** | 置为执行态是错的（2021-24） |
| 父进程被终止，子进程会怎样 | 不被强制终止，成孤儿进程由 init 接管 | 终止只回收自己的资源与 PCB（2024-24） |
| 进程切换时要恢复哪些寄存器 | PC、通用寄存器、栈指针、页表基址 | 都是"下一条指令从哪继续"的现场（2024-25） |
| 哪些事件会引起进程调度 | 中断处理结束、进程阻塞、进程结束、时间片用完 | 都让"该选一个就绪进程"成立（2021-27） |

> **真题考情**：**12/18 年**（2010-24·26、2012-30、2014-26、2015-25、2017-27、2018-27、2019-24、
> 2020-29、2021-24·27、2022-28、2023-27、2024-24·25·28）——状态迁移之外，创建 / 终止 / 切换各考过一轮。
`,

  inputs: [
    { key: 'event', label: '事件序列（每行/逗号一个；写法见提示与预设）', type: 'textarea', rows: 4, wide: true,
      default: 'P1创建完成, 调度P1, P2创建完成, P1时间片用完, 调度P2, P2请求I/O, 调度P1, I/O完成唤醒P2, P1终止',
      help: '支持：调度X ｜ X时间片用完 ｜ X被抢占 ｜ X请求I/O ｜ I/O完成唤醒X ｜ X创建完成 ｜ X终止' },
  ],

  /* ---------------- 预设场景（每个都能被实测校验：冒烟按"帧数 / 帧序 / 末帧状态"逐条断言） ----------------
     ★ 每条预设的期望都写死在 §6.2.58 的冒烟表里；改事件序列必须同步改那张表。
     事件上限 14（parse 校验），下面每条都实算过事件数。 */
  quickActions: [
    { label: '🟢 单进程走一遍（创建 → 调度 → 请求 I/O → 唤醒 → 终止）', run(rt) {
      rt.setInput('event', 'P1创建完成, 调度P1, P1请求I/O, I/O完成唤醒P1, 调度P1, P1终止'); rt.load(); } },
    { label: '⏱ 时间片轮转（两进程轮流上 CPU，时间片用完回就绪队列）', run(rt) {
      rt.setInput('event', 'P1创建完成, 调度P1, P2创建完成, P1时间片用完, 调度P2, P2终止'); rt.load(); } },
    { label: '⚡ 被抢占（高优先级进程一就绪，运行态进程就下 CPU 回就绪队列）', run(rt) {
      rt.setInput('event', 'P1创建完成, 调度P1, P2创建完成, P1被抢占, 调度P2, P2终止'); rt.load(); } },
    { label: '💤 阻塞 → 就绪：唤醒的进程排到就绪队列队首（仍要等调度）', run(rt) {
      rt.setInput('event', 'P1创建完成, 调度P1, P2创建完成, P1请求I/O, I/O完成唤醒P1'); rt.load(); } },
    { label: '🔁 被唤醒后立刻调度（队列顺序变：唤醒者排到队首，先于原本的第一位）', run(rt) {
      rt.setInput('event', 'P1创建完成, 调度P1, P2创建完成, P1请求I/O, 调度P2, I/O完成唤醒P1, 调度P1'); rt.load(); } },
    { label: '⛔ 阻塞 → 运行不存在（在阻塞队列里点"调度"，看它被拦在哪一步）', run(rt) {
      rt.setInput('event', 'P1创建完成, 调度P1, P1请求I/O, 调度P1'); rt.load(); } },
    { label: '🔀 多道并发（三个进程 + 一条 I/O 队列，看三个队列同时装谁）', run(rt) {
      rt.setInput('event', 'P1创建完成, P2创建完成, P3创建完成, 调度P1, P1请求I/O, 调度P2, P2终止, I/O完成唤醒P1, 调度P1'); rt.load(); } },
    { label: '🚫 就绪 → 阻塞不存在（没占 CPU 的进程无从"主动等待"）', run(rt) {
      rt.setInput('event', 'P1创建完成, P1请求I/O, 调度P1'); rt.load(); } },
  ],

  parse(vals) {
    const events = vals.event.split(/[,，;；\n]+/).map(x => x.trim()).filter(Boolean).map(e => {
      let m;
      if ((m = e.match(/^调度\s*(\S+)$/))) return { kind: 'dispatch', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)时间片用完$/))) return { kind: 'slice', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)被抢占$/))) return { kind: 'preempt', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)请求I\/?O$/i))) return { kind: 'io-wait', name: m[1], raw: e };
      if ((m = e.match(/^I\/?O完成.*?唤醒\s*(\S+)$/))) return { kind: 'io-done', name: m[1], raw: e };
      if ((m = e.match(/^唤醒\s*(\S+)$/))) return { kind: 'io-done', name: m[1], raw: e };
      /* "I/O完成 X就绪" 与 "I/O完成X就绪" 两种都要认：分隔符是**可选的**。
         ⚠ 别指望用户在事件里写逗号/分号——它们在本模块就是**事件分隔符**（上一行的 split），
           写 "I/O完成，P1就绪" 会被切成两条事件。写空格或直接连写。 */
      if ((m = e.match(/^I\/?O完成\s*(\S+?)\s*就绪$/))) return { kind: 'io-done', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)创建完成$/))) return { kind: 'new', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)(?:运行出错)?终止$/))) return { kind: 'exit', name: m[1], raw: e };
      throw { message: `事件「${e}」无法解析。支持：调度X / X时间片用完 / X被抢占 / X请求I/O / I/O完成唤醒X / X创建完成 / X终止` };
    });
    if (!events.length) throw { message: '请输入至少一个事件' };
    if (events.length > 14) throw { message: '事件最多 14 个（当前 ' + events.length + ' 个，请删掉一些）' };
    return { events };
  },

  buildSnapshots(model) {
    const { events } = model;
    /* 唯一状态源：states。三个队列/运行轨全部由它派生（§3.8-15：同一状态别判两次） */
    const states = {};
    const snaps = [];

    /* 插入序即队列序：维护两张顺序表，入队按策略 push（队尾）/ unshift（队首·唤醒） */
    const qReady = [], qBlock = [];

    const snapState = () => ({
      states: { ...states },
      ready: qReady.slice(), blocked: qBlock.slice(),
      run: Object.keys(states).filter(n => states[n] === '运行')[0] || null,
    });
    /* 自查（I2/I3/I4）：队列与 states 必须互相解释得通 —— 不自洽就在帧文案里点名 */
    const consistent = () => {
      const byState = st => Object.keys(states).filter(n => states[n] === st).sort();
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      return same(qReady.slice().sort(), byState('就绪'))
        && same(qBlock.slice().sort(), byState('阻塞'))
        && byState('运行').length <= 1
        && new Set(qReady).size === qReady.length && new Set(qBlock).size === qBlock.length;
    };

    const push = (step, ev, legal, note, logType, extra) => snaps.push(Object.assign({
      step, ev: ev ? { ...ev } : null, legal, log: (legal ? '✓ ' : '✗ ') + note,
      logType, desc: note, qmove: null, preempted: null,
    }, snapState(), extra || {}));

    push('init', null, true, '五态模型就绪：三个队列都是空的，先创建进程。观察每次事件把谁推到哪个队列。', 'info');

    events.forEach(ev => {
      let legal = true, note = '', qmove = null, preempted = null;
      const name = ev.name, st = states[name];
      switch (ev.kind) {
        case 'new':
          if (st) { legal = false; note = `${name} 已存在（当前 ${st}），不能重复创建`; break; }
          states[name] = '就绪'; qReady.push(name);
          qmove = { proc: name, from: '创建', to: '就绪', op: '入队尾', pos: '队尾' };
          note = `${name} 创建完成：创建 → 就绪，排入就绪队列队尾`;
          break;
        case 'dispatch':
          if (st !== '就绪') {
            legal = false;
            note = st === '运行' ? `${name} 已经在运行态，不能重复调度`
              : st === '阻塞' ? `${name} 在阻塞态，必须先被唤醒回到就绪队列才能被调度`
                : `${name} 当前是 ${st || '不存在'}，只有就绪态进程能被调度`;
            if (st === '阻塞') qmove = { proc: name, from: '阻塞', to: '运行', op: '—', pos: '—', illegal: true };
            break;
          }
          {
            /* ★ 单处理机：运行轨只有一个座。若已有别人在运行，本次调度必须先把**它**请下 CPU
               （教科书里"调度 P2"就意味着 P1 被换下）——否则 P1 会从三个去处里同时消失（本窗冒烟抓到）。 */
            const prev = Object.keys(states).filter(n => states[n] === '运行')[0];
            if (prev) {
              states[prev] = '就绪';
              qReady.push(prev);
              preempted = { proc: prev, from: '运行', to: '就绪', op: '入队尾', pos: '队尾（被换下）' };
            }
            states[name] = '运行';
            const at = qReady.indexOf(name); qReady.splice(at, 1);
            qmove = { proc: name, from: '就绪', to: '运行', op: '上 CPU', pos: '第' + (at + 1) + '位出队' };
            note = `调度程序选中 ${name}：就绪 → 运行（离开就绪队列，占用 CPU）`
              + (prev ? `；同时把正在运行的 ${prev} 换下 CPU（运行 → 就绪，回就绪队列队尾）` : '');
          }
          break;
        case 'slice':
        case 'preempt':
          {
            const isSlice = ev.kind === 'slice';
            if (st !== '运行') {
              legal = false;
              note = `${name} 不在运行态（当前 ${st || '不存在'}），${isSlice ? '无从"时间片用完"' : '无从"被抢占"'}`;
              break;
            }
            states[name] = '就绪'; qReady.push(name);
            qmove = { proc: name, from: '运行', to: '就绪', op: '入队尾', pos: '队尾' };
            note = isSlice
              ? `${name} 时间片用完：运行 → 就绪，回就绪队列队尾（注意：不是阻塞！）`
              : `${name} 被更高优先级进程抢占：运行 → 就绪，回就绪队列队尾`;
          }
          break;
        case 'io-wait':
          if (st !== '运行') {
            legal = false;
            note = st === '就绪'
              ? `${name} 在就绪态（没占用 CPU），无从"主动等待" —— 就绪 → 阻塞不存在`
              : `${name} 不在运行态（当前 ${st || '不存在'}），只有运行态进程能主动请求等待`;
            break;
          }
          states[name] = '阻塞'; qBlock.push(name);
          qmove = { proc: name, from: '运行', to: '阻塞', op: '入队尾', pos: '队尾' };
          note = `${name} 主动请求 I/O：运行 → 阻塞，进入阻塞队列（进程自身行为）`;
          break;
        case 'io-done':
          if (st !== '阻塞') {
            legal = false;
            note = `${name} 不在阻塞态（当前 ${st || '不存在'}），无需唤醒`;
            break;
          }
          states[name] = '就绪'; qBlock.splice(qBlock.indexOf(name), 1); qReady.unshift(name);
          qmove = { proc: name, from: '阻塞', to: '就绪', op: '入队首', pos: '队首(唤醒)' };
          note = `${name} 等待的事件完成：阻塞 → 就绪，进就绪队列队首（仍要等调度，不能直接运行）`;
          break;
        case 'exit':
          if (st !== '运行') {
            legal = false;
            note = `${name} 当前是 ${st || '不存在'}，只有运行态进程能主动终止`;
            break;
          }
          states[name] = '终止';
          qmove = { proc: name, from: '运行', to: '终止', op: '下 CPU', pos: '释放资源' };
          note = `${name} 运行结束（exit）：运行 → 终止，释放全部资源`;
          break;
        default: legal = false; note = '未知事件';
      }
      if (!consistent()) note += '（内部自查：状态与队列不自洽）';
      push('event', ev, legal, note, legal ? 'success' : 'error', { qmove, preempted });
    });

    push('done', null, true,
      '演示结束。回看四条：阻塞不能直接去运行、就绪不能去阻塞、时间片用完回就绪、唤醒后仍要等调度。',
      'success');
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    const idx = ctx.idx, total = ctx.total;
    /* 五态图布局（教材经典画法）：
       就绪⇄运行 用上下两条弧分离双向边；运行→阻塞、阻塞→就绪 走左右两条斜线互不交叉；
       不存在的"阻塞→运行"画成右侧红色虚线短箭头示意 */
    const pos = { 创建: [80, 70], 就绪: [250, 70], 运行: [450, 70], 终止: [640, 70], 阻塞: [360, 215] };
    const curEv = s.ev;
    const kind = curEv ? curEv.kind : null;
    /* 帧内该高亮的边：合法事件高亮它自己那条；非法事件高亮"它想走却没走成"的那条 */
    const qm = s.qmove;
    const highlight = (kind === 'slice' || kind === 'preempt') ? 'slice' : kind;

    /* 边定义：path 直接给贝塞尔/直线，label 单独定位，避免重叠 */
    const edges = [
      // 创建 → 就绪（水平直线）
      { d: 'M 138 70 L 190 70', lx: 164, ly: 56, label: '创建完成', key: 'new', color: '#94a3b8' },
      // 就绪 → 运行（上弧：被调度）
      { d: 'M 308 70 Q 350 18 392 70', lx: 350, ly: 34, label: '被调度', key: 'dispatch', color: '#f59e0b' },
      // 运行 → 就绪（下弧：时间片用完/抢占）
      { d: 'M 392 98 Q 350 148 308 98', lx: 306, ly: 142, label: '时间片用完 / 被抢占', key: 'slice', color: '#94a3b8' },
      // 运行 → 阻塞（右侧斜线：请求 I/O）
      { d: 'M 468 96 L 402 188', lx: 476, ly: 148, label: '请求 I/O', key: 'io-wait', color: '#94a3b8' },
      // 阻塞 → 就绪（左侧斜线：I/O 完成唤醒）
      { d: 'M 318 188 L 254 98', lx: 222, ly: 148, label: 'I/O 完成唤醒', key: 'io-done', color: '#94a3b8' },
      // 运行 → 终止（水平直线）
      { d: 'M 508 70 L 578 70', lx: 543, ly: 56, label: 'exit / 异常', key: 'exit', color: '#94a3b8' },
      // 不存在的 阻塞 → 运行（右侧红色虚线示意，短箭头+文字）
      { d: 'M 470 160 L 520 120', lx: 545, ly: 148, label: '阻塞→运行 不存在', key: 'illegal-br', color: '#fca5a5', illegal: true },
    ];
    const MARKER_COLORS = ['#94a3b8', '#f59e0b', '#94a3b8', '#94a3b8', '#fca5a5', '#94a3b8', '#94a3b8'];
    const markers = MARKER_COLORS.map((c, i) =>
      `<marker id="ps-${i}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${c}"/></marker>`).join('');

    const edgeSvg = edges.map((e, i) => {
      const active = highlight && e.key === highlight;
      const illegal = !!e.illegal || (qm && qm.illegal && e.key === 'illegal-br');
      /* 非法尝试：这条边本身也要变红（否则画面上"被调度"是琥珀色，读起来像成功了一半） */
      const tried = !s.legal && active;
      const stroke = tried ? '#e11d48' : illegal ? '#fca5a5' : active ? '#f59e0b' : e.color;
      const labelFill = tried ? '#e11d48' : illegal ? '#e11d48' : active ? '#b45309' : '#64748b';
      return `<path d="${e.d}" fill="none" stroke="${stroke}" stroke-width="${active ? 4 : 2.5}" ${illegal || active ? 'stroke-dasharray="7 4"' : ''} marker-end="url(#ps-${i})"/>
        <text x="${e.lx}" y="${e.ly}" text-anchor="middle" style="font:700 11px sans-serif" fill="${labelFill}">${e.label}</text>`;
    }).join('');

    const endpoints = { new: ['创建', '就绪'], dispatch: ['就绪', '运行'], slice: ['运行', '就绪'],
      preempt: ['运行', '就绪'], 'io-wait': ['运行', '阻塞'], 'io-done': ['阻塞', '就绪'], exit: ['运行', '终止'] }[kind] || null;
    const stateNodes = Object.entries(pos).map(([n, [x, y]]) => {
      const occ = Object.entries(s.states).filter(([, st]) => st === n).map(([nm]) => nm);
      const bg = { 创建: '#c7d2fe', 就绪: '#d1fae5', 运行: '#fde68a', 阻塞: '#fecaca', 终止: '#e5e7eb' }[n];
      const isEndpoint = endpoints && (endpoints[0] === n || endpoints[1] === n);
      return `<rect x="${x - 58}" y="${y - 26}" width="116" height="52" rx="12" fill="${bg}" stroke="${isEndpoint ? '#f59e0b' : '#94a3b8'}" stroke-width="${isEndpoint ? 3 : 1.5}"/>
        <text x="${x}" y="${y - 4}" text-anchor="middle" style="font:800 14px sans-serif" fill="#334155">${n}</text>
        <text x="${x}" y="${y + 14}" text-anchor="middle" style="font:600 10px sans-serif" fill="#475569">${occ.length ? occ.join(' ') : '—'}</text>`;
    }).join('');

    /* ---------------- 三队列联动（本帧事实） ----------------
       ⚠ 底部底色/圆角一律内联（Tailwind 类离线会塌成没有底色的一串文字） */
    const PROC_BG = { 运行: '#fde68a', 就绪: '#d1fae5', 阻塞: '#fecaca' };
    const procChip = (n, st, tag) => {
      const isCur = qm && qm.proc === n;
      const border = isCur ? '#f59e0b' : '#cbd5e1';
      return `<span class="ps-proc" data-proc="${RC408.util.esc(n)}" data-state="${st}" style="display:inline-flex;align-items:center;gap:4px;background:${PROC_BG[st] || '#e5e7eb'};color:#1e293b;border:${isCur ? 3 : 1}px solid ${border};border-radius:10px;padding:3px 9px;font:700 13px system-ui">${RC408.util.esc(n)}${tag ? `<span style="font:600 10px system-ui;color:#64748b">${tag}</span>` : ''}</span>`;
    };
    const emptyChip = () => '<span style="color:#cbd5e1;font:12px system-ui">（空）</span>';
    const queueBox = (title, sub, inner, accent) =>
      `<div class="ps-queue" data-q="${title}" style="flex:1 1 220px;min-width:200px;border:1.5px solid ${accent};border-radius:12px;background:#fff;padding:8px 10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px">
          <span style="font:800 12px system-ui;color:${accent}">${title}</span>
          <span style="font:600 10px system-ui;color:#94a3b8">${sub}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center">${inner}</div></div>`;

    const runInner = s.run ? procChip(s.run, '运行', '占用 CPU') : '<span style="color:#cbd5e1;font:12px system-ui">（CPU 空闲）</span>';
    const readyInner = s.ready.length
      ? s.ready.map((n, i) => procChip(n, '就绪', i === 0 ? '队首' : '第' + (i + 1))).join('')
      : emptyChip();
    const blockInner = s.blocked.length
      ? s.blocked.map((n, i) => procChip(n, '阻塞', i === 0 ? '队首' : '第' + (i + 1))).join('')
      : emptyChip();
    const queueRow = `<div style="display:flex;flex-wrap:wrap;gap:8px">
        ${queueBox('运行轨（CPU）', '至多 1 个', runInner, '#b45309')}
        ${queueBox('就绪队列', '等 CPU · 队首下一个上', readyInner, '#059669')}
        ${queueBox('阻塞队列', '等事件 · 由中断唤醒', blockInner, '#dc2626')}
      </div>`;

    const moveLine = (() => {
      if (!qm || qm.op === '—') return '';
      const extra = s.preempted
        ? `<div style="margin-top:4px">↩︎ 同时换下：${RC408.util.esc(s.preempted.proc)}　${s.preempted.from} → ${s.preempted.to}　<b>${s.preempted.op}</b>（${s.preempted.pos}）</div>`
        : '';
      return `<div class="ps-qmove" style="border-radius:10px;background:#fffbeb;border:1px solid #fde68a;padding:7px 12px;font:12px/1.7 system-ui;color:#78350f">
        🔗 <b>本帧队列动作：</b>${RC408.util.esc(qm.proc)}　${qm.from} → ${qm.to}　
        <b>${qm.op}</b>${qm.pos && qm.pos !== '—' ? '（' + qm.pos + '）' : ''}${extra}</div>`;
    })();

    const kindLabel = { new: '创建→就绪', dispatch: '就绪→运行', slice: '运行→就绪', preempt: '运行→就绪（被抢占）',
      'io-wait': '运行→阻塞', 'io-done': '阻塞→就绪', exit: '运行→终止' }[kind] || '—';
    const isIllegalWant = !s.legal && qm && qm.illegal;
    const stats =
      RC408.ui.statCard('事件进度', `${Math.max(idx, 0)} / ${total - 1}`, '按输入顺序逐个发生', 'text-indigo-600') +
      RC408.ui.statCard('当前事件', curEv ? curEv.raw : '—', kind ? kindLabel : '', 'font-mono text-amber-600') +
      RC408.ui.statCard('本次迁移', s.legal ? '合法 ✓' : '不合法 ✗',
        isIllegalWant ? '阻塞态不能直接被调度' : (s.legal ? '符合五态模型' : '违反状态转换规则'),
        s.legal ? 'text-emerald-600' : 'text-rose-600') +
      RC408.ui.statCard('运行轨', s.run ? s.run + ' 占用 CPU' : '空闲', '单处理机至多 1 个', 'text-slate-500');

    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">${stats}</div>
        <div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:8px;overflow-x:auto">
          <svg viewBox="0 0 760 280" class="w-full h-auto mx-auto" style="max-width:760px">
            <defs>${markers}</defs>${edgeSvg}${stateNodes}
          </svg>
        </div>
        ${queueRow}
        ${moveLine}
        <div style="border-radius:12px;padding:10px 16px;font:12px/1.7 system-ui;${s.legal
          ? 'background:rgba(236,253,245,.7);border:1px solid #a7f3d0;color:#064e3b'
          : 'background:#fff1f2;border:1px solid #fecdd3;color:#881337'}">
          💡 <b>辨析要点：</b>就绪→运行只由"调度"触发；运行→阻塞是进程主动等待；阻塞→就绪由事件完成触发、
          <b>进就绪队列队首但仍要等调度</b>；<b>不存在</b>阻塞→运行、就绪→阻塞。
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 20px;font:12px system-ui;color:#64748b;border-top:1px solid #f1f5f9;padding-top:10px">
          ${RC408.ui.legend('#f59e0b', '本帧发生的迁移')}
          ${RC408.ui.legend('#fca5a5', '不存在的迁移（红色虚线）')}
        </div>
      </div>`;
  },
});
