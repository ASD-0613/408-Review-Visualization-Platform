'use strict';
/* ============================================================================
 * tools/t_lib/cdp.js —— **共享测试库 · 浏览器侧**（2026-10-12 立；用户口径"token 消耗还是很快"）
 * ----------------------------------------------------------------------------
 * 以前每窗都从零抄一遍"起无头浏览器 + CDP + 求值 + 截图 + 关实例"（平均 120~180 行，纯样板）。
 * 本文件把它压成一次 `open()` 调用，并**把踩过的坑焊进去**：
 *   · 专用 `--user-data-dir`（§3.5-10）＋ **只走 CDP `Browser.close`**（按进程名杀会关掉用户的 Edge）
 *   · 求值一律 `Runtime.evaluate` + `returnByValue`；**返回字符串再 JSON.parse**（回对象时求值器会报 `__err`）
 *   · `clip` 按**页坐标**（`scrollIntoView` → `left + scrollX` → `captureBeyondViewport: true`），否则截到纯色空图（窗35）
 *   · `Runtime.exceptionThrown` 全程收集（"CDP 零异常"是所有 harness 的固定判据）
 * 用法（见 tools/t_lib/README.md）：
 *   const { open } = require('./tools/t_lib/cdp');
 *   const b = await open({ port: 9301, profile: 'tmp_chrome_profile_mine' });
 *   await b.navigate('file:///.../tmp_harness.html'); await b.sleep(8000);
 *   const r = await b.J(`(function(){...return {...};})()`);
 *   await b.shot('tmp_shots/xx.png', { sel: '#stage' });
 *   await b.close();
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickBrowser() {
  const cands = [
    ['chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    ['edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  ];
  const want = String(process.env.DSH_BROWSER || '').toLowerCase();
  const pool = want ? cands.filter(c => c[0] === want) : cands;
  for (const [, p] of pool) if (fs.existsSync(p)) return p;
  throw new Error('没找到浏览器（Chrome / Edge 都不在预期路径）');
}

/* 复用已开的调试实例（同一端口第二次跑就不必再起一个；§3.5-10 的"只关自己那一个"） */
async function probe(port) {
  try { return await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); } catch (e) { return null; }
}

async function open(opts) {
  const o = opts || {};
  const port = o.port || 9300;
  const root = o.root || process.cwd();
  const profile = path.join(root, o.profile || ('tmp_chrome_profile_' + port));
  const size = o.size || '1500,1700';
  let ver = o.reuse === false ? null : await probe(port);
  if (!ver) {
    const child = spawn(pickBrowser(), ['--headless=new', '--remote-debugging-port=' + port, '--window-size=' + size,
      '--disable-crash-reporter', '--disable-breakpad', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--user-data-dir=' + profile, 'about:blank'], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 40 && !ver; i++) { await sleep(500); ver = await probe(port); }
  }
  if (!ver) throw new Error('CDP 起不来（端口 ' + port + '）—— 先看 §6.4 的"提权判据"');
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const exceptions = [];
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', evt => {
    const m = JSON.parse(evt.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push('exceptionThrown: ' + (((m.params.exceptionDetails || {}).exception || {}).description || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') exceptions.push('console.error');
  });
  await send('Runtime.enable'); await send('Page.enable');
  const shotsDir = path.join(root, o.shotsDir || 'tmp_shots');
  const api = {
    port, ws, send, exceptions, sleep,
    async navigate(url) { await send('Page.navigate', { url: url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now() }); },
    async ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : undefined; },
    /* ⚠ 一律"回字符串再 parse"：IIFE 直接 return 对象时，求值器在某些版本会给出 `__err`/undefined（窗35 教训） */
    async J(expr) { const s = await api.ev('JSON.stringify(' + expr + ')'); try { return JSON.parse(s || '{}'); } catch (e) { return {}; } },
    async shot(name, opt) {
      const p = opt || {};
      const dir = p.dir ? path.join(root, p.dir) : shotsDir;
      fs.mkdirSync(dir, { recursive: true });
      if (p.full) {
        const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        if (res && res.data) fs.writeFileSync(path.join(dir, name), Buffer.from(res.data, 'base64'));
        return path.join(dir, name);
      }
      if (!p.sel) { p.sel = 'body'; }
      /* 先滚到元素，再按"页坐标"量（窗35：视口坐标 + false 只在 scrollY==0 时碰巧对） */
      const clip = await api.J(`(function(){var e=document.querySelector(${JSON.stringify(p.sel)});if(!e)return null;
        e.scrollIntoView({block:'start'});var r=e.getBoundingClientRect();
        return {x:r.left+window.scrollX,y:r.top+window.scrollY,w:r.width,h:r.height};})()`);
      if (!clip) return null;
      const res = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: Math.max(0, clip.x - 6), y: Math.max(0, clip.y - 6), width: clip.w + 12, height: clip.h + 12, scale: p.scale || 2 },
      });
      if (res && res.data) fs.writeFileSync(path.join(dir, name), Buffer.from(res.data, 'base64'));
      return path.join(dir, name);
    },
    async close() {
      try {
        const v = await probe(port);
        if (!v) return 'already-closed';
        const bws = new WebSocket(v.webSocketDebuggerUrl);
        await new Promise(res => {
          bws.addEventListener('open', () => { bws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); setTimeout(res, 600); });
          bws.addEventListener('error', () => res()); setTimeout(res, 2000);
        });
        return 'closed';
      } catch (e) { return 'error'; }
    },
  };
  return api;
}

module.exports = { open, pickBrowser, sleep, probe };
