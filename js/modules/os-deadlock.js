'use strict';
/* ============================================================================
 * os-deadlock.js —— 【操作系统】银行家算法：安全性检测（前缀 _bk）
 * 考情：18 年中 **12 年**考死锁 / 银行家 / 最少资源数（2009-25、2011-27、2012-27、2013-32、2014-24、2015-26、
 * 2016-25、2018-26、2019-30、2020-27、2021-31、2022-26），全为选择题，固定问法："该状态是否安全？给出一个
 * 安全序列 / n 个进程各需 k 个资源至少给几个才不会死锁"。（窗60 按 `js/exam-history.js` 现算补上 2021-31，
 * 旧文案写"11 年"且漏登该题。）
 * 快照：安全性检测每轮一帧——找一个 Need ≤ Work 的未完成进程，假定其完成并回收资源。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-deadlock',
  mode: 'stepper',
  title: '死锁避免 · 银行家算法（安全性检测）',

  theory: `
> **为什么要有它**：资源分配不当会让所有进程互相等待、系统停摆（死锁），必须在**分配前**就判断得出来；此外还要会算"至少给多少资源才不会死锁"。
> **怎么实现**：先认识四个必要条件与四种处理策略，主体是**银行家算法**——用 Need = Max − Allocation 逐个试探"假定它完成并归还资源"能否走完。
> **记住什么**：**存在安全序列 ⇔ 状态安全**、**不安全 ≠ 必然死锁**、**安全 → 一定无死锁**；外加鸽巢公式与四种策略各自破坏什么。

## 死锁是什么、怎么产生

- **定义**：多个进程因竞争资源而相互等待，**没有外力介入谁都无法推进**。
- **两个成因**：资源竞争（资源不足）+ 进程**推进顺序不当**。
- **饥饿不是死锁**：饥饿是"一直排不上队"（调度策略导致），进程并没有互相等待；死锁一定是**环形等待**。

## 四个必要条件（缺一不可）

| 条件 | 含义 |
| --- | --- |
| 互斥 | 资源一次只能给一个进程用 |
| 不可剥夺 | 已分配的资源不能被强行抢走，只能自己释放 |
| 请求并保持 | 占着已有资源，同时又去申请新资源 |
| 循环等待 | 存在一个进程的环形等待链 |

四个条件**同时成立**才可能死锁；破坏任意一个就不会死锁——这就是"预防"的全部依据（2015-26）。

## 四种处理策略

| 策略 | 做法 | 备注 |
| --- | --- | --- |
| 死锁预防 | 破坏四个必要条件之一 | 顺序资源分配法 = 破坏**循环等待**；一次性申请全部资源 = 破坏请求并保持；允许剥夺 = 破坏不可剥夺；尽量共享 = 弱化互斥 |
| 死锁避免 | **银行家算法**：分配前判断是否仍安全 | 需要预知最大需求 |
| 死锁检测与解除 | 允许发生，用**资源分配图化简**发现；解除靠剥夺 / 撤销进程 / 回退 | 检测开销大 |
| 忽略 | 不处理 | 多数通用 OS 的选择 |

⚠ **避免 ≠ 预防**：破坏必要条件是预防，银行家算法是避免（2013-32 就考这一句）。

## 资源分配图与死锁定理

- 圆 = 进程，方框 = 资源类，方框里的点 = 实例；申请边指向资源、分配边从资源指向进程。
- **无环 ⇒ 一定无死锁**；**有环且每类资源只有一个实例 ⇒ 一定死锁**；有环但资源类有多个实例 ⇒ **可能**死锁，要靠化简判断。

## 最少资源数（鸽巢原理）

- 公式：n 个进程各需 k 个同类资源，最坏情况每个进程都占着 **k − 1** 个 ⟹ 至少 **n(k − 1) + 1** 个才保证不死锁。
- 反过来用：资源数 R 固定时，**最多 n = 向下取整[(R − 1) ÷ (k − 1)]** 个进程一定有保证；再多一个就只能靠运气。
- 2021-31：n 个进程各需 2 个 ⟹ 至少 **n + 1** 个。

## 银行家算法

- **Need = Max − Allocation**（还需要多少资源才能完成）；**Work** = 当前可用资源向量（初始 = Available）。
- **安全序列**：一个进程排列 P₁…Pₙ，使每个 Pᵢ 的 Need 都能被前面累计回收后的 Work 满足。存在安全序列 ⇔ 状态**安全**。
- 检测流程：

\`\`\`text
Work = Available
循环：找一个未完成进程 P，使 Need[P] ≤ Work 的每一维都成立
    → 假定 P 完成：Work += Allocation[P]，标记完成，记入安全序列
找不到这样的进程且仍有未完成进程 → 状态不安全
\`\`\`

- **安全 → 一定无死锁；不安全 → 可能死锁**（只是无法保证），所以"不安全"不等于"已经死锁"。

## 考点提醒（易错点）

1. 比较是**逐维**的：Need 每一维都要 ≤ Work 对应维，只要有一维不够就换下一个进程；
2. **安全序列可能不止一个**，题目常问"下列哪个是 / 不是安全序列"；
3. 三种策略别混：**银行家算法 = 死锁避免**（分配前判断）；**破坏四个必要条件 = 死锁预防**；允许死锁发生后再查 = 检测与解除；
4. 试探顺序不影响结论，但**每一步都要写全 Work 的每一维**，漏项是最常见的失分点；
5. "至少几个资源"直接用 **n(k − 1) + 1**，别一条条试。

## 问法速查

| 题目里这么问 | 答什么 | 依据 |
| --- | --- | --- |
| 该状态是否安全 / 给出一个安全序列 | 按 Need ≤ Work 逐维试算，能走完就安全 | 不安全只是可能死锁（2011-27、2012-27、2020-27、2022-26） |
| 下列哪个不是安全序列 | 逐个代入，卡住的那一步就是它 | 安全序列可能不止一个（2018-26） |
| 银行家算法属于哪类 | 死锁**避免** | 破坏必要条件才是预防（2013-32） |
| 顺序资源分配法破坏哪个条件 | **循环等待** | 按编号递增申请（2015-26） |
| n 个进程各需 2 个资源，至少几个 | n + 1 | n(k−1)+1（2021-31） |
| 资源数固定，最多几个进程一定不死锁 | (R−1) ÷ (k−1) 取整 | 鸽巢原理的另一半 |

> **真题考情**：**12/18 年**，全为选择题（2009-25、2011-27、2012-27、2013-32、2014-24、2015-26、2016-25、
> 2018-26、2019-30、2020-27、2021-31、2022-26）——固定问法"是否安全 / 求安全序列 / 至少几个资源"。
`,

  inputs: [
    {
      key: 'scene', label: '场景', type: 'select', default: 'safe', wide: true,
      options: [
        { v: 'safe', t: '场景一：安全（存在唯一安全序列）' },
        { v: 'unsafe', t: '场景二：不安全（检测中途卡死）' },
        { v: 'multi', t: '场景三：安全（多个安全序列）' },
      ],
    },
  ],

  parse(vals) {
    const scenes = {
      safe: {
        names: ['P1', 'P2', 'P3'], res: ['A', 'B', 'C'],
        avail: [1, 1, 2],
        alloc: [[1, 0, 0], [0, 1, 1], [1, 1, 0]],
        max: [[2, 0, 0], [0, 1, 2], [1, 2, 0]],
      },
      unsafe: {
        names: ['P1', 'P2', 'P3'], res: ['A', 'B', 'C'],
        avail: [0, 1, 0],
        alloc: [[1, 1, 0], [1, 0, 1], [0, 1, 1]],
        max: [[2, 1, 1], [1, 1, 1], [1, 2, 1]],
      },
      multi: {
        names: ['P1', 'P2', 'P3', 'P4'], res: ['R1', 'R2'],
        avail: [2, 1],
        alloc: [[1, 0], [0, 1], [1, 1], [0, 0]],
        max: [[2, 1], [1, 2], [2, 1], [0, 1]],
      },
    };
    const sc = scenes[vals.scene] || scenes.safe;
    const need = sc.alloc.map((a, i) => a.map((v, j) => sc.max[i][j] - v));
    need.forEach((row, i) => { if (row.some(v => v < 0)) throw { message: `${sc.names[i]} 的 Max 小于 Allocation，数据非法` }; });
    return { ...sc, need };
  },

  buildSnapshots(model) {
    const { names, res, avail, alloc, max, need } = model;
    let work = [...avail];
    const finished = names.map(() => false);
    const seq = [];
    const snaps = [];
    const vecStr = v => '(' + v.join(',') + ')';
    const push = (step, chosen, log, logType, desc) => snaps.push({
      step, chosen: chosen ?? null, work: [...work], finished: [...finished], seq: [...seq],
      need: need.map(r => [...r]), alloc: alloc.map(r => [...r]), names: [...names], res: [...res],
      log, logType, desc,
    });

    push('init', null,
      `就绪：Available = ${vecStr(avail)}。Need = Max − Allocation。开始安全性检测：每轮找一个 Need ≤ Work 的未完成进程。`,
      'info', '点击「单步执行」逐步试探安全序列');

    let guard = 0;
    while (seq.length < names.length && guard++ < 30) {
      const cand = names.findIndex((_, i) => !finished[i] && need[i].every((v, j) => v <= work[j]));
      if (cand < 0) {
        push('stuck', null,
          `💀 找不到任何满足 Need ≤ Work = ${vecStr(work)} 的未完成进程 → **状态不安全**（无法保证不死锁，剩余 ${names.filter((_, i) => !finished[i]).join('、')} 卡住）。`,
          'error', '不安全状态：检测中途卡死');
        return snaps;
      }
      const name = names[cand];
      seq.push(name); finished[cand] = true;
      work = work.map((v, j) => v + alloc[cand][j]);
      push('grant', cand,
        `${name}：Need ${vecStr(need[cand])} ≤ Work ${vecStr(work.map((v, j) => v - alloc[cand][j]))} → 可完成；假定其运行结束并**回收** Allocation ${vecStr(alloc[cand])} → Work 变为 ${vecStr(work)}`,
        'success', `${name} 可完成并回收资源（Work → ${vecStr(work)}）`);
    }
    push('done', null,
      `检测完成：安全序列 = ${seq.join(' → ')}（可能不止一个）。状态**安全**——系统可以按此顺序分配资源而不发生死锁。`,
      'success', `安全 ✓：序列 ${seq.join(' → ')}`);
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const vecStr = v => '(' + v.join(', ') + ')';
    const matRows = (mat, hotRow) => model.names.map((nm, i) =>
      `<tr class="${hotRow === i ? 'row-hit' : ''}"><td class="font-bold">${nm}</td>${mat[i].map(v => `<td class="font-mono">${v}</td>`).join('')}</tr>`).join('');

    const workCard = `
      <div class="rounded-xl border ${s.step === 'grant' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'} p-3">
        <div class="text-[11px] font-bold text-slate-400">Work（可用资源）</div>
        <div class="font-mono font-extrabold text-lg mt-1">${vecStr(s.work)}</div>
      </div>`;

    const seqHtml = s.seq.length ? s.seq.map((n, i) => RC408.ui.chip(`${i + 1}. ${n}`, 'chip-hit')).join('<span class="text-slate-300 self-center">→</span>') : '<span class="text-xs text-slate-400">（尚无）</span>';

    const isStuck = s.step === 'stuck';
    const stats =
      RC408.ui.statCard('检测进度', `${s.seq.length} / ${model.names.length}`, '已确认可完成的进程') +
      RC408.ui.statCard('当前 Work', vecStr(s.work), '累计回收的Allocation', 'font-mono text-indigo-600') +
      RC408.ui.statCard('安全序列', s.seq.length ? s.seq.join('→') : '—', s.seq.length === model.names.length ? '状态安全' : isStuck ? '不存在' : '试探中', 'text-emerald-600') +
      RC408.ui.statCard('状态判定', isStuck ? '不安全' : s.step === 'done' ? '安全' : '检测中', '不安全 ≠ 必然死锁', isStuck ? 'text-rose-600' : 'text-slate-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <div class="text-[11px] font-bold text-slate-400 mb-1">Allocation（已分配）</div>
            <table class="tbl w-full"><thead><tr><th></th>${model.res.map(r => `<th>${r}</th>`).join('')}</tr></thead><tbody>${matRows(s.alloc, s.chosen)}</tbody></table>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <div class="text-[11px] font-bold text-slate-400 mb-1">Max（最大需求）</div>
            <table class="tbl w-full"><thead><tr><th></th>${model.res.map(r => `<th>${r}</th>`).join('')}</tr></thead><tbody>${matRows(model.max ?? s.alloc, -1)}</tbody></table>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <div class="text-[11px] font-bold text-slate-400 mb-1">Need = Max − Allocation</div>
            <table class="tbl w-full"><thead><tr><th></th>${model.res.map(r => `<th>${r}</th>`).join('')}</tr></thead><tbody>${matRows(s.need, -1)}</tbody></table>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
          ${workCard}
          <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
            <div class="text-[11px] font-bold text-slate-400 mb-1">安全序列（试探顺序）</div>
            <div class="mt-1.5 flex flex-wrap gap-1.5 items-center">${seqHtml}</div>
          </div>
        </div>

        <div class="rounded-xl ${isStuck ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-indigo-50/70 border-indigo-100 text-indigo-900'} px-4 py-2.5 text-xs leading-relaxed">
          💡 <b>考点提醒：</b>检测中"假定完成"只是试探——进程真正完成前资源并未释放；安全序列不唯一，但只要**存在**即判定安全；
          银行家算法属于**死锁避免**（事前判断），区别于死锁预防（破坏必要条件）与死锁检测解除。
        </div>
      </div>`;
  },
});
