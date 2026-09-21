'use strict';
/* ============================================================================
 * ds-hash.js —— 【数据结构】散列表：线性探测 / 链地址法与 ASL（前缀 _hs）
 * 考情：18 年中 9 年（2010-41 大题、2024-42 大题，其余为选择题：装填因子/探测/ASL）。
 * ⚠ 窗9 勘误：原写 10 年——2013-9 是 AOE 网关键路径题（2013_解析.txt:117-122），不属本考点，已删。
 * 快照：每个关键码的插入过程（哈希地址 → 逐次探测/链接）一帧，done 汇总 ASL。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-hash',
  mode: 'stepper',
  title: '散列表：线性探测 / 链地址法与 ASL',

  theory: `
> **为什么要有它**：按关键字逐个比较，最快也要 \\(O(\\log_2 n)\\)——散列直接**由关键字算出地址**，理想情况下一次就命中。
> **怎么实现**：\\(H(key)=key\\bmod p\\)（p 取不超过表长的素数效果最好）；地址被占就按规则**线性探测**往后找，或把同义词挂成**链地址**。
> **记住什么**：装填因子 \\(\\alpha=\\) 元素数 ÷ 表长 + **成功 ASL 用元素个数做分母、失败 ASL 用散列函数值域 p 做分母** + 堆积只让 ASL 变大。

## 散列函数与冲突
- 两个不同关键字映射到同一地址 → **冲突**（同义词）；
- **装填因子 \\(\\alpha=\\) 表中元素数 ÷ 表长**：ASL 只与 \\(\\alpha\\)、散列函数、冲突处理方式有关，与元素个数本身无直接关系。

## 两种冲突处理（本模块）
- **线性探测**：冲突则依次探查 \\((H+i)\\bmod m\\) 直到空位；缺点是**堆积（聚集）**——非同义词也争夺同一片地址，**平均查找长度因此增大**（但它不影响存储效率与装填因子）；
- **链地址法**：同义词挂成链表，无堆积、删除方便。

## ASL 计算（大题套路）
- **成功**：每个元素的比较次数 = 插入它时的探测次数，**ASL(成功) = Σ比较次数 ÷ 元素个数**；
- **失败**：对散列函数的每个可能值（\\(\\bmod p\\) 的 p 种）从散列地址探测到"空"的比较次数求和，再 ÷ **p**——
  **分母是 p（散列函数值域），不是表长 m**，这是最高频的辨析点。

## 考点提醒（易错点）
1. 失败 ASL 的**分母**按散列函数值域算（本模块 p），不要用表长；
2. 表长 m 与 p 常常不等（如 \\(H=key\\bmod 7\\) 而表长 10），读题先把两个数分清；
3. **堆积是线性探测特有的**，链地址法没有；堆积改变 ASL，但不改变装填因子；
4. 开放定址法**不能真删元素**（要留删除标记），否则会截断后面的探测链；链地址法直接摘链即可。

> **真题考情**：**9/18 年（选 7 题 + 大 2 道）**：选 2011-9、2014-8（堆积对 ASL 的影响）、2018-9、
> 2019-8、2022-9、2023-9、2025-9（线性探查）；大 2010-41、2024-42（画表 + 求成功 / 失败 ASL）。
`,

  inputs: [
    { key: 'method', label: '冲突处理', type: 'select', default: 'linear',
      options: [{ v: 'linear', t: '线性探测再散列' }, { v: 'chain', t: '链地址法' }] },
    { key: 'm', label: '散列表长 m', type: 'select', default: 11, options: [11, 13].map(v => ({ v, t: `${v}` })) },
    { key: 'keys', label: '关键码序列（逗号分隔）', type: 'textarea', rows: 2, wide: true,
      default: '19, 14, 23, 1, 68, 20, 84, 27, 55, 11', help: 'H(key) = key mod m；最多 10 个' },
  ],

  parse(vals) {
    const m = parseInt(vals.m, 10);
    const keys = vals.keys.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (keys.length < 3 || keys.length > 10) throw { message: '关键码 3 ~ 10 个' };
    if (keys.some(k => k < 0)) throw { message: '关键码须为非负整数' };
    if (keys.length > m) throw { message: '关键码数不能超过表长（链地址法虽允许，但演示按 α ≤ 1）' };
    return { m, keys, method: vals.method === 'chain' ? 'chain' : 'linear' };
  },

  buildSnapshots(model) {
    const { m, keys, method } = model;
    const table = Array(m).fill(null);          // 线性探测用
    const buckets = Array.from({ length: m }, () => []);  // 链地址用
    const tries = {};                           // key → 比较次数
    const snaps = [];
    const push = (o) => snaps.push({ method, m, keys: [...keys], table: [...table], buckets: buckets.map(b => [...b]),
      cur: null, probes: [], tries: { ...tries }, log: '', logType: 'info', desc: '', ...o });

    push({ step: 'init', log: `就绪：表长 m = ${m}，H(key) = key mod ${m}，冲突处理 = ${method === 'linear' ? '线性探测' : '链地址法'}。`, desc: '点击「单步执行」逐个插入关键码' });

    keys.forEach((key, t) => {
      const h0 = key % m;
      let probes = [h0], pos = h0, count = 1;
      if (method === 'linear') {
        while (table[pos] !== null) { pos = (pos + 1) % m; probes.push(pos); count++; }
        table[pos] = key;
        tries[key] = count;
        push({ step: 'insert', cur: key, h0, probes, pos, count,
          log: `插入 ${key}：H = ${key} mod ${m} = ${h0}${probes.length > 1 ? `，冲突 → 线性探测 ${probes.slice(1).map(p => p).join('→')}` : ''} → 存入 ${pos}（比较 ${count} 次）`,
          logType: probes.length > 1 ? 'warn' : 'success',
          desc: `${key} → 地址 ${pos}${probes.length > 1 ? `（探测 ${probes.length} 次）` : ''}` });
      } else {
        buckets[h0].push(key);
        count = buckets[h0].length;
        tries[key] = count;
        push({ step: 'insert-chain', cur: key, h0, probes: [h0], pos: h0, count,
          log: `插入 ${key}：H = ${h0} → 挂入桶 ${h0} 链尾（该桶第 ${count} 个，查找时比较 ${count} 次）`,
          logType: 'success', desc: `${key} → 桶 ${h0}（链长 ${count}）` });
      }
    });

    /* 成功 ASL */
    const succ = keys.map(k => tries[k]);
    const succASL = (succ.reduce((a, b) => a + b, 0) / keys.length).toFixed(2);
    let failASL = '—';
    if (method === 'linear') {
      let total = 0;
      for (let h = 0; h < m; h++) {
        let cnt = 1, p = h;
        while (table[p] !== null) { p = (p + 1) % m; cnt++; if (cnt > m + 1) break; }
        total += cnt;
      }
      failASL = (total / m).toFixed(2);
      push({ step: 'done', failASL, succASL: Number(succASL),
        log: `插入完成：成功 ASL = (${succ.join(' + ')}) ÷ ${keys.length} = ${succASL}；失败 ASL = ${total} ÷ ${m} = ${failASL}（分母是散列函数值域 m，注意装填因子 α = ${keys.length}/${m} ≈ ${(keys.length / m).toFixed(2)}）`,
        logType: 'success', desc: `成功 ASL = ${succASL}，失败 ASL = ${failASL}` });
    } else {
      let total = 0, den = 0;
      buckets.forEach((b, h) => { let c = 1; b.forEach(() => { total += c++; }); den++; });
      failASL = den ? (total / den).toFixed(2) : '—';
      push({ step: 'done', failASL, succASL: Number(succASL),
        log: `插入完成：成功 ASL = (${succ.join(' + ')}) ÷ ${keys.length} = ${succASL}；失败 ASL = ${total} ÷ ${den} = ${failASL}（分母为散列地址个数）。装填因子 α = ${keys.length}/${m} ≈ ${(keys.length / m).toFixed(2)}`,
        logType: 'success', desc: `成功 ASL = ${succASL}，失败 ASL = ${failASL}` });
    }
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;
    const isLinear = s.method === 'linear';
    const hot = i => s.probes && s.probes.includes(i);
    const finalPos = s.step === 'insert' && s.pos !== undefined ? s.pos : (s.step === 'insert-chain' ? s.h0 : null);

    const slots = Array.from({ length: s.m }, (_, i) => {
      const val = isLinear ? s.table[i] : null;
      const chain = s.buckets[i];
      const isHot = hot(i);
      const isFinal = finalPos === i;
      return `<div class="flex flex-col items-center gap-1">
        <div class="frame-cell" style="width:52px;height:52px;border-radius:9px;${isFinal ? 'border-color:#10b981;background:#ecfdf5;' : isHot ? 'border-color:#f59e0b;background:#fffbeb;' : ''}">
          <span class="page-num" style="font-size:14px">${isLinear ? (val === null ? '·' : val) : (chain ? chain.join('→') : '·')}</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400">${i}</span>
      </div>`;
    }).join('');

    const chainList = !isLinear ? s.buckets.map((b, i) => b.length ? RC408.ui.chip(`${i}: ${b.join('→')}`, b.some(x => x === s.cur) ? 'chip-check' : 'chip-mst') : '').filter(Boolean).join(' ') : '';

    const succ = model.keys.filter(k => s.tries[k] !== undefined).map(k => s.tries[k]);
    const succASL = succ.length ? (succ.reduce((a, b) => a + b, 0) / succ.length).toFixed(2) : '—';
    const alpha = (model.keys.length / s.m).toFixed(2);

    const stats =
      RC408.ui.statCard('插入进度', `${succ.length} / ${model.keys.length}`, `H(key) = key mod ${s.m}`) +
      RC408.ui.statCard('装填因子 α', alpha, '元素数 ÷ 表长', 'text-indigo-600') +
      RC408.ui.statCard('成功 ASL（当前）', succASL, 'Σ插入比较次数 ÷ 元素数', 'text-emerald-600') +
      RC408.ui.statCard('本帧探测', s.probes ? s.probes.length : 0, s.probes && s.probes.length > 1 ? '发生冲突' : '—', s.probes && s.probes.length > 1 ? 'text-rose-600' : 'text-slate-400');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 overflow-x-auto">
          ${RC408.ui.sectionTitle(isLinear ? `散列表（线性探测：琥珀 = 探测经过，绿 = 最终落位）` : `链地址法（同义词挂链，无堆积）`)}
          ${isLinear ? `<div class="flex gap-1.5 justify-center flex-wrap">${slots}</div>` : `<div class="flex flex-wrap gap-2 justify-center">${slots}</div>`}
          ${!isLinear && chainList ? `<p class="text-xs text-slate-500 mt-3 text-center">链结构：${chainList}</p>` : ''}
          <p class="text-[11px] text-slate-400 mt-2 text-center font-mono">${s.log && s.cur !== null ? `H(${s.cur}) = ${s.cur} mod ${s.m} = ${s.cur % s.m}` : ''}</p>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>${isLinear ? '线性探测会产生"堆积"——非同义词也会争夺地址，使 ASL 变大（2014 真题）；失败 ASL 的分母是散列函数值域 p。' : '链地址法适合经常增删的情形；成功查找的比较次数 = 元素在链中的位置。'}
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '本帧探测经过')}
          ${RC408.ui.legend('#10b981', '最终插入位置')}
        </div>
      </div>`;
  },
});
