'use strict';
/* ============================================================================
 * ds-kmp.js —— 【数据结构】KMP 模式匹配与 next / fail 数组（前缀 _km）
 * 考情：2015-8（失配后 i,j 值）、2019-9（比较总次数）、2024-6（aabaab 修正 next）。
 * 快照：① 逐位求 fail（最长相等前后缀）② 主串匹配（失配 j 回退）。0/1 基准双展示。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-kmp',
  mode: 'stepper',
  title: 'KMP 模式匹配与 next 数组',

  theory: `
> **为什么要有它**：暴力匹配每次失配都把主串指针退回去，最坏 \\(O(n\\times m)\\)——KMP 让**主串指针永不回退**，只用模式串自己的 next / fail 决定下一步跳到哪。
> **怎么实现**：先对模式串求 fail（\\(p[0..j]\\) 的**最长相等前后缀**长度）；匹配失配时 \\(j\\) 跳到 \\(fail[j-1]\\) 继续比较，\\(i\\) 不动。
> **记住什么**：**next 的含义与手算** + 主串 i 不回退 + **nextval 修正**（避免 \\(p[j]\\) 与 \\(p[next[j]]\\) 相同造成的无效比较）。

## fail / next 的两种口径（都给出，避免踩坑）
- **fail[j]**（0 基，本模块演示用）：\\(p[0..j]\\) 的**最长相等前后缀长度**；失配时 \\(j\\) 跳到 \\(fail[j-1]\\) 继续比较，**主串指针 i 不回退**；
- **教材 next[j]**（1 基）：\\(next[1]=0\\)、\\(next[j+1]=fail[j]+1\\)——与 fail 只差一个平移；
- **nextval（修正值）**：若 \\(p[j]=p[next[j]]\\)，则 \\(nextval[j]=nextval[next[j]]\\)，跳过必然失配的那次比较。

## KMP 的优势
主串指针 i **从不回退** ⟹ 比较次数 \\(O(n+m)\\)（暴力最坏 \\(O(n\\times m)\\)）；求 next 本身是 \\(O(m)\\)。

## 考点提醒（易错点）
1. 先看清**下标从 0 还是从 1 开始**，两套口径的数值正好差 1（题目常把两种都列进选项）；
2. "比较总次数"要**逐位模拟**：失配后 j 跳、i 不动；命中则 i、j 同时后移；
3. fail 是"**最长**相等前后缀"——不能只取最短的相同前缀；
4. nextval 用来消除**连续相同字符**带来的无效比较，模式串越"重复"，修正后跳得越远。

> **真题考情**：**3/18 年（全为选择题）**：2015-8（失配后 i、j 的值）、2019-9（匹配的总比较次数）、
> 2024-6（模式串 aabaab 的修正 next）；三题的共同题眼都是 next / fail 的含义与手算。
`,

  inputs: [
    { key: 'text', label: '主串', type: 'text', default: 'ababcabcacbab', wide: true },
    { key: 'pat', label: '模式串（2~10 个字符）', type: 'text', default: 'abcac', wide: true },
  ],

  parse(vals) {
    const text = vals.text.trim(), pat = vals.pat.trim();
    if (!/^[a-zA-Z0-9]+$/.test(pat) || pat.length < 2 || pat.length > 10) throw { message: '模式串须为 2~10 个字母/数字' };
    if (!/^[a-zA-Z0-9]+$/.test(text) || text.length < pat.length || text.length > 24) throw { message: '主串须为 2~24 个字母/数字，且不短于模式串' };
    return { text: text.split(''), pat: pat.split('') };
  },

  buildSnapshots(model) {
    const { text, pat } = model;
    const m = pat.length;
    /* 0 基 fail[j] = p[0..j] 最长相等前后缀长度 */
    const fail = Array(m).fill(0);
    let k = 0;
    for (let j = 1; j < m; j++) {
      while (k > 0 && pat[j] !== pat[k]) k = fail[k - 1];
      if (pat[j] === pat[k]) k++;
      fail[j] = k;
    }
    const nextText = Array.from({ length: m }, (_, j) => j === 0 ? 0 : fail[j - 1] + 1);  // 教材 1 基口径

    const snaps = [];
    const push = (phase, o) => snaps.push({
      phase, text: [...text], pat: [...pat], i: -1, j: -1, cmpCh: '', fail: [...fail], nextText: [...nextText],
      ti: Array(text.length).fill(false), pj: Array(m).fill(false), count: 0,
      matches: [], log: '', logType: 'info', desc: '', ...o,
    });

    push('init', { log: `就绪：主串 "${text.join('')}"（${text.length}），模式串 "${pat.join('')}"（${m}）。先求 fail/next 数组，再单步匹配。`, desc: '先求 fail，再匹配' });

    /* 阶段一：求 fail */
    k = 0;
    for (let j = 1; j < m; j++) {
      while (k > 0 && pat[j] !== pat[k]) k = fail[k - 1];
      if (pat[j] === pat[k]) k++;
      fail[j] = k;
      push('next', { j, fail: [...fail],
        log: `fail[${j}]（p[${j}] = ${pat[j]}）：p[0..${j}] 的最长相等前后缀长度 = ${k}`,
        desc: `fail[${j}] = ${k}（next 表口径：${nextText[j]}）` });
    }
    push('next-done', { log: `fail = [${fail.join(', ')}]；换算教材 next（1 基）：next = [${nextText.map((v, j) => (j + 1) + '→' + v).join(', ')}]。开始匹配。`,
      logType: 'success', desc: 'fail/next 求解完成，进入匹配阶段' });

    /* 阶段二：匹配 */
    const ti = Array(text.length).fill(false);
    let i = 0, j = 0, count = 0;
    const matches = [];
    while (i < text.length) {
      count++;
      const cmp = text[i] === pat[j] ? 'eq' : 'ne';
      if (cmp === 'eq') {
        ti[i] = true; i++; j++;
        if (j === m) {
          matches.push(i - m);
          j = fail[j - 1];
          push('match', { i, j, cmpCh: 'eq', ti: [...ti], pj: Array(m).fill(true), count, matches: [...matches],
            log: `模式串完全匹配！起始位置 ${matches[matches.length - 1]}（比较 ${count} 次）。j 回退到 fail[${m - 1}] = ${j} 继续找下一处`,
            logType: 'success', desc: `匹配成功：位置 ${matches[matches.length - 1]}` });
        } else {
          push('cmp', { i, j, cmpCh: 'eq', ti: [...ti], pj: pat.map((_, x) => x < j), count,
            log: `比较 主串[${i}] = ${text[i]} 与 模式[${j}] = ${pat[j]}：相等 → i++, j++`,
            desc: `字符相等，双双前进` });
        }
      } else {
        push('cmp', { i, j, cmpCh: 'ne', ti: [...ti], pj: pat.map((_, x) => x < j), count,
          log: `比较 主串[${i}] = ${text[i]} 与 模式[${j}] = ${pat[j]}：失配！`,
          logType: 'error', desc: `失配于模式位 ${j}` });
        if (j > 0) {
          const nj = fail[j - 1];
          push('slide', { i, j: nj, ti: [...ti], pj: pat.map((_, x) => x < nj), count,
            log: `j 回退：j = fail[${j - 1}] = ${nj}（模式串右滑，主串 i = ${i} 不回退——KMP 的核心优势）`,
            logType: 'warn', desc: `j 滑动到 ${nj}，i 不动` });
          j = nj;
        } else {
          i++;
          push('slide', { i, j: 0, ti: [...ti], count, log: `j 已在模式串首位仍失配 → i++（主串前进 1 位）`, desc: 'i 前进' });
        }
      }
    }
    push('done', { matches: [...matches], count,
      log: `匹配结束：共找到 ${matches.length} 处（起始位置 ${matches.join('、') || '无'}），总比较次数 ${count}（暴力法最坏 ${text.length * m} 次）。`,
      logType: 'success', desc: `完成：${matches.length} 处匹配，比较 ${count} 次` });
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    const cellRow = (chars, marks, cls) => `<div class="flex gap-1 justify-center flex-wrap">${chars.map((c, i) =>
      `<div class="frame-cell" style="width:34px;height:40px;border-radius:7px;${marks[i] ? 'border-color:#10b981;background:#ecfdf5;' : ''}${cls && cls[i] ? 'border-color:#f59e0b;background:#fffbeb;' : ''}">
        <span class="page-num" style="font-size:15px">${c}</span></div>`).join('')}</div>`;

    const nextCells = s.fail.map((f, j) => `<div class="flex flex-col items-center gap-0.5">
      <div class="bit-cell ${s.phase === 'next' && s.j === j ? 'bit-tag' : 'bit-host'}" style="width:34px;height:30px;font-size:12px">${f}</div>
      <span class="text-[9px] font-mono text-slate-400">fail[${j}]</span>
      <span class="text-[9px] font-mono text-indigo-500">next=${s.nextText[j]}</span></div>`).join('');

    const stats =
      RC408.ui.statCard('匹配阶段', { init: '—', next: '求 fail/next', 'next-done': '完成', cmp: '逐字符比较', slide: '失配滑动', match: '完全匹配', done: '结束' }[s.phase] || '—') +
      RC408.ui.statCard('主串指针 i', s.i < 0 ? '—' : s.i, 'KMP 中永不回退', 'text-indigo-600') +
      RC408.ui.statCard('模式指针 j', s.j < 0 ? '—' : s.j, '失配时跳 fail[j-1]', 'text-amber-600') +
      RC408.ui.statCard('比较次数', s.count, 'O(n + m)', 'text-rose-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 overflow-x-auto">
          ${RC408.ui.sectionTitle('fail / next 数组（上 = fail 0 基；下 = 教材 next 1 基；琥珀 = 当前求解位）')}
          <div class="flex gap-1 justify-center flex-wrap">${nextCells}</div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('匹配过程（绿 = 已确认相等；琥珀 = 本帧比较位）')}
          <div><span class="text-xs font-bold text-slate-500 mr-2">主串</span>${cellRow(s.text, s.ti, s.cmpCh === 'ne' && s.i >= 0 ? [s.i] : null)}</div>
          <div><span class="text-xs font-bold text-slate-500 mr-2">模式</span>${cellRow(s.pat, s.pj, s.cmpCh === 'ne' && s.j >= 0 ? [s.j] : null)}</div>
        </div>
        ${s.matches && s.matches.length ? `<div>${RC408.ui.sectionTitle('匹配位置')}<div class="flex flex-wrap gap-1.5">${s.matches.map(m2 => RC408.ui.chip('起始位置 ' + m2, 'chip-hit')).join(' ')}</div></div>` : ''}
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900">
          💡 <b>考点提醒：</b>失配时主串 i 不回退是 KMP 的灵魂；2015 年真题问"失配后 i、j 各是多少"——只需看 fail[j-1]；2024 年的 nextval 是"若 p[j]=p[next[j]] 则继承其修正值"。
        </div>
      </div>`;
  },
});

