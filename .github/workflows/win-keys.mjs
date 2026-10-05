// Why do (or don't) Goos's keyboard shortcuts fire on Windows? Sends keys the
// way the keyboard does and reports every stage they pass.
//   node win-keys.mjs <node inspector port>
const [INSPECT] = process.argv.slice(2);
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
  const { Menu, BrowserWindow } = req('electron');
  const { GooseWindow } = req('./src/main/window.js');
  const w = GooseWindow.all()[0];
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const seen = [];
  w.chrome.on('before-input-event', (_e, i) => seen.push('chrome:' + i.type + ':' + i.code + (i.control ? '+ctrl' : '')));
  if (w.active && w.active.wc) w.active.wc.on('before-input-event', (_e, i) => seen.push('page:' + i.type + ':' + i.code + (i.control ? '+ctrl' : '')));
  await w.chrome.executeJavaScript("window.__keys = []; window.addEventListener('keydown', (e) => window.__keys.push(e.code + (e.ctrlKey ? '+ctrl' : '') + (e.defaultPrevented ? ' prevented' : '')), true); true");
  const out = {
    visible: w.win.isVisible(), focused: w.win.isFocused(), menu: Menu.getApplicationMenu() ? Menu.getApplicationMenu().items.map((i) => i.label).join('|') : null,
    winMenuBar: w.win.isMenuBarVisible(), focusedWindow: !!BrowserWindow.getFocusedWindow(),
  };
  const press = async (wc, keyCode, modifiers) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await wait(1500); };
  out.tabs0 = w.tabs.length;
  await press(w.chrome, 'T', ['control']);
  out.tabsAfterCtrlT = w.tabs.length;
  out.rendererSaw = await w.chrome.executeJavaScript('window.__keys');
  w.win.focus(); await wait(800);
  out.focusedAfterFocus = w.win.isFocused();
  await press(w.chrome, 'T', ['control']);
  out.tabsAfterFocusCtrlT = w.tabs.length;
  const page = w.tabs.find((t) => t.wc && /^https?:/.test(t.wc.getURL()));
  if (page) { page.wc.focus(); await press(page.wc, 'T', ['control']); }
  out.tabsAfterPageCtrlT = w.tabs.length;
  // The menu item itself, clicked: proves the handler works.
  const item = Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'New Tab');
  item.click();
  await wait(800);
  out.tabsAfterClick = w.tabs.length;
  out.accel = item.accelerator;
  out.seen = seen;
  return JSON.stringify(out, null, 2);
})()`);
console.log(r.result?.result?.value || JSON.stringify(r));
ws.close();
