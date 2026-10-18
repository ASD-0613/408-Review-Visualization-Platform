'use strict';
/* ============================================================================
 * anno-seed-2026.js —— 窗48「考生轨」的**标注留档**（用户 2026-10-09："在网站上标注出来，让我能看到"）
 * ----------------------------------------------------------------------------
 * 内容 = 做题时"平台依据"点到的那些句子，逐条换算成 `{ b, s, e }`（b = #theory-body 直接子块下标，
 *   s/e = 该块内**可标注文本**的字符区间），与 `rc408.anno.v1` 的数据模型完全一致。
 * 生成方式（可复现）：`node tmp_t48_anno.js --run` 在专用 profile 里逐卡 setRanges+apply，
 *   再把 `localStorage['rc408.anno.v1']` dump 成 `tmp_t48_anno_dump.json`，本文件由
 *   `node tmp_t48_seed_gen.js --write` **逐字转写**（不手抄）。
 * 怎么看到：**打开站点就有**（annotate.js 的 `seedFromUrl()` 在 init 时默认合并本文件；
 *   已存在的同 id 标注不覆盖）。想清掉：逐卡「清空标注」，或控制台 `localStorage.removeItem('rc408.anno.v1')`。
 *   调试用开关：`?anno=2026` 只载入这一份；`?anno=off` 一律不载入。
 * 33 个知识点 / 35 段。
 * ========================================================================== */
(function () {
  if (typeof RC408 === 'undefined') return;
  RC408.annoSeeds = RC408.annoSeeds || {};
  RC408.annoSeeds['2026'] = {
    'ds-seqlist': [{ b: 3, s: 46, e: 54 }, { b: 3, s: 55, e: 72 }],
    'ds-dlink': [{ b: 12, s: 252, e: 260 }, { b: 12, s: 293, e: 306 }],
    'ds-tree-forest': [{ b: 9, s: 372, e: 396 }],
    'ds-huffman': [{ b: 2, s: 16, e: 26 }],
    'ds-graph-basic': [{ b: 3, s: 186, e: 195 }],
    'ds-graph-storage': [{ b: 6, s: 113, e: 125 }],
    'ds-bst-avl': [{ b: 12, s: 118, e: 125 }],
    'ds-radix': [{ b: 8, s: 55, e: 69 }],
    'ds-extsort': [{ b: 17, s: 8, e: 18 }],
    'ds-stack-queue': [{ b: 4, s: 46, e: 53 }],
    'coa-hierarchy': [{ b: 5, s: 168, e: 175 }],
    'coa-perf': [{ b: 0, s: 79, e: 101 }],
    'coa-shift': [{ b: 0, s: 220, e: 239 }],
    'coa-float754': [{ b: 9, s: 118, e: 126 }],
    'coa-mainmem-pins': [{ b: 6, s: 188, e: 191 }],
    'coa-cache-assoc': [{ b: 0, s: 85, e: 101 }],
    'coa-vm': [{ b: 2, s: 293, e: 314 }],
    'coa-inst-format': [{ b: 7, s: 48, e: 60 }],
    'coa-interrupt': [{ b: 12, s: 75, e: 87 }],
    'coa-datapath': [{ b: 0, s: 132, e: 138 }],
    'os-intro': [{ b: 3, s: 25, e: 46 }],
    'os-thread': [{ b: 5, s: 182, e: 195 }],
    'os-page-replace': [{ b: 4, s: 98, e: 108 }],
    'os-sched': [{ b: 6, s: 105, e: 109 }],
    'os-ipc': [{ b: 0, s: 88, e: 99 }],
    'net-layers': [{ b: 8, s: 0, e: 12 }],
    'net-perf': [{ b: 7, s: 30, e: 35 }],
    'net-csma': [{ b: 12, s: 149, e: 166 }],
    'net-routing': [{ b: 5, s: 293, e: 304 }],
    'net-http': [{ b: 11, s: 69, e: 75 }],
    'net-tcp-conn': [{ b: 0, s: 222, e: 240 }],
    'net-tcp-cc': [{ b: 0, s: 243, e: 265 }],
    'os-file-alloc': [{ b: 3, s: 102, e: 115 }],
  };
})();
