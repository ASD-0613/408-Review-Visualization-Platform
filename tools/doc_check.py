#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
doc_check.py —— handover / README 里的"与代码绑定的数字"一致性自检
================================================================================
背景：文档计数过时是本项目反复出问题的地方（模块数 28→34→35、exam-history 30→39→40、
      理论卡 45→43、火苗 33→32、静态资源 v=N、条目数 103→96…），历史上多次靠事后发现。
      本脚本把"人肉同步"变成"跑一条命令"，收尾时执行一次即可。

用法（沙箱里 python 必须写全路径；命令里不要用管道）：
    & 'D:\\anaconda\\python.exe' tools/doc_check.py            # 自检，全部一致 exit 0，有差异 exit 1
    & 'D:\\anaconda\\python.exe' tools/doc_check.py --list     # 只打印实测值（不比对文档）

比对范围：只查"文档里写死、且能从代码算出来"的数字，避免噪声；
文档里找不到对应句子的项会标「?」提示（说明文档结构变了，需人工看一眼），不算失败。

窗9 起新增"模块 JS 语法"项、窗12 新增"模块 theory 数学定界符"项，
窗13 新增第 12 项"handover 自述数字/过时措辞"（**只扫"当前状态区"**：§0 / §3.5 / §3.8 /
§6.2.<最大序号> / §6.5 / §6.6 最上一行 / §7；**历史节按设计豁免**）——
它顺带把"theory 文案体检"的真实进度从模块文件现算出来打印（当前状态不再靠人肉维护）。
================================================================================
"""
import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def read(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return ''
    with open(p, encoding='utf-8') as f:
        return f.read()


def measure():
    app = read('js/app.js')
    eh = read('js/exam-history.js')
    html = read('index.html')
    files = [os.path.basename(p) for p in glob.glob(os.path.join(ROOT, 'js', 'modules', '*.js'))]
    return {
        'app_ids': len(re.findall(r"\{ id: '[\w-]+'", app)),
        'ready': len(re.findall(r"status: 'ready'", app)),
        'theory': len(re.findall(r"status: 'theory'", app)),
        'wip': len(re.findall(r"status: 'wip'", app)),
        'hot': len(re.findall(r'hot: true', app)),
        'eh_keys': len(re.findall(r"(?m)^  '[\w-]+': \[", eh)),
        'eh_rows': len(re.findall(r'\{ y: \d{4},', eh)),
        'module_files': len(files),
        'versions': sorted(set(re.findall(r'\?v=(\d+)', html)), key=int),
    }


# (说明, 实测键, 文件名, 正则（首个捕获组必须是数字）, 是否必须命中)
CHECKS = [
    ('handover：exam-history 条数', 'eh_keys', 'docs/handover.md', r'★ (\d+) 条逐年考察数据', True),
    ('handover：模块文件数（§5 结构）', 'module_files', 'docs/handover.md', r'modules/\s+(\d+) 个模块文件', True),
    ('handover：已实现模块数（§4.4）', 'module_files', 'docs/handover.md', r'已实现模块清单（(\d+) 个', True),
    ('handover：app.js 条目数', 'app_ids', 'docs/handover.md', r'目录树（对齐 2026 考纲，(\d+) 条目', True),
    ('handover：理论速记卡数（§4.5）', 'theory', 'docs/handover.md', r'理论速记卡（\*\*(\d+) 个\*\*', True),
    ('handover：建设中条数', 'wip', 'docs/handover.md', r'建设中 (\d+)', False),
    ('handover：火苗 hot 数（§1.5）', 'hot', 'docs/handover.md', r'`hot:true` 实测 \*\*(\d+)\*\*', True),
    ('handover：静态资源版本（§6.4）', 'version', 'docs/handover.md', r'静态资源版本：\*\*v=(\d+)\*\*', True),
    ('README：已实现模块总览', 'module_files', 'README.md', r'已实现模块总览（(\d+) 个', True),
    # 窗6：README 去内部化后不再有"目录结构"节，此项检查随之移除（模块文件数由 handover §5 那一项覆盖）
]


def module_syntax_check():
    """窗9 新增：每个 js/modules/*.js 必须能**通过 JS 语法解析**。

    背景：模块 `theory` 是模板字面量，Markdown 行内代码若写成**裸反引号**（没转义）会把模板
    字面量提前截断 → 整个模块文件 SyntaxError。窗8（net-switch）与窗9（ds-hash）各踩一次，
    而 `doc_check` 原来只查数字、**查不出这类编译期错误**（要等下一窗打开页面才发现）。
    做法：把文件复制成 .mjs 交给 `node --check` 只做语法解析（不执行 → 不会碰 RC408 / DOM）。
    ⚠ 沙箱硬约束（窗9 实测）：**python 的 subprocess 不能捕获子进程输出**——`capture_output=True`
      会走 Windows 命名管道，沙箱下直接 `PermissionError: [WinError 5] 拒绝访问`（与 §3.5-9② 同源）。
      所以这里**把 stderr 重定向到临时文件**再读（不用管道），node 缺失/环境异常一律跳过本项（不误伤）。
    """
    bad = []
    names = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, 'js', 'modules', '*.js')))
    for name in names:
        src = os.path.join(ROOT, 'js', 'modules', name)
        tmp = os.path.join(tempfile.gettempdir(), '_dscheck_' + name.replace('.js', '.mjs'))
        errf = tmp + '.err'
        try:
            shutil.copyfile(src, tmp)
            with open(errf, 'w+', encoding='utf-8', errors='replace') as ferr:
                r = subprocess.run(['node', '--check', tmp], stdout=subprocess.DEVNULL,
                                   stderr=ferr, timeout=30)
            if r.returncode != 0:
                with open(errf, encoding='utf-8', errors='replace') as f:
                    bad.append((name, f.read().strip().splitlines()[:2]))
        except FileNotFoundError:
            return None, []              # 本机没有 node → 跳过本项（不误伤）
        except Exception:
            return None, []
        finally:
            for p in (tmp, errf):
                try:
                    os.remove(p)
                except Exception:
                    pass
    return len(names), bad


def module_math_check():
    """窗12 新增：模块 `theory` 里的**数学定界符**必须是框架认识的那两种，且本身写对。

    背景（窗12 实测，一次普查查出 5 个模块有问题）：
      · **写成一个反斜杠的 `\\(`**：theory 是**模板字面量**，源码里的 `\\(` 求值就是裸 `(`，
        KaTeX 永远拿不到数学环境 → 用户看到字面量 `C_{out} oplus C_{n-1}`。
        窗10 只修了 framework 的定界符，并断言"模块源码一直是好的"——那句普查是按
        **双反斜杠**匹配的，于是漏掉了写成单反斜杠的 4 个模块
        （coa-fixadd / ds-binsearch / ds-topo / net-shannon，窗12 已修）。
      · **用 `\\[…\\]` 当显示公式定界符**：`js/framework.js` 的 auto-render 只声明了
        `$$`（display）与 `\\(`/`\\)`（inline）两种，`\\[…\\]` **永远不会被消费**
        （net-window 的信道利用率公式，窗12 已改成 `$$…$$`）。
      · 顺带查：`\\(`/`\\)` 是否成对、`$$` 是否为偶数个、
        以及**数学环境里的中文**（KaTeX 要求 `\\text{…}` 包裹，窗10 定的规矩）。

    判据：以上任一不合格 → 本项失败（exit 1）。**这条检查不依赖浏览器**，写完模块跑一次即可。
    """
    problems = []
    names = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, 'js', 'modules', '*.js')))
    for name in names:
        src = read(os.path.join('js', 'modules', name))
        si = src.find('theory: ' + '`')
        if si < 0:
            continue
        ei = src.find('\n`,', si)
        body = src[si + 9: ei if ei > 0 else len(src)]

        one = len(re.findall(r'(?<!\\)\\\(', body)) + len(re.findall(r'(?<!\\)\\\)', body))
        two = len(re.findall(r'\\\\\(', body)) + len(re.findall(r'\\\\\)', body))
        if one:
            problems.append((name, '有 %d 处单反斜杠定界符（源码里 `\\(` 求值就是裸括号，KaTeX 收不到）' % one))
        if two % 2:
            problems.append((name, '`\\(`/`\\)` 不成对（共 %d 个）' % two))
        if len(re.findall(r'\\\[', body)) and len(re.findall(r'\\\]', body)):
            problems.append((name, '用了 `\\[…\\]` 当显示公式定界符——framework 只认 `$$` 与 `\\(…\\)`'))
        if len(re.findall(r'\$\$', body)) % 2:
            problems.append((name, '`$$` 个数为奇数，显示公式没闭合'))
        for seg in re.findall(r'\\\\\((.*?)\\\\\)', body, re.S):
            bare = re.sub(r'\\text\{[^}]*\}', '', re.sub(r'\\mathrm\{[^}]*\}', '', seg))
            if re.search(r'[\u4e00-\u9fa5]', bare):
                problems.append((name, '数学环境里有中文（要用 \\text{} 包起来）：' + seg.strip()[:30]))
    return len(names), problems


def theory_progress():
    """窗13 新增：从模块文件**现算**"theory 文案体检"的真实进度。

    判据 = §3.8-16 的三问标记（`为什么要有它` / `怎么实现` / `记住什么`）在一个模块的源码里齐全。
    于是"已完成 N/45"这类自述数字有了**机器可算的真值**，不必再靠人肉维护
    （窗13 实测：§3.8-16 的进度曾长期停在"20 个"，已经落后两批）。
    返回 (totals, done)，按书前缀统计。
    """
    totals, done = {}, {}
    for p in glob.glob(os.path.join(ROOT, 'js', 'modules', '*.js')):
        name = os.path.basename(p)
        book = name.split('-')[0]
        totals[book] = totals.get(book, 0) + 1
        src = read(os.path.join('js', 'modules', name))
        if all(mk in src for mk in ('为什么要有它', '怎么实现', '记住什么')):
            done[book] = done.get(book, 0) + 1
    return totals, done


def _head_idx(lines, prefix, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    return -1


def handover_selfcheck(version, totals, done):
    """窗13 新增：handover **"当前状态区"**的自述数字 / 过时措辞自检（第 12 项）。

    背景（窗13 实测三处漂移）：窗口习惯只更新**明细位置**，于是写在**摘要位置**的字会长期留旧值——
      · §7 提示词模板写着"`overview`/`comments`/`t5chk` 三个模式"，而 §3.5-24 早已要求**四模式**（含 `years`）；
      · §3.8-16 的体检进度停在"已完成 20 个"（其实已 30 个）；
      · 某窗记的 `strayBackslash=0` 与实测矛盾（判据缺陷，见 §3.8-17④）。
    这三处 `doc_check` 原来一处都查不到，因为那些字**不在"能从代码算出来的结构化位置"**。

    做法：**只扫"当前状态区"**——§0 / §3.5 / §3.8 / `§6.2.<最大序号>` / §6.5 / §6.6 第一条数据行 / §7；
    其余 §6.2.N 与 §6.6 的历史行**按设计豁免**（历史里写"当时剩 10 个"是对的，不该判红）。
    数字全部**机器现算**：done/total 由模块文件的三问标记数出，version 由 index.html 数出。
    ⚠ 判据自身也做过注入测试（`node tmp_t13_doccheck_selftest.js`：故意改错 → 必须 exit 1 → 自动还原）。
    """
    text = read('docs/handover.md')
    lines = text.split('\n')

    regions = {}
    def grab(name, start_prefix, end_prefix):
        s = _head_idx(lines, start_prefix)
        if s < 0:
            return
        e = _head_idx(lines, end_prefix, s + 1)
        regions[name] = '\n'.join(lines[s:e if e > 0 else len(lines)])

    grab('§0', '## 0. 新窗最快上手', '## 1. ')
    grab('§3.5', '### 3.5 ', '### 3.6 ')
    grab('§3.8', '### 3.8 ', '### 3.9 ')
    grab('§6.5', '### 6.5 ', '### 6.6 ')
    grab('§7', '## 7. ', '## 8. ')
    # §6.2.<最大序号>：本窗自己写的那一节（历史节一律豁免）
    subs = [int(m.group(1)) for m in (re.match(r'### 6\.2\.(\d+)', l) for l in lines) if m]
    if subs:
        n = max(subs)
        grab('§6.2.%d' % n, '### 6.2.%d ' % n, '### ')
    # §6.6 的第一条窗口数据行（= 最新一窗）
    s66 = _head_idx(lines, '### 6.6 ')
    if s66 >= 0:
        for l in lines[s66:]:
            if re.match(r'\| \*?\*?窗\d', l) or l.startswith('| 窗0'):
                regions['§6.6 最上一行'] = l
                break

    probs = []
    done_total = sum(done.values())
    total_all = sum(totals.values())

    for rname, rtext in regions.items():
        for m in re.finditer(r'已完成\s*(\d+)\s*/\s*' + str(total_all), rtext):
            if int(m.group(1)) != done_total:
                probs.append('%s：体检进度写 %s/%d，实测 %d/%d' % (rname, m.group(1), total_all, done_total, total_all))
        for m in re.finditer(r'个模块\*\*已完成\s*(\d+)\s*个', rtext):
            if int(m.group(1)) != done_total:
                probs.append('%s：体检进度写"已完成 %s 个"，实测 %d 个' % (rname, m.group(1), done_total))
        for m in re.finditer(r'(?:剩|未做[：:]\s*)\s*`?(ds|coa|os|net)`?\s*(\d+)\s*个', rtext):
            book, num = m.group(1), int(m.group(2))
            real = totals.get(book, 0) - done.get(book, 0)
            if num != real:
                probs.append('%s：`%s` 剩 %d 个，实测未做 %d 个（共 %d）' % (rname, book, num, real, totals.get(book, 0)))
        for m in re.finditer(r'v=(\d+)\s*→\s*(\d+)', rtext):
            if int(m.group(2)) != int(version):
                probs.append('%s：写 `v=%s → %s`，当前静态资源实际是 v=%s' % (rname, m.group(1), m.group(2), version))
        if '三模式' in rtext or '三个模式' in rtext:
            probs.append('%s：仍在说"三个模式"——`tmp_readme_audit.js check` 现在跑**四**模式（overview/t5chk/years/comments）' % rname)
    return done_total, total_all, probs


def layout_check():
    """窗13 新增（第 13 项）：handover 的**排版硬约束**（规范见 §8.6）。

    背景（用户 2026-09-21 反馈"整体观感混乱、希望像 API 文档那样按需检索"）：排版规范写成文字
    没有用，必须能被机器拦住——否则下一个窗口照样会把正文并进标题、把 2000 字符塞进表格单元格、
    新加一节却不进 §0 导航。判据四条（都在 §8.6 里写明）：
      ① §0 ≤ 150 行（入口一膨胀，"按需检索"就失效）；
      ② 标题层级不跳级（`##` 不得直接跳到 `####`）；
      ③ §0.1 总导航必须覆盖所有 `## N.` 顶层节（新增顶层节必须进导航）；
      ④ §6.6.0 摘要表每行 ≤ 400 字符（定窗号这一步要便宜；历史明细在 §6.6.1、不受此限）。
    """
    lines = read('docs/handover.md').split('\n')
    probs = []

    i0, i1 = _head_idx(lines, '## 0. '), _head_idx(lines, '## 1. ')
    sec0 = '\n'.join(lines[i0:i1]) if (i0 >= 0 and i1 > i0) else ''
    if i0 >= 0 and i1 > i0 and (i1 - i0) > 150:
        probs.append('§0 有 %d 行（上限 150，§8.6-1）' % (i1 - i0))

    prev = 0
    for i, l in enumerate(lines):
        m = re.match(r'^(#{2,4}) ', l)
        if not m:
            continue
        lv = len(m.group(1))
        if prev and lv > prev + 1:
            probs.append('标题跳级：第 %d 行 %s → %s（§8.6-2）%s' % (i + 1, '#' * prev, '#' * lv, l[:30]))
        prev = lv

    for i, l in enumerate(lines):
        m = re.match(r'^## (\d+)\. ', l)
        if m and ('| **%s** |' % m.group(1)) not in sec0:
            probs.append('§0.1 总导航缺 §%s（§8.6-3：新增顶层节必须进导航）' % m.group(1))

    i66 = _head_idx(lines, '### 6.6 ')
    i661 = _head_idx(lines, '#### 6.6.1 ')
    if i66 >= 0:
        for i in range(i66, i661 if i661 > i66 else len(lines)):
            if re.match(r'^\| \*?\*?窗', lines[i]) and len(lines[i]) > 400:
                probs.append('§6.6.0 摘要表第 %d 行 %d 字符（上限 400，§8.6-4）' % (i + 1, len(lines[i])))
    return probs


def _prose(text):
    """把 handover 剥成"散文"：去掉 fenced 代码块与反引号内的代码跨度。

    §8.8 的度量衡规则**只对散文生效**——程序语法里的 `-->`、`->`、`>=`、`<!-- -->` 不许被"统一"掉，
    引用的工具输出（放在反引号里）也必须原样保留。这一步是判据不误报的前提。
    """
    text = re.sub(r'(?ms)^```.*?^```', '\n', text)      # fenced code block
    text = re.sub(r'```[^`]*```', ' ', text)            # 单行 fenced
    text = re.sub(r'`[^`\n]*`', ' ', text)              # inline code span
    return text


def wording_check():
    """窗13 新增（第 14 项）：**度量衡**（§8.8）——术语 / 数字 / 符号 / 句长的统一。

    背景（用户 2026-09-21 提出）：本文件由几十个窗口接力写，文风与符号各写各的，
    "同一件事三个名字、同一个数字两种写法"会让下一窗现场猜。§8.8 把标准写死，
    这里只把**客观可判**的那几条变成机器检查（散文里必须为 0）：
      ① 半角箭头 `->` ② 全角波浪线 `～` ③ "所以"箭头 `⇒` ④ 半角比较符 `>=` / `<=`
      ⑤ 旧式年份写法 `18 年中 N 年` ⑥ "上个窗口" / "本窗口" ⑦ 表格行 > 500 字符。
    ⚠ 豁免：`docs/handover-history.md`（历史归档，按当时原样保留）与代码跨度 / 代码块。
    ⚠ 实测（窗13 收尾）：`->` 的 11 处**全在代码跨度或 HTML 注释里**（假阳性）——所以这条判据
      的价值是**防复发**，不是修现状；真正修掉的是 `～` 2 处、`⇒` 4 处、旧式年份 3 处、"上个窗口" 3 处、
      两个 600+ 字符的巨型单元格（625 → 311、712 → 226）。
    """
    prose = _prose(read('docs/handover.md'))
    probs = []
    rules = [
        (r'->', '散文里出现半角箭头，统一 `→`（程序输出请放进反引号）'),
        (r'～', '散文里出现全角波浪线，范围统一 `~`'),
        (r'⇒', '散文里出现 `⇒`，"所以"统一 `⟹`（同一处只用一种）'),
        (r'(?<![<>=])>=|(?<![<>=])<=', '散文里出现半角比较符，统一 `≥` / `≤`'),
        (r'18\s*年中\s*\d+\s*年', '旧式年份写法，统一 `N/18 年`'),
        (r'上个窗口|本窗口', '窗号称法不统一，用 `上一窗` / `本窗`'),
    ]
    for pat, why in rules:
        m = re.search(pat, prose)
        if m:
            probs.append('%s（命中「%s」）' % (why, m.group(0)))
    lines = read('docs/handover.md').split('\n')
    over = [(i + 1, len(l)) for i, l in enumerate(lines) if l.startswith('|') and len(l) > 500]
    if over:
        probs.append('表格行超过 500 字符：行 %s（§8.8.6；超了拆行或搬进 §6.2.N）'
                     % '、'.join('%d=%d字符' % (a, b) for a, b in over[:5]))
    return probs


def main():
    ap = argparse.ArgumentParser(description='handover/README 文档计数自检')
    ap.add_argument('--list', action='store_true', help='只打印实测值')
    a = ap.parse_args()

    m = measure()
    if a.list:
        for k, v in m.items():
            print('  %-14s %s' % (k, v))
        return 0

    m['version'] = m['versions'][-1] if m['versions'] else '0'
    bad, unknown = [], []
    print('实测值：条目 %d（ready %d / 纯理论 %d / 建设中 %d）｜ hot %d ｜ 模块文件 %d ｜ '
          'exam-history %d 条 ｜ 静态资源 v=%s'
          % (m['app_ids'], m['ready'], m['theory'], m['wip'], m['hot'], m['module_files'],
             m['eh_keys'], m['version']))
    print('-' * 78)
    for label, key, fname, pat, must in CHECKS:
        text = read(fname)
        found = re.search(pat, text)
        if not found:
            (unknown if must else None) and unknown.append(label)
            print('  ?  %-34s 文档里没找到对应句子（结构变了？请人工看一眼）' % label)
            continue
        doc_val, real = int(found.group(1)), int(m[key])
        if doc_val == real:
            print('  OK %-34s %d' % (label, doc_val))
        else:
            bad.append((label, fname, doc_val, real))
            print('  ✖  %-34s 文档写 %d，实际 %d（改 %s）' % (label, doc_val, real, fname))
    print('-' * 78)
    n_mod, bad_mod = module_syntax_check()
    if n_mod is None:
        print('  ·  %-34s 跳过（node 不可用）' % '模块文件 JS 语法')
    elif bad_mod:
        for name, err in bad_mod:
            bad.append(('模块 JS 语法', 'js/modules/' + name, 0, 0))
            print('  ✖  %-34s %s' % ('模块 JS 语法', name + ' → ' + (err[0] if err else 'SyntaxError')))
    else:
        print('  OK %-34s %d 个文件全部通过 node --check' % ('模块 JS 语法', n_mod))
    n_mm, bad_mm = module_math_check()
    for name, why in bad_mm:
        bad.append(('模块 theory 数学定界符', 'js/modules/' + name, 0, 0))
        print('  ✖  %-34s %s：%s' % ('模块 theory 数学定界符', name, why))
    if not bad_mm:
        print('  OK %-34s %d 个文件全部合格（成对 \\(…\\)、无 \\[…\\]、数学里无中文）'
              % ('模块 theory 数学定界符', n_mm))
    # 窗13 新增第 12 项：handover"当前状态区"的自述数字 / 过时措辞
    totals, done = theory_progress()
    n_done, n_all, probs = handover_selfcheck(m['version'], totals, done)
    detail = ' · '.join('%s %d/%d' % (b.upper(), done.get(b, 0), totals[b])
                        for b in ('os', 'coa', 'net', 'ds') if b in totals)
    if probs:
        for why in probs:
            bad.append(('handover 自述数字/措辞', 'docs/handover.md', 0, 0))
            print('  ✖  %-34s %s' % ('handover 自述数字/措辞', why))
    else:
        print('  OK %-34s %d/%d（%s）' % ('handover：theory 体检进度', n_done, n_all, detail))
    # 窗13 新增第 13 项：排版硬约束（§8.6）
    lay = layout_check()
    if lay:
        for why in lay:
            bad.append(('handover 排版硬约束', 'docs/handover.md', 0, 0))
            print('  ✖  %-34s %s' % ('handover 排版硬约束', why))
    else:
        print('  OK %-34s §0≤150 行、标题不跳级、导航齐、摘要表行宽合规' % 'handover 排版硬约束')
    # 窗13 新增第 14 项：度量衡（§8.8）
    wd = wording_check()
    if wd:
        for why in wd:
            bad.append(('handover 度量衡', 'docs/handover.md', 0, 0))
            print('  ✖  %-34s %s' % ('handover 度量衡', why))
    else:
        print('  OK %-34s 散文符号/数字/窗号统一、表格行 ≤500 字符' % 'handover 度量衡')
    print('-' * 78)
    if bad:
        print('✖ %d 处不一致；改完再跑一次本脚本' % len(bad))
        return 1
    if unknown:
        print('△ %d 处未找到对应句子（非致命，建议人工确认）' % len(unknown))
    else:
        print('✔ 文档计数与代码一致')
    return 0


if __name__ == '__main__':
    sys.exit(main())
