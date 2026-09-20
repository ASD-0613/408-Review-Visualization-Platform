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
================================================================================
"""
import argparse
import glob
import os
import re
import sys

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
    ('README：模块文件数（目录结构）', 'module_files', 'README.md', r'★ (\d+) 个可视化模块', True),
]


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
