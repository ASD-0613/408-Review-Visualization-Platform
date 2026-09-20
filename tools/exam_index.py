#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
exam_index.py —— 408 真题「考情缓存」生成与查询工具（把查真题从"开 PDF"变成"grep 一个文本文件"）
================================================================================
背景：每开一个新窗口都要用 PyMuPDF 现场抽 PDF、遇到扫描页还得渲染成图用眼睛看，
      慢且吃 token。本工具一次性把 2009–2026 全部真题/解析拆成纯文本 + 按题号切块 +
      关键词索引，落到被 .gitignore 排除的 `考情缓存/` 目录；此后查阅只需 grep。

用法（本机 python 必须写全路径，沙箱 PATH 上的 python 不可用；命令里不要用管道）：
    & 'D:\\anaconda\\python.exe' tools/exam_index.py --build          # 全量重建缓存（约 30 秒）
    & 'D:\\anaconda\\python.exe' tools/exam_index.py --stats          # 看缓存概况
    & 'D:\\anaconda\\python.exe' tools/exam_index.py --ask 深度优先    # 查关键词
    & 'D:\\anaconda\\python.exe' tools/exam_index.py --paper 2020     # 看某年整卷题号+摘要
    & 'D:\\anaconda\\python.exe' tools/exam_index.py --render 2023 6 --kind 解析
                                                                     # 扫描页渲染成 PNG，再用 read_image 看

产物（都在 考情缓存/，已 gitignore）：
    关键词索引.md   考点关键词 → 命中年份题号 + 原文上下文（**日常查阅首选**）
    逐年速查.md     每年 1–47 题的题号 / 选择或大题 / 科目 / 首句摘要（一眼看清整卷结构）
    扫描件清单.md   无文本层的 PDF 页清单（只有这些才需要 --render + 看图）
    <年份>_真题.txt / <年份>_解析.txt   逐页全文，带 [[pN]] 页码标记（grep 原文用）
    index.json      结构化索引（题号 → 全文块，供脚本二次处理）
================================================================================
"""
import argparse
import glob
import json
import os
import re
import sys

try:
    import pymupdf
except ImportError:  # 兼容旧包名
    import fitz as pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(ROOT, '408真题及解析')
CACHE_DIR = os.path.join(ROOT, '考情缓存')
SCAN_DIR = os.path.join(CACHE_DIR, '扫描页')

# 选择题科目分段（大题分段见 SUBJ_BIG，2019 年大题顺序特殊）
SUBJ_SEL = [(1, 11, 'DS'), (12, 22, 'COA'), (23, 32, 'OS'), (33, 40, 'NET')]
SUBJ_BIG = {2019: [(41, 42, 'DS'), (43, 44, 'OS'), (45, 46, 'COA'), (47, 47, 'NET')]}
SUBJ_BIG_DEFAULT = [(41, 42, 'DS'), (43, 44, 'COA'), (45, 46, 'OS'), (47, 47, 'NET')]

# 考点关键词（覆盖 35 个交互模块 + 45 张理论速记卡的考纲条目）
KEYWORDS = [
    # 数据结构
    '时间复杂度', '顺序表', '链表', '栈', '队列', '表达式', '中缀', '后缀', '矩阵', '压缩存储',
    '二叉树', '遍历', '线索', '哈夫曼', '编码', '并查集', '红黑树', '堆', '优先队列',
    '图', '邻接', '深度优先', '广度优先', '拓扑', '关键路径', 'AOE', '最小生成树', 'Prim',
    'Kruskal', 'Dijkstra', 'Floyd', '最短路径', '连通', '回路', '欧拉',
    '折半查找', '判定树', '散列', '哈希', '冲突', 'ASL', 'B 树', 'B+', 'B-树',
    'KMP', 'next', '排序', '希尔', '快速排序', '归并', '基数', '冒泡', '选择排序', '堆排序',
    '稳定性', '外部排序', '败者树', 'AVL', '平衡二叉树', '二叉排序树', 'BST',
    # 计算机组成原理
    'Cache', '组相联', '直接映射', '全相联', '命中率', '缺失', '地址划分', '比较器',
    '补码', '溢出', '标志位', 'CF', 'OF', '移码', 'IEEE', '754', '浮点', '规格化', '舍入',
    '寻址', '有效地址', '指令格式', '操作码', '机器码', '汇编', '数据通路', '控制信号',
    '流水线', '冒险', '转发', '气泡', 'CPI', 'MIPS', '性能', '加速比', 'Amdahl',
    '主存', 'DRAM', 'SRAM', '存储芯片', '扩展', '交叉编址', '总线', '带宽', '磁盘', '寻道',
    '中断', '异常', 'DMA', 'I/O', '程序查询', '大小端', '对齐', '微程序', '多处理器', 'Flynn',
    # 操作系统
    '进程', '线程', '状态转换', '就绪', '阻塞', '调度', '周转时间', '响应比', '时间片',
    '同步', '互斥', 'PV', '信号量', '死锁', '银行家', '安全序列', '管程', 'IPC', '管道',
    '分页', '页表', '快表', 'TLB', '缺页', '页面置换', 'LRU', 'FIFO', 'CLOCK', '虚拟内存',
    '逻辑地址', '物理地址', '动态分区', '碎片', '位示图', '索引结点', 'inode', '文件系统',
    '目录', '磁盘调度', 'SSTF', 'SCAN', '缓冲', '设备管理', '引导',
    # 计算机网络
    '层次结构', 'OSI', '时延', '带宽', '编码', '调制', '奈氏', '香农', '信噪比',
    '交换', 'CRC', '滑动窗口', '停等', 'GBN', 'SR', '重传', '超时',
    '子网', 'CIDR', '掩码', '分片', 'IP', 'IPv6', '路由', 'RIP', 'OSPF', 'BGP',
    'ARP', 'DHCP', 'NAT', 'ICMP', 'CSMA', '以太网', '交换机', 'VLAN', '自学习',
    'TCP', '握手', '挥手', '拥塞', '慢启动', '快重传', '流量控制', 'UDP',
    'DNS', 'HTTP', 'SMTP', 'POP3', 'FTP', 'Cookie', '邮件',
]

TAG = {'DS': '数据结构', 'COA': '组成原理', 'OS': '操作系统', 'NET': '计算机网络'}

# Windows 控制台默认 GBK，中文/符号会 UnicodeEncodeError → 强制 UTF-8 输出
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def log(msg):
    sys.stdout.write(str(msg) + '\n')


def subject_of(year, n):
    if n >= 41:
        table = SUBJ_BIG.get(year, SUBJ_BIG_DEFAULT)
        for a, b, s in table:
            if a <= n <= b:
                return s
        return '?'
    for a, b, s in SUBJ_SEL:
        if a <= n <= b:
            return s
    return '?'


def clean(s):
    s = s.replace('\u3000', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n{2,}', '\n', s)
    return s.strip()


def extract_pdf(path):
    """返回 (逐页文本列表, 全文带页码标记, 空页页码列表)"""
    doc = pymupdf.open(path)
    pages, empty = [], []
    for i, page in enumerate(doc, 1):
        t = clean(page.get_text())
        if len(t) < 5:
            empty.append(i)
        pages.append(t)
    doc.close()
    marked = '\n'.join('[[p%d]]\n%s' % (i, t) for i, t in enumerate(pages, 1))
    return pages, marked, empty


def split_questions(text, year):
    """按题号切块（v4 = 严格行首锚点 + 两条只删不加的排除规则）。
    踩过的坑（务必不要"放宽"回下面这些写法）：
      ① 「从 1 开始单调吃数字」会被卷首"答案速查表"（如 2015 卷首 "23. 31. 39. 8. 16. …"）带偏，
         曾把 2015-5 的内容标成 2015-8；
      ② 把行首锚点放宽成"数字前不是数字/字母"去抢救 2026（该年解析每行行首有页码噪声），
         结果切出 `7,0. D. 6,1.` 这类伪题号、2026-6 之类真题被顶掉——**放宽的代价大于收益**，
         2026 这类排版就老实标 `⚠ 极少`，让后来者 grep 全文 txt。
    结论：题号切块只做"高置信"匹配；宁可少切，不可错切。切块不出的年份靠全文 txt + 关键词兜底。
    """
    anchors = ('解析', '答案', '【', '解：', '答：')
    chosen, last = [], 0
    for n in range(1, 48):
        pat = re.compile(r'(?m)^[ \t]*0?%d\s*[\.．、,，]' % n)
        pos = None
        for m in pat.finditer(text):
            if m.start() <= last:
                continue
            window = text[m.start():m.start() + 80]
            if not any(a in window for a in anchors):
                continue
            # 排除 "A. 5. B. 6." 这类选项列表里的数字（前置是选项字母）
            if re.search(r'[A-D]\s*[\.．、]\s*$', text[max(0, m.start() - 8):m.start()]):
                continue
            pos = m.start()
            break
        if pos is None:
            continue
        chosen.append((n, pos))
        last = pos
    if not chosen:
        return [], {'found': [], 'missing': list(range(1, 48)), 'grade': 'none'}
    out = []
    for i, (n, pos) in enumerate(chosen):
        end = chosen[i + 1][1] if i + 1 < len(chosen) else len(text)
        body = text[pos:end].strip()
        pg = re.findall(r'\[\[p(\d+)\]\]', text[:pos])
        out.append({
            'y': year, 'n': n, 'k': '大' if n >= 41 else '选',
            'subj': subject_of(year, n),
            'page': int(pg[-1]) if pg else 0,
            'text': body,
            'brief': re.sub(r'\s+', ' ', body)[:80],
        })
    found = [n for n, _ in chosen]
    missing = [n for n in range(1, 48) if n not in found]
    grade = 'full' if len(found) >= 45 else ('part' if len(found) >= 12 else 'few')
    return out, {'found': found, 'missing': missing, 'grade': grade}


def build():
    if not os.path.isdir(PDF_DIR):
        log('✖ 找不到真题目录：%s' % PDF_DIR)
        return 1
    if not os.path.isdir(CACHE_DIR):
        os.makedirs(CACHE_DIR)

    pdfs = sorted(glob.glob(os.path.join(PDF_DIR, '*.pdf')))
    years, scanned, questions, raw_len, reliability = {}, [], [], 0, {}

    for p in pdfs:
        base = os.path.basename(p)
        m = re.search(r'(\d{4})', base)
        if not m:
            continue
        year = int(m.group(1))
        kind = '解析' if '解析' in base else '真题'
        pages, marked, empty = extract_pdf(p)
        raw_len += len(marked)
        with open(os.path.join(CACHE_DIR, '%d_%s.txt' % (year, kind)), 'w', encoding='utf-8') as f:
            f.write('# %s（共 %d 页；空文本页：%s）\n' % (base, len(pages), empty or '无'))
            f.write(marked)
        years.setdefault(year, {})[kind] = {'chars': len(marked), 'pages': len(pages)}
        for ep in empty:
            scanned.append({'y': year, 'kind': kind, 'p': ep, 'file': base})
        if kind == '解析':
            qs, rel = split_questions(marked, year)
            reliability[year] = rel
            for q in qs:
                q['src'] = base
            questions.extend(qs)

    questions.sort(key=lambda q: (q['y'], q['n']))

    # ---------- 关键词索引.md ----------
    lines = ['# 408 真题关键词索引（自动生成，勿手改；源：408真题与解析/ PDF）',
             '',
             '> 用法：`grep -n "关键词" 考情缓存/关键词索引.md`，或 `python tools/exam_index.py --ask 关键词`。',
             '> 题号规则：1–40 选择（DS 1-11 / COA 12-22 / OS 23-32 / NET 33-40），41–47 大题。',
             '']
    hit_total = 0
    for kw in KEYWORDS:
        hits, hit_years = [], []
        for q in questions:
            if kw in q['text']:
                at = q['text'].find(kw)
                ctx = re.sub(r'\s+', ' ', q['text'][max(0, at - 35):at + 35])
                g = reliability.get(q['y'], {}).get('grade', 'few')
                tag = '%d-%d' % (q['y'], q['n']) if g in ('full', 'part') else '%d-?（只信年份）' % q['y']
                hits.append('- %s %s %s [解析p%d] …%s…' % (tag, q['k'], TAG.get(q['subj'], '?'), q['page'], ctx))
                hit_years.append(q['y'])
        if not hits:
            continue
        hit_total += len(hits)
        yrs = sorted(set(hit_years))
        lines.append('## %s（命中 %d 处 / %d 个年份：%s）' % (kw, len(hits), len(yrs), '、'.join(map(str, yrs))))
        lines.extend(hits[:25])
        if len(hits) > 25:
            lines.append('- …（其余 %d 处省略；要全部命中请 grep 各年 全文 txt 或 index.json）' % (len(hits) - 25))
        lines.append('')
    with open(os.path.join(CACHE_DIR, '关键词索引.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    # ---------- 逐年速查.md ----------
    lines = ['# 408 逐年题号速查（自动生成；题干/解析摘要取每段首 80 字）',
             '',
             '> 完整度：`✔ 完整` = 47 题全部切出；`△ 部分` = 切出的题号可信、但缺号（缺号需 grep 原文 txt 核对）；',
             '> `⚠ 极少` = 该年解析基本无文本层（扫描件），只能按年份定位 + `--render` 渲染看图。',
             '']
    for year in sorted(years):
        qs = [q for q in questions if q['y'] == year]
        rel = reliability.get(year, {})
        g = rel.get('grade', 'none')
        if g == 'full':
            head = '✔ 完整（47/%d 题）' % len(qs)
        elif g == 'part':
            head = '△ 部分（切出 %d 题，缺 %s）' % (len(qs), '、'.join(str(x) for x in rel.get('missing', [])[:20]))
        else:
            head = '⚠ 极少（仅切出 %d 题，请 grep 全文 txt 或 --render 看图）' % len(qs)
        lines.append('## %d　%s' % (year, head))
        if not qs:
            lines.append('- ⚠ 该年解析无文本层（扫描件）→ 见 扫描件清单.md，用 --render 渲染后看图')
        for q in qs:
            lines.append('- %d. %s %s p%d ｜ %s' % (q['n'], q['k'], TAG.get(q['subj'], '?'), q['page'], q['brief']))
        lines.append('')
    with open(os.path.join(CACHE_DIR, '逐年速查.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    # ---------- 扫描件清单.md ----------
    lines = ['# 无文本层（扫描/图像）页清单 —— 只有这些页需要渲染成图用眼睛看',
             '',
             '渲染命令：`& \'D:\\anaconda\\python.exe\' tools/exam_index.py --render <年份> <页码,页码> --kind 解析`',
             '产物在 考情缓存/扫描页/ ，然后用 read_image 工具看。',
             '']
    for s in scanned:
        lines.append('- %d 年 %s 第 %d 页（%s）' % (s['y'], s['kind'], s['p'], s['file']))
    with open(os.path.join(CACHE_DIR, '扫描件清单.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    # ---------- index.json ----------
    with open(os.path.join(CACHE_DIR, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'questions': questions, 'scanned': scanned,
                   'reliability': {str(k): v for k, v in reliability.items()},
                   'years': {str(k): v for k, v in years.items()}},
                  f, ensure_ascii=False)

    good = [y for y in reliability if reliability[y].get('grade') == 'full']
    part = [y for y in reliability if reliability[y].get('grade') == 'part']
    few = [y for y in reliability if reliability[y].get('grade') not in ('full', 'part')]
    log('✔ 缓存已生成：%s' % CACHE_DIR)
    log('  年份 %d 个（2009–2026）｜ 解析切块 %d 题 ｜ 关键词 %d 个命中 %d 处 ｜ 扫描页 %d 页'
        % (len(years), len(questions), len([k for k in KEYWORDS]), hit_total, len(scanned)))
    log('  切块完整(%d)：%s' % (len(good), '、'.join(str(y) for y in sorted(good)) or '无'))
    log('  切块部分(%d)：%s（题号可信、缺号需 grep 原文）' % (len(part), '、'.join(str(y) for y in sorted(part)) or '无'))
    log('  基本无文本层(%d)：%s（按年份定位 + --render 看图）' % (len(few), '、'.join(str(y) for y in sorted(few)) or '无'))
    log('  原文缓存约 %.0f KB；日常查阅用 关键词索引.md / 逐年速查.md，不要再去开 PDF' % (raw_len / 1024.0))
    return 0


def load_index():
    p = os.path.join(CACHE_DIR, 'index.json')
    if not os.path.exists(p):
        log('✖ 还没有缓存，先跑：--build')
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def ask(kw):
    data = load_index()
    if not data:
        return 1
    rel = data.get('reliability', {})
    hits = [q for q in data['questions'] if kw in q['text']]
    log('关键词「%s」命中 %d 处：' % (kw, len(hits)))
    for q in hits[:60]:
        at = q['text'].find(kw)
        ctx = re.sub(r'\s+', ' ', q['text'][max(0, at - 45):at + 55])
        ok = rel.get(str(q['y']), {}).get('grade', 'few') in ('full', 'part')
        tag = '%d-%d' % (q['y'], q['n']) if ok else '%d-?(只信年份)' % q['y']
        log('  %s %s %s [p%d] …%s…' % (tag, q['k'], TAG.get(q['subj'], '?'), q['page'], ctx))
    if len(hits) > 60:
        log('  …（其余 %d 处省略）' % (len(hits) - 60))
    if not hits:
        log('  （无命中：该年解析可能是扫描件，见 扫描件清单.md；或换关键词/看全文 txt）')
    return 0


def paper(year):
    data = load_index()
    if not data:
        return 1
    qs = [q for q in data['questions'] if q['y'] == int(year)]
    log('%s 年：解析可切块 %d 题' % (year, len(qs)))
    for q in qs:
        log('  %d. %s %s p%d ｜ %s' % (q['n'], q['k'], TAG.get(q['subj'], '?'), q['page'], q['brief']))
    return 0


def render(year, pages, kind):
    if not os.path.isdir(SCAN_DIR):
        os.makedirs(SCAN_DIR)
    src = None
    for p in glob.glob(os.path.join(PDF_DIR, '%s年*%s.pdf' % (year, kind))):
        src = p
    if not src:
        log('✖ 找不到 %s 年 %s PDF' % (year, kind))
        return 1
    doc = pymupdf.open(src)
    out = []
    for n in pages:
        if n < 1 or n > doc.page_count:
            log('  跳过页码 %d（PDF 共 %d 页）' % (n, doc.page_count))
            continue
        pix = doc[n - 1].get_pixmap(dpi=180)
        name = os.path.join(SCAN_DIR, '%s_%s_p%02d.png' % (year, kind, n))
        pix.save(name)
        out.append(name)
    doc.close()
    log('✔ 已渲染 %d 页：' % len(out))
    for n in out:
        log('  ' + n)
    log('下一步：用 read_image 工具看这些 PNG；临时图看完可留在缓存目录（已 gitignore）')
    return 0


def stats():
    data = load_index()
    if not data:
        return 1
    log('缓存概况：%d 个年份，%d 个题块，%d 个扫描页' % (len(data['years']), len(data['questions']), len(data['scanned'])))
    for y in sorted(data['years']):
        v = data['years'][y]
        qs = len([q for q in data['questions'] if q['y'] == int(y)])
        parts = ' ｜ '.join('%s %d 页/%d 字' % (k, v[k]['pages'], v[k]['chars']) for k in sorted(v))
        log('  %s：切块 %2d 题 ｜ %s' % (y, qs, parts))
    return 0


def main():
    ap = argparse.ArgumentParser(description='408 真题考情缓存：生成 / 查询 / 渲染扫描页')
    ap.add_argument('--build', action='store_true', help='全量重建缓存')
    ap.add_argument('--stats', action='store_true', help='缓存概况')
    ap.add_argument('--ask', metavar='关键词', help='按关键词查真题')
    ap.add_argument('--paper', metavar='年份', help='列出某年整卷题号与摘要')
    ap.add_argument('--render', nargs=2, metavar=('年份', '页码'), help='渲染指定页为 PNG（如 --render 2023 6）')
    ap.add_argument('--kind', default='解析', choices=['解析', '真题'], help='配合 --render：渲染解析卷还是真题卷')
    a = ap.parse_args()
    if a.build:
        return build()
    if a.stats:
        return stats()
    if a.ask:
        return ask(a.ask)
    if a.paper:
        return paper(a.paper)
    if a.render:
        pages = [int(x) for x in re.split(r'[,，\s]+', a.render[1]) if x.strip()]
        return render(a.render[0], pages, a.kind)
    ap.print_help()
    return 0


if __name__ == '__main__':
    sys.exit(main())
