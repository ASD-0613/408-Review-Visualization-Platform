'use strict';
/* ============================================================================
 * ds-stack-queue.js —— 【数据结构】栈与队列出入演示（序列判定）（前缀 _sq）
 * 考情：18 年中 **13 年**考（选 16 + 大题 1）：选 2009-2、2010-1·2、2011-2·3、2013-2、2014-3、2015-1·2、
 * 2017-2、2018-1·2、2020-2、2021-2、2022-2、2025-2；大 2026-42。固定问法："该出栈序列是否合法 / 最小栈容量 / 合法序列个数"。
 * ⚠ **窗14/窗42** 勘误：原登记的 2024-42 经 `考情缓存/2024_真题.txt` 原文核实是**散列表**大题
 *   （H(key)=(key×3)%11 二次探查），与栈无关，已从 exam-history 删去（火苗不受影响）。
 * 快照：每个 Push/Pop 动作一帧；结束帧给出合法性结论与最小栈容量（最大深度）。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-stack-queue',
  mode: 'stepper',
  title: '栈的出入序列判定与最小容量',

  theory: `
> **为什么要有它**：栈和队列是两种"操作受限的线性表"，而考题几乎都落在**栈的出入序列**上——判给定出栈序列是否合法、最少要多大栈容量、一共多少种合法序列。
> **怎么实现**：用**模拟法**——入栈序列按序进栈，对出栈序列逐个比对：栈顶 = 目标就弹出，不等就继续压栈；压完仍凑不出即不合法。
> **记住什么**：模拟法 + **最少栈容量 = 过程中栈的最大深度** + 合法序列数 = **卡特兰数** \\(C_n=\\dfrac{C(2n,n)}{n+1}\\)。

## 判定算法（考场手算同款）

入栈序列按序进栈；对出栈序列的每个元素：**栈顶 = 目标 → 弹出**，否则继续压栈；若入栈序列已用完仍凑不出该元素 → **序列不合法**。复杂度 \\(O(n)\\)。

## 必背结论

- 入栈序 1..n 时，合法出栈序列共 \\(C_n=C(2n,n)/(n+1)\\) 个（n=3 → 5、n=4 → 14）；
- n 个元素的**最少辅助栈容量** = 整个过程中栈的最大深度（模拟时记一个峰值）；
- 序列中若出现"大中小"倒挂（先出大、再出中、最后才出小）而中间元素又必须后于小元素出栈，则该序列不合法。

## 合法出栈序列的判据：找"大、小、中"倒挂（2026-42）

模拟之外还有一条**不用逐个压弹也能用**的等价判据：出栈序列 \\(P_1,P_2,\\ldots,P_n\\) 合法，当且仅当**不存在** \\(i < j < k\\) 使 \\(P_j < P_k < P_i\\)。

- 直观解释：\\(P_i\\) 先出队，说明比它小的 \\(P_j\\)、\\(P_k\\) 当时都还在栈里、压在它上面——栈是后进先出，所以这两个元素出栈的次序必须**与入栈次序相反**（大的先出）；\\(P_j < P_k\\) 是小的先出，正好违反这一条；
- 三个数就能验证：入栈 1,2,3、出栈 3,1,2 时取 \\(P_1=3\\)、\\(P_2=1\\)、\\(P_3=2\\)，\\(1 < 2 < 3\\) 倒挂成立 ⟹ 不合法；2,3,1 找不到这种三元组 ⟹ 合法；
- **计数**仍按卡特兰数或按首元素拆开数：n 个元素的合法序列数是 \\(C_n\\)；其中以 1 开头的有 \\(C_{n-1}\\) 个（1 出栈后剩下的 n−1 个元素自成同一个问题）；题面问"以某个数字开头有几个"，就按首元素分类、把剩下的拆成"已出栈 / 未入栈"两段来数（2026-42 的第三、四问）。

## 循环队列：先定"指针指向谁"，再定初值与判满

循环队列的题几乎都错在同一处：**front / rear 到底指向队头元素、还是指向队头的前一个位置**。先看清这一句，其余全是它的推论。

| 约定 | 入队 | 出队 | 队空 | 队满（牺牲一个单元，容量 m 的数组最多放 m−1 个元素） |
| --- | --- | --- | --- | --- |
| rear 指向**队尾元素的后一个**空位 | 先存 A[rear]，再 rear=(rear+1)%m | 先取 A[front]，再 front=(front+1)%m | front==rear | (rear+1)%m==front |
| rear 指向**队尾元素本身**（此时 front 指向队头元素的**前一个**位置） | 先 rear=(rear+1)%m，再存 A[rear] | 先 front=(front+1)%m，再取 A[front] | front==rear | (rear+1)%m==front |

- **初值由"第一个元素落在哪"反推**：题面说第一个入队元素存在 A[0]、而约定是"先移指针再存"，则 rear 的初值只能是 m−1（移一次正好到 0），front 初值为 0（还没出过队）；约定是"先存再移"时 rear 初值取 0 就够（2011-3）；
- **题面直接给两个指针的含义时照它的说法算**：end1 指向队头元素、end2 指向队尾元素的后一个 ⟹ 队空是 end1==end2，队满必须牺牲一个单元，(end2+1)%m==end1（2014-3）；
- 元素个数公式要和约定配套：rear 指向队尾后一个空位时个数 = (rear−front+m)%m；牺牲一个单元时，m 个单元的队列最多装 m−1 个，别按 m 算。

## 双端队列与"受限双端队列"（2010-2 · 2021-2）

**双端队列（deque）**两端都能入队、都能出队；把一端封住就得到两种受限形式：

| 名字 | 允许的操作 | 一句话理解 |
| --- | --- | --- |
| 输入受限双端队列 | 只有一端能入队，两端都能出队 | 进货口只有一个、取货口有两个 |
| 输出受限双端队列 | 两端都能入队，只有一端能出队 | 进货口有两个、取货口只有一个 |

- 判定"某个出队序列能不能得到"就用**逐元素模拟**：把入队序列依次放进 deque 的左端或右端（每次自选），遇到出队序列的当前元素时它必须正好在**出队端**；只要有一条放法走通就合法；
- 2010-2 与 2021-2 都是输出受限双端队列（2021-2 题面的"一端仅能入队、另一端既能入队又能出队"就是"两端都能进、只有右端能出"）；
- 常用捷径是**盯住"被夹在中间"的元素**：若目标序列里某元素的先后关系要求它既先于左端元素、又晚于右端元素，这种方向冲突一眼就能排除（2010-2 的四个选项就是靠这一步排掉的）。

## 栈与递归：函数调用栈里存什么（2015-1 · 2015-2）

- 每次函数调用都往**系统栈**压一帧：返回地址、实参、局部变量与现场（寄存器）；调用返回就弹栈，所以"栈底 → 栈顶"正好是**调用的先后次序**；
- 2015-1 的 \\(S(1)\\) 会再调 \\(S(0)\\)，调用链是 main → S(1) → S(0)，故自栈底到栈顶依次是 main()、S(1)、S(0)——**不是**按返回值往回排；
- **递归深度 = 栈的最大深度**；递归改写成非递归，就是自己开一个栈模拟这三样东西；
- 递归工作栈的进出次序与"以前序为入栈次序、以中序为出栈次序"的序列判定是同构的（2015-2）；
- 括号匹配同理：栈的深度就是**嵌套层数**，给定容量 k 时，嵌套超过 k 就会溢出（2025-2 判哪个括号串会让容量 3 的栈溢出）。

## 考点提醒（易错点）

1. **先看清题目给的是入栈序列还是出栈序列**，两边都可能被问；
2. 最少容量题要**逐元素模拟并记录峰值**，不能只看最终栈空；
3. 卡特兰数只适用于"1..n 依次入栈、中途可任意出栈"的标准模型；
4. 队列的常见考法是**循环队列判空 / 判满**（牺牲一个单元时：队满条件 \\((rear+1)\\%m=front\\)），与栈的出入序列分开记。

> **真题考情**：**13/18 年（选 16 + 大 1）**：选 2009-2、2010-1·2、2011-2·3、2013-2、2014-3、2015-1·2、2017-2、
> 2018-1·2、2020-2、2021-2、2022-2、2025-2；大 2026-42（给定 n，判断出栈序列是否合法 / 求合法序列个数）。
`,

  inputs: [
    { key: 'push', label: '入栈序列（逗号分隔，4~8 个）', type: 'text', default: 'a,b,c,d,e', wide: true },
    { key: 'pop', label: '待判定的出栈序列', type: 'text', default: 'd,c,e,b,a', wide: true, help: '逐个比对：栈顶等于目标则弹出，否则继续压栈' },
  ],

  quickActions: [
    { label: '非法序列示例', run(rt) { rt.setInput('pop', 'e,a,b,c,d'); rt.load(); } },
    /* ★ 窗24 修正两处（用户 2026-09-25 报"预设点一下就报错/只有一步"）：
       ① 上限 8 → 12：**2026-42 真题就是 n = 9**（考情缓存 2026_解析.txt:713-724 原文：
          "将序列 1,2,3,…,n 依次入栈，…(1) 当 n=9 时，能否得到出栈序列 {2,3,1,6,4,7,5,9,8}？…"），旧上限把它挡在门外；
       ② 原来那条预览序列（4,3,5,6,2,8,7,9,1）是**自己编的**却挂着"2026 真题风格"的名字 ⟹
          现在直接给真题的两个序列（一个不能、一个能），并把年份题号写进 label。 */
    { label: '📌 2026-42 真题：{2,3,1,6,4,7,5,9,8} → 不能', run(rt) { rt.setInput('push', '1,2,3,4,5,6,7,8,9'); rt.setInput('pop', '2,3,1,6,4,7,5,9,8'); rt.load(); } },
    { label: '📌 2026-42 真题：{2,3,1,5,6,7,4,9,8} → 能', run(rt) { rt.setInput('push', '1,2,3,4,5,6,7,8,9'); rt.setInput('pop', '2,3,1,5,6,7,4,9,8'); rt.load(); } },
  ],

  parse(vals) {
    const toks = s => vals[s].split(/[^0-9a-zA-Z]+/).filter(Boolean);
    const push = toks('push'), pop = toks('pop');
    if (push.length < 3 || push.length > 12) throw { message: '入栈序列 3 ~ 12 个元素（2026-42 真题用的是 n = 9）' };
    if (pop.length !== push.length) throw { message: '出栈序列长度必须与入栈序列相同' };
    const ps = [...push].sort().join(',');
    const qs = [...pop].sort().join(',');
    if (ps !== qs) throw { message: '出栈序列与入栈序列的元素集合不一致' };
    return { push, pop };
  },

  buildSnapshots(model) {
    const { push: P, pop: Q } = model;
    const stack = [];
    let pi = 0, qi = 0, maxDepth = 0;
    const snaps = [];
    const push2 = (step, o) => snaps.push({
      step, stack: [...stack], pi, qi, maxDepth,
      pushSeq: [...P], popSeq: [...Q],
      log: '', logType: 'info', desc: '', ...o,
    });

    push2('init', { log: `就绪：入栈序 ${P.join(', ')}，判定出栈序 ${Q.join(', ')}。规则：目标 ≠ 栈顶就继续压栈。`, desc: '点击「单步执行」观察每次压栈/弹栈' });

    let fail = false;
    while (qi < Q.length) {
      const want = Q[qi];
      if (stack.length && stack[stack.length - 1] === want) {
        stack.pop(); qi++;
        push2('pop', { action: 'pop', ch: want,
          log: `栈顶 = ${want}，恰为出栈目标 → 弹出（已出栈 ${qi}/${Q.length}）`,
          logType: 'success', desc: `弹出 ${want}` });
      } else if (pi < P.length) {
        stack.push(P[pi]); pi++;
        maxDepth = Math.max(maxDepth, stack.length);
        push2('push', { action: 'push', ch: P[pi - 1],
          log: `栈顶 ≠ 目标 ${want} → 压入 ${P[pi - 1]}（入栈序第 ${pi} 个），栈深 ${stack.length}`,
          logType: 'info', desc: `压入 ${P[pi - 1]}` });
      } else {
        fail = true;
        push2('fail', { log: `✗ 序列不合法：目标 ${want} 既不在栈顶（栈顶 = ${stack[stack.length - 1]}），入栈序列也已耗尽——${want} 压在 ${stack[stack.length - 1]} 之下无法先出。`, logType: 'error', desc: `不合法：${want} 无法先于栈顶出栈` });
        break;
      }
    }
    if (!fail) {
      push2('done', { log: `✓ 出栈序列合法！过程中栈的最大深度 = ${maxDepth} → 辅助栈容量至少为 ${maxDepth}。`, logType: 'success', desc: `合法 ✓ 最小栈容量 = ${maxDepth}` });
    }
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    const U = RC408.util;

    /* 待入栈 / 栈 / 已出栈 三行 */
    const waiting = s.pushSeq.slice(s.pi).map((c, i) =>
      RC408.ui.chip(c, i === 0 && s.step === 'push' ? 'chip-check' : 'chip', '待入栈'));
    const stackCells = s.stack.map((c, i) => {
      const isTop = i === s.stack.length - 1;
      return `<div class="frame-cell" style="width:44px;height:44px;border-radius:9px;${isTop ? 'border-color:#f59e0b;background:#fffbeb;' : ''}" title="第 ${i + 1} 层">
        <span class="page-num" style="font-size:16px">${c}</span></div>`;
    }).reverse().join('<span class="text-slate-300 self-center">↑</span>') || '<span class="text-xs text-slate-400 py-3">（空栈）</span>';
    const popped = s.popSeq.slice(0, s.qi).map(c => RC408.ui.chip(c, 'chip-hit'));

    const stats =
      RC408.ui.statCard('已入栈 / 已出栈', `${s.pi} / ${s.qi}`, `入栈序 ${s.pushSeq.length} 个`, 'text-indigo-600') +
      RC408.ui.statCard('当前栈深', s.stack.length, '栈顶琥珀色高亮', 'text-amber-600') +
      RC408.ui.statCard('最小栈容量', s.maxDepth, '过程最大深度（考点）', 'text-emerald-600') +
      RC408.ui.statCard('判定', s.step === 'fail' ? '不合法 ✗' : s.step === 'done' ? '合法 ✓' : '判定中…', '卡特兰数个合法序列', s.step === 'fail' ? 'text-rose-600' : 'text-emerald-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('入栈序列（剩余部分，绿 = 下一个将压入）')}
          <div class="flex flex-wrap gap-1.5">${waiting.join('') || '<span class="text-xs text-slate-400">（已全部压入）</span>'}</div>
          ${RC408.ui.sectionTitle('辅助栈（右 = 栈顶；压入/弹出都在栈顶）')}
          <div class="flex flex-wrap gap-1 items-center min-h-12">${stackCells}</div>
          ${RC408.ui.sectionTitle('已出栈序列')}
          <div class="flex flex-wrap gap-1.5">${popped.join('') || '<span class="text-xs text-slate-400">（尚未出栈）</span>'}</div>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>判定口诀"目标 ≠ 栈顶就压栈"——压完仍凑不出即不合法；
          最小容量 = 过程最大深度；n 个元素的合法出栈序列共卡特兰数 C(2n,n)/(n+1) 个（n=3 → 5、n=4 → 14）。
        </div>
      </div>`;
  },
});
