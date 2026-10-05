// Goos's keyboard shortcuts on Windows, on a copy that is on screen
// (GOOSE_TEST=show): Windows only gives keys to the window in front, so a
// hidden test copy cannot take them. Keys are sent the way the keyboard sends
// them (Electron's sendInputEvent); the DevTools protocol marks its own key
// events so they never reach the menu.
//   node win-keys.mjs <node inspector port> <out dir>
import fs from 'node:fs';
import path from 'node:path';

const [INSPECT, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 120 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json())[0]; } catch { await sleep(500); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const evaluate = (expression) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
await sleep(8000);
const r = await evaluate(`(async () => {
  const req = (p) => process.mainModule.require(p.startsWith('.') ? process.mainModule.require('path').join(process.resourcesPath, 'app', p) : p);
  const { GooseWindow } = req('./src/main/window.js');
  const w = GooseWindow.all()[0];
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  w.win.focus();
  await wait(1000);
  const press = async (wc, keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(1200);
  };
  const at = () => w.tabs.indexOf(w.active);
  const out = { visible: w.win.isVisible(), focused: w.win.isFocused(), start: w.tabs.length };
  await press(w.chrome, 'T', ['control']);
  out.ctrlTWindow = w.tabs.length;
  await wait(2500);
  const page = w.tabs.find((t) => t.wc && /^https?:/.test(t.wc.getURL()));
  out.pageUrl = page ? page.wc.getURL() : '';
  if (page) { page.wc.focus(); await press(page.wc, 'T', ['control']); }
  out.ctrlTPage = w.tabs.length;
  await press(w.chrome, '1', ['control']);
  out.ctrl1 = at();
  await press(w.chrome, 'PageDown', ['control']);
  out.ctrlPageDown = at();
  await press(w.active.wc || w.chrome, '9', ['control']);
  out.ctrl9 = at();
  out.last = w.tabs.length - 1;
  await press(w.chrome, 'W', ['control']);
  out.ctrlW = w.tabs.length;
  await press(w.chrome, 'K', ['control']);
  out.ctrlKPanel = await w.chrome.executeJavaScript("!document.querySelector('#panel').hidden && document.activeElement && document.activeElement.id");
  out.bounds = w.win.getBounds();
  return JSON.stringify(out);
})()`);
const raw = r.result?.result?.value;
if (!raw) {
  console.log('FAIL keys:', JSON.stringify(r).slice(0, 800));
  process.exit(1);
}
const k = JSON.parse(raw);
fs.writeFileSync(path.join(OUT, 'keys.json'), JSON.stringify(k, null, 2));
fs.writeFileSync(path.join(OUT, 'bounds.json'), JSON.stringify(k.bounds));
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failed += 1;
};
check('the on-screen copy is in front', k.visible && k.focused, JSON.stringify(k));
check('Ctrl+T in the window opens a tab', k.ctrlTWindow === k.start + 1);
check('Ctrl+T in a web page opens a tab', k.ctrlTPage === k.ctrlTWindow + 1, k.pageUrl);
check('Ctrl+1 (a hidden menu item) goes to the first tab', k.ctrl1 === 0);
check('Ctrl+PageDown (a Windows-only key) goes to the next tab', k.ctrlPageDown === 1);
check('Ctrl+9 in a web page goes to the last tab', k.ctrl9 === k.last);
check('Ctrl+W closes a tab', k.ctrlW === k.ctrlTPage - 1);
check('Ctrl+K opens the Goos panel, ready to type', k.ctrlKPanel === 'ask', String(k.ctrlKPanel));
ws.close();
process.exit(failed ? 1 : 0);
