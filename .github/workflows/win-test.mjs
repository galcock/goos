// Drives a hidden Goos.exe over the Chrome DevTools Protocol and checks that
// the Windows build works: the window loads, says the right things, its keys
// work, and the Windows-only parts (voice, Chrome import, default browser) do
// what they should. Used by win-test.yml.
//   node win-test.mjs <cdp port> <node inspector port> <out dir>
import fs from 'node:fs';
import path from 'node:path';

const [CDP, INSPECT, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) failed += 1;
}

async function list(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  return r.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    const events = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      } else if (m.method) events.push(m);
    };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      events,
      send: (method, params = {}) => new Promise((res) => {
        const n = ++id;
        waiting.set(n, res);
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

async function evaluate(s, expression) {
  const r = await s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function shot(s, name) {
  const r = await s.send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
  return !!r.result?.data;
}

async function key(s, { key: k, code, vk, modifiers = 0 }) {
  await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

async function waitFor(fn, ms = 15000, every = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* not yet */ }
    await sleep(every);
  }
  return null;
}

// ------------------------------------------------------------- the window --
const t0 = Date.now();
const target = await waitFor(async () => (await list(CDP)).find((t) => t.url.startsWith('goose://app/chrome.html')), 120000, 500);
check('the goose://app/chrome.html window appears', !!target, `${Math.round((Date.now() - t0) / 1000)} s`);
if (!target) {
  fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n'));
  process.exit(1);
}
const ui = await connect(target.webSocketDebuggerUrl);
await waitFor(() => evaluate(ui, "document.readyState === 'complete' && document.querySelectorAll('#tabs .tab').length > 0"), 30000);

// Turning these on replays every console message and exception the window
// has had since it started, so an error on the way in is seen.
await ui.send('Runtime.enable');
await ui.send('Log.enable');
await sleep(3000);
const errors = ui.events.filter((e) => e.method === 'Runtime.exceptionThrown'
  || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
  || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
const describe = (e) => e.params.exceptionDetails?.exception?.description || e.params.entry?.text || (e.params.args || []).map((a) => a.value ?? a.description).join(' ');
// The microphone: a CI machine has none. That is the one error allowed.
const real = errors.filter((e) => !/microphone|NotFoundError|Requested device not found|getUserMedia/i.test(describe(e)));
check('the window loads without errors', real.length === 0, real.map(describe).join(' | ').slice(0, 600));
fs.writeFileSync(path.join(OUT, 'console.json'), JSON.stringify(ui.events.filter((e) => /Runtime.console|Runtime.exception|Log.entry/.test(e.method)), null, 2));

const facts = await evaluate(ui, `(() => {
  const s = getComputedStyle(document.querySelector('#strip'));
  return {
    placeholder: document.querySelector('#address').placeholder,
    body: document.body.className,
    platform: window.goose.platform,
    newtab: document.querySelector('#newtab').title,
    back: document.querySelector('#back').title,
    hint: document.querySelector('#gb-status').textContent,
    hello: document.querySelector('.hello p').textContent,
    stripLeft: s.paddingLeft, stripRight: s.paddingRight,
    width: innerWidth,
    tabs: document.querySelectorAll('#tabs .tab').length,
    visibility: document.visibilityState,
    text: document.body.innerText,
  };
})()`);
fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2));
check('the address bar says "Search Goos…"', /^Search Goos/.test(facts.placeholder), facts.placeholder);
check('the body says win', facts.body.split(' ').includes('win'), facts.body);
check('the window knows it is on Windows', facts.platform === 'win32', facts.platform);
check('hints say Ctrl, not ⌘', facts.newtab === 'New tab (Ctrl+T)' && !/⌘/.test(facts.text + facts.newtab + facts.back), `${facts.newtab}; ${facts.back}; ${facts.hint}`);
check('no Mac wording in the window', !/\bMac\b/.test(facts.text.replace(/Mac-only/g, '')), facts.hello);
check('the tab strip leaves room for minimise, maximise and close', parseFloat(facts.stripRight) >= 120 && parseFloat(facts.stripLeft) <= 12, `left ${facts.stripLeft}, right ${facts.stripRight}`);
check('first screenshot', await shot(ui, '1-window.png'));

// --------------------------------------------------------------- settings --
await evaluate(ui, "document.querySelector('#panelbtn').click(); document.querySelector('[data-view=settings]').click(); true");
const lines = await waitFor(async () => {
  const v = await evaluate(ui, "JSON.stringify(Object.fromEntries(['#brain-line','#vault-line','#computer-line','#hearing-line'].map((s) => [s, document.querySelector(s).textContent])))");
  const o = JSON.parse(v);
  return o['#brain-line'] !== 'Checking…' ? o : null;
}, 60000, 500);
const extra = await evaluate(ui, "({ def: !document.querySelector('#default-browser').hidden, allow: !document.querySelector('#computer-allow').hidden, chrome: !document.querySelector('#chrome-import').hidden, system: document.querySelector('#row-system').textContent.trim().split('\\n')[0], hint: document.querySelector('#gb-status').textContent })");
fs.writeFileSync(path.join(OUT, 'settings.json'), JSON.stringify({ lines, extra }, null, 2));
check('no Ollama: Goos says it needs Ollama', /Goos needs Ollama to think/.test(lines?.['#brain-line'] || ''), lines?.['#brain-line']);
check('using other apps is Mac-only, said plainly', lines?.['#computer-line'] === 'Using other apps is Mac-only for now, so Goos works inside the browser.', lines?.['#computer-line']);
check('no whisper.cpp: voice is off, said plainly', /Voice is off on this PC/.test(lines?.['#hearing-line'] || ''), lines?.['#hearing-line']);
check('passwords are encrypted on this PC', /encrypted on this PC\./.test(lines?.['#vault-line'] || ''), lines?.['#vault-line']);
check('the default-browser button shows', extra.def === true);
check('no "Let Goos use this Mac" button', extra.allow === false);
check('voice hint without whisper', /Voice is off/.test(extra.hint), extra.hint);
check('settings screenshot', await shot(ui, '2-settings.png'));

// ----------------------------------------------------------- Chrome import --
// The runner was given a small Chrome profile (3 pages, 2 bookmarks) before
// Goos started, so Goos offers to bring it over.
const offer = await waitFor(() => evaluate(ui, "!document.querySelector('#asking').hidden && document.querySelector('#ask-q').textContent"), 15000);
check('the Chrome offer leaves passwords out', offer === 'Bring your history and bookmarks over from Chrome?', String(offer));
if (offer) {
  await evaluate(ui, "document.querySelector('#ask-buttons button').click(); true");
  const toast = await waitFor(async () => {
    const t = await evaluate(ui, "document.querySelector('#toast').hidden ? '' : document.querySelector('#toast-text').textContent");
    return /^From Chrome/.test(t) ? t : null;
  }, 20000, 100);
  check('Chrome import brings history and bookmarks, and says why passwords stay', /3 pages of history, 2 bookmarks/.test(toast || '') && /Chrome on Windows locks them/.test(toast || ''), toast);
  check('import screenshot', await shot(ui, '3-import.png'));
}

// ------------------------------------------------------------------- keys --
// Keys pressed in the window, and in a web page, reach Goos's (hidden) menu.
const tabs = () => evaluate(ui, "document.querySelectorAll('#tabs .tab').length");
const activeIndex = () => evaluate(ui, "[...document.querySelectorAll('#tabs .tab')].findIndex((t) => t.classList.contains('active'))");
const before = await tabs();
await key(ui, { key: 't', code: 'KeyT', vk: 84, modifiers: 2 });
const afterCtrlT = await waitFor(async () => ((await tabs()) > before ? tabs() : null), 5000);
check('Ctrl+T in the window opens a tab', !!afterCtrlT, `${before} -> ${afterCtrlT ?? await tabs()}`);
await key(ui, { key: '1', code: 'Digit1', vk: 49, modifiers: 2 });
const first = await waitFor(async () => ((await activeIndex()) === 0 ? 'first' : null), 5000);
check('Ctrl+1 (a hidden menu item) goes to the first tab', !!first, `active ${await activeIndex()}`);
await key(ui, { key: 'PageDown', code: 'PageDown', vk: 34, modifiers: 2 });
const second = await waitFor(async () => ((await activeIndex()) === 1 ? 'second' : null), 5000);
check('Ctrl+PageDown (Windows-only key) goes to the next tab', !!second, `active ${await activeIndex()}`);
const page = await waitFor(async () => (await list(CDP)).find((t) => t.type === 'page' && /^https?:/.test(t.url)), 20000);
if (page) {
  const p = await connect(page.webSocketDebuggerUrl);
  const n = await tabs();
  await key(p, { key: 't', code: 'KeyT', vk: 84, modifiers: 2 });
  const more = await waitFor(async () => ((await tabs()) > n ? tabs() : null), 5000);
  check('Ctrl+T in a web page opens a tab', !!more, `${n} -> ${more ?? await tabs()} (${page.url.slice(0, 60)})`);
  p.close();
} else check('a web page to press keys in', false);
check('keys screenshot', await shot(ui, '4-keys.png'));

// -------------------------------------------------------- default browser --
await evaluate(ui, "window.goose.send('app:default-browser'); true");
await sleep(4000);
check('default-browser button pressed', true, 'registry checked by the workflow');

// ------------------------------------------------- main process (inspector) --
try {
  const node = (await list(INSPECT))[0];
  const main = await connect(node.webSocketDebuggerUrl);
  const run = async (expr) => evaluate(main, `(async () => { const r = process.mainModule.require; ${expr} })()`);
  const tools = await run("return r('./src/main/brain/tools.js').TOOLS.map((t) => t.function.name).join(',')");
  check('the brain is not offered the computer tool', !/computer/.test(tools), tools);
  const prompt = await run("return r('./src/main/brain/prompts.js').system().slice(0, 600)");
  check('the prompt says other apps are Mac-only', /Mac-only for now/.test(prompt) && !/any app on their Mac/.test(prompt), prompt.slice(0, 200));
  const act = await run("return (await r('./src/main/computer.js').act({ action: 'apps' }, { approve: async () => false, risky: () => false })).text");
  check('the computer tool says Mac-only if called anyway', /Mac-only/.test(act), act);
  const voice = await run(`
    const { Mouth } = r('./src/main/voice/mouth.js');
    const sent = [];
    const w = { send: (c, p) => sent.push([c, p && p.wav ? p.wav.length : 0]), agent: { busy: () => false }, ears: null };
    const t = Date.now();
    await new Mouth(w).say('Hello from Goos on Windows. It speaks with the voice Windows already has.');
    return JSON.stringify({ sent, ms: Date.now() - t });`);
  const v = JSON.parse(voice);
  const audio = v.sent.filter(([c, n]) => c === 'voice:audio' && n > 1000);
  check('Windows voice: speech comes back as WAV audio', audio.length >= 1 && v.sent.some(([c]) => c === 'voice:end'), `${JSON.stringify(v.sent)} in ${v.ms} ms`);
  const wav = await run(`
    const { Mouth } = r('./src/main/voice/mouth.js');
    let head = '';
    const w = { send: (c, p) => { if (c === 'voice:audio' && !head) head = Buffer.from(p.wav).subarray(0, 12).toString('latin1'); }, agent: { busy: () => false }, ears: null };
    await new Mouth(w).say('Goos.');
    return head;`);
  check('the audio is a WAV file', /^RIFF....WAVE$/s.test(wav), JSON.stringify(wav));
  const ears = await run("const e = r('./src/main/voice/ears.js'); return JSON.stringify({ available: e.available(), started: await e.start() })");
  check('no whisper.cpp: hearing is unavailable, nothing crashes', ears === '{"available":false,"started":false}', ears);
  const agentSays = await run("return r('./src/main/brain/agent.js') && 'loaded'");
  check('brain modules load', agentSays === 'loaded');
  main.close();
} catch (e) {
  check('main process checks', false, e.message);
}

// The user agent sites see.
const uaPage = await waitFor(async () => (await list(CDP)).find((t) => t.type === 'page' && /^https?:/.test(t.url)), 5000);
if (uaPage) {
  const p = await connect(uaPage.webSocketDebuggerUrl);
  const ua = await evaluate(p, 'navigator.userAgent');
  check('sites are told Windows', /Windows NT 10\.0; Win64; x64/.test(ua) && /Goose\//.test(ua), ua);
  p.close();
}

check('last screenshot', await shot(ui, '5-end.png'));
ui.close();
fs.writeFileSync(path.join(OUT, 'results.txt'), `${results.join('\n')}\n`);
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
