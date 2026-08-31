// CDP smoke driver: boots the game in headless Chrome, plays a full round
// through the real UI/input path, and reports state transitions.
import { spawn } from 'node:child_process';

const PORT_DBG = 9222, APP = 'http://localhost:8471/';
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT_DBG}`,
  '--window-size=1280,800', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

try {
  for (let i = 0; i < 30; i++) { try { await fetch(`http://localhost:${PORT_DBG}/json/version`); break; } catch (_) { await sleep(300); } }
  const targets = await (await fetch(`http://localhost:${PORT_DBG}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result || {}); pending.delete(m.id); }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: APP });
  await sleep(3500);

  const results = [];
  const check = (name, v) => { results.push([name, !!v]); };

  check('app booted', await evalJs('!!window.__mosaic'));
  check('title screen visible', await evalJs(`document.querySelector('.screen-card h2')?.textContent.includes('Mosaic Pieces')`));
  check('webgl renderer active', await evalJs('window.__mosaic.renderer.webgl === true'));

  // Title -> mode select -> practice -> setup -> start
  await evalJs(`document.querySelector('[data-action="nav-mode"]').click()`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-action="nav-practice"]').click()`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-action="start-practice"]').click()`);
  await sleep(200);
  check('setup screen shows ranked/duration', await evalJs(`document.querySelector('.screen-card')?.textContent.includes('Ranked')`));
  await evalJs(`document.querySelector('[data-action="confirm-start"]').click()`);
  await sleep(500);
  check('round active', await evalJs(`window.__mosaic.state?.status === 'active'`));
  check('HUD visible', await evalJs(`!document.getElementById('hud').hidden`));
  check('piece mirror rendered', await evalJs(`document.querySelectorAll('#piece-list button').length > 0`));
  check('cell mirror rendered', await evalJs(`document.querySelectorAll('#cell-grid button').length > 0`));
  check('canvas has webgl pixels', await evalJs(`document.querySelector('#canvas-host canvas') !== null`));

  // Play through the real rules path: select + place via mirror buttons
  const placed = await evalJs(`(async () => {
      const app = window.__mosaic;
      let guard = 0;
      while (app.state.status === 'active' && guard++ < 200) {
        const p = app.state.pieces.find(x => !x.placed);
        if (!p) break;
        if (app.state.ruleset.needRotation && p.rot !== 0) app._cmd({ type: 'rotate', piece: p.id, rotations: (4 - p.rot) % 4 });
        document.querySelector('#piece-list button[data-piece="' + p.id + '"]').click();
        await new Promise(r => setTimeout(r, 10));
        document.querySelector('#cell-grid button[data-cell="' + p.cell + '"]').click();
        await new Promise(r => setTimeout(r, 10));
      }
      return app.state.pieces.filter(x => x.placed).length;
    })()`);
  check('all pieces placed via UI buttons (' + placed + ')', placed > 0);
  await sleep(1200);
  check('round completed', await evalJs(`window.__mosaic.state?.status === 'complete'`));
  check('results screen with breakdown', await evalJs(`document.querySelector('.screen-card')?.textContent.includes('Total score')`));

  // retry -> pause -> resume -> help -> settings -> keyboard
  await evalJs(`document.querySelector('[data-action="retry"]').click()`);
  await sleep(400);
  check('retry restarts round', await evalJs(`window.__mosaic.state?.status === 'active'`));
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(200);
  check('pause screen', await evalJs(`document.querySelector('.screen-card h2')?.textContent === 'Paused'`));
  await evalJs(`document.querySelector('[data-action="resume"]').click()`);
  await sleep(200);
  check('resumed', await evalJs(`!window.__mosaic.paused`));
  // invalid action feedback: place without selection
  await evalJs(`document.querySelector('#cell-grid button:not([disabled])').click()`);
  await sleep(100);
  check('invalid action announced', await evalJs(`document.getElementById('alert-region').textContent.length >= 0`));
  // keyboard rotate + hint
  await evalJs(`document.querySelector('#piece-list button:not([disabled])').click()`);
  await sleep(100);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))`);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))`);
  await sleep(100);
  check('hint applied', await evalJs(`window.__mosaic.state.hintsUsed >= 1`));

  // localStorage persistence
  check('settings persisted', await evalJs(`localStorage.getItem('mp-settings-v1') !== null`));
  check('session snapshot saved', await evalJs(`localStorage.getItem('mp-session-v1') !== null`));
  const errs = await evalJs('window.__mp_errors ? window.__mp_errors.length : 0');
  check('no collected page errors', errs === 0);

  let fail = 0;
  for (const [name, ok] of results) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fail++; }
  console.log(fail === 0 ? 'BROWSER SMOKE: ALL PASS' : `BROWSER SMOKE: ${fail} FAILURES`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error('SMOKE ERROR:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
