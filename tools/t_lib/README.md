# tools/t_lib —— 共享测试库（怎么用）

> **为什么有它**：用户 2026-10-12"token 消耗还是很快" ⟹ 现算发现**每窗都要从零手写 200~600 行**
> harness / 冒烟样板（起浏览器、CDP 求值、截图、逐帧读 DOM、压盖量测、注入自测、汇总打印）。
> 这些样板与"这一窗要测什么"无关，抽到这里；**每窗只写模块特有的那 20~40 条断言**。

## 五分钟上手

```js
// tools/t_lib/demo_harness.js 就是模板 —— 复制它改成你的模块
const ROOT = path.resolve(__dirname, '..', '..');
const { open } = require('./tools/t_lib/cdp');     // 浏览器 + CDP + 截图 + 关闭
const C = require('./tools/t_lib/check');          // 断言（默认静音）+ 注入自测 + 汇总
const P = require('./tools/t_lib/page');           // 离线 harness + 逐帧读 DOM + 压盖
const S = require('./tools/t_lib/smoke');          // Node 侧：load / run / renderAll / presets / contract

S.load(ROOT, ['js/framework.js', 'js/exam-history.js', 'js/modules/<你的模块>.js']);
P.buildHarness({ root: ROOT, out: 'tmp_harness_<窗>.html' });
const b = await open({ root: ROOT, port: 9310, profile: 'tmp_chrome_profile_<窗>' });
await b.navigate('file:///' + path.join(ROOT, 'tmp_harness_<窗>.html').replace(/\\/g, '/'));
await b.sleep(8000);
await P.seekAll(b, async () => { const f = await P.frameFacts(b); C.eq(f.dirty, '', '帧干净'); });
await b.shot('tmp_shots/<窗>_01.png', { sel: '#stage' });
await b.close();
process.exit(C.finish() ? 1 : 0);
```

## 三条硬纪律（库已经焊进去，别绕过）

1. **默认静音**：只打**失败行 + 一行汇总**（`断言 N 条 / 红 M 条`）。以前每跑一次打 30~60 行 ✔，
   这些输出会一直留在上下文里 ⟹ 每窗白烧 3~5K token。要看全量：`--verbose` 或 `VERBOSE=1`。
2. **注入自测必须回滚**：`C.expectRed(fn, 'tag')` 跑完会把 `bad` 还原（否则"故意弄红"污染汇总，窗49/50 都栽过）。
3. **只关自己那个浏览器实例**：`await b.close()` 走 CDP `Browser.close`；**永远不要按进程名杀**（会关掉用户的 Edge）。

## 自测（判据自己会不会红）

```bash
node tools/t_lib/selftest.js      # 31 条：导出面 / buildHarness / contract 注入自测 / 脏值扫描 / expectRed 回滚
node tools/t_lib/demo_harness.js --module <id> --port 9310    # 端到端样板（真站点离线 harness）
```

- 任何一条红 ⟹ **先怀疑库**，不是被测模块（这正是 §3.8-5"红了一片先归三栏"的顺序）。
- 库改了就**两个都跑**：`selftest`（不碰浏览器，2 秒）+ `demo_harness`（真浏览器，约 1 分钟）。

## 文件

| 文件 | 管什么 |
| --- | --- |
| `cdp.js` | `open({port, profile, size, shotsDir})` → `{ev, J, navigate, shot, close, exceptions, sleep}` |
| `check.js` | `ok / eq / red / note / section / expectRed / finish`（默认静音，汇总格式固定） |
| `page.js` | `buildHarness`（摘 Tailwind CDN + 兜底段）/ `frameFacts`（td·th·svg·circle·统计卡·溢出·脏值）/ `seekLast`（**分两次求值**）/ `overlap`（同行压盖） |
| `smoke.js` | `load / module / valsOf / run / renderAll / presets / contract`（契约自检含"下拉必须 `o.v`/`o.t`"） |
| `selftest.js` / `demo_harness.js` | 库自测 / 端到端样板 |
