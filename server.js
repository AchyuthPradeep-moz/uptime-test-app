// Uptime-agent test target. Zero dependencies — run with `node server.js`.
//
// The public page (/ and /health) behaves according to the current MODE.
// The control panel (/__control) always works, whatever the mode, and is
// guarded by CONTROL_TOKEN because the app is exposed publicly via ngrok.

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4000);
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || crypto.randomBytes(6).toString('hex');

const MODES = {
  up:        'HTTP 200 with the normal page (contains keyword "SITE_IS_UP")',
  down:      'HTTP 503 Service Unavailable',
  error:     'HTTP 500 Internal Server Error',
  notfound:  'HTTP 404 Not Found',
  slow:      'HTTP 200, but only after SLOW_SECONDS delay',
  timeout:   'Accepts the connection and never responds (agent must time out)',
  reset:     'Destroys the socket immediately (connection reset, no HTTP response)',
  keyword:   'HTTP 200, but the "SITE_IS_UP" keyword is missing (content check)',
  redirect:  'HTTP 302 redirect loop back to itself',
};

const state = {
  mode: 'up',
  slowSeconds: 8,
  flap: null,          // { seconds, timer } — auto-toggle up <-> down
  changedAt: new Date(),
  history: [],         // mode changes
  hits: [],            // recent public requests (to see the agent's behaviour)
};

function setMode(mode, by = 'manual') {
  if (!MODES[mode] || mode === state.mode) return;
  state.history.unshift({ at: new Date().toISOString(), from: state.mode, to: mode, by });
  state.history.length = Math.min(state.history.length, 50);
  state.mode = mode;
  state.changedAt = new Date();
  console.log(`[mode] ${state.history[0].from} -> ${mode} (${by})`);
}

function startFlap(seconds) {
  stopFlap();
  state.flap = {
    seconds,
    timer: setInterval(() => setMode(state.mode === 'up' ? 'down' : 'up', `flap ${seconds}s`), seconds * 1000),
  };
}

function stopFlap() {
  if (state.flap) clearInterval(state.flap.timer);
  state.flap = null;
}

function logHit(req, outcome) {
  state.hits.unshift({
    at: new Date().toISOString(),
    method: req.method,
    path: req.url,
    ua: req.headers['user-agent'] || '',
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    outcome,
  });
  state.hits.length = Math.min(state.hits.length, 200);
}

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
button{margin:3px;padding:6px 12px;cursor:pointer}.cur{background:#222;color:#fff}code{background:#f3f3f3;padding:1px 4px}</style>
</head><body>${body}</body></html>`;

function handlePublic(req, res) {
  const mode = state.mode;
  logHit(req, mode);
  switch (mode) {
    case 'up':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('Uptime Test Site', `<h1>Uptime Test Site</h1><p>SITE_IS_UP</p><p>Served at ${new Date().toISOString()}</p>`));
    case 'down':
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '30' });
      return res.end('503 Service Unavailable (simulated)');
    case 'error':
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('500 Internal Server Error (simulated)');
    case 'notfound':
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found (simulated)');
    case 'slow':
      return setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Uptime Test Site', `<h1>Uptime Test Site</h1><p>SITE_IS_UP (slow, ${state.slowSeconds}s)</p>`));
      }, state.slowSeconds * 1000);
    case 'timeout':
      return; // never respond; Node's default request timeout eventually closes it
    case 'reset':
      return req.socket.destroy();
    case 'keyword':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('Uptime Test Site', '<h1>Uptime Test Site</h1><p>Something changed on this page.</p>'));
    case 'redirect':
      res.writeHead(302, { Location: req.url });
      return res.end();
  }
}

function controlPanel(token) {
  const q = `token=${encodeURIComponent(token)}`;
  const btns = Object.entries(MODES).map(([m, d]) =>
    `<form method="post" action="/__control/mode/${m}?${q}" style="display:inline"><button title="${d}" class="${m === state.mode ? 'cur' : ''}">${m}</button></form>`).join('');
  const rows = (arr, cols) => arr.map(r => `<tr>${cols.map(c => `<td>${String(r[c]).replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('');
  return page('Uptime Test Control', `
<h1>Control panel</h1>
<p>Current mode: <b>${state.mode}</b> — ${MODES[state.mode]}<br>since ${state.changedAt.toISOString()}
${state.flap ? `<br>Auto-flapping up/down every <b>${state.flap.seconds}s</b>` : ''}</p>
<div>${btns}</div>
<p>
<form method="post" action="/__control/flap?${q}" style="display:inline">Flap up/down every
<input name="seconds" type="number" min="10" value="${state.flap ? state.flap.seconds : 120}" style="width:70px">s <button>start</button></form>
<form method="post" action="/__control/flap/stop?${q}" style="display:inline"><button>stop flapping</button></form>
<form method="post" action="/__control/slow?${q}" style="display:inline">· slow delay
<input name="seconds" type="number" min="1" value="${state.slowSeconds}" style="width:60px">s <button>set</button></form>
</p>
<p>Monitor this URL: <code>/</code> (or <code>/health</code>). Keyword for content checks: <code>SITE_IS_UP</code>.
JSON status: <a href="/__control/status?${q}">/__control/status</a>. Page auto-refreshes every 5s.</p>
<h2>Recent checks (who hit the public URL)</h2>
<table><tr><th>time</th><th>method</th><th>path</th><th>served as</th><th>ip</th><th>user-agent</th></tr>${rows(state.hits.slice(0, 50), ['at', 'method', 'path', 'outcome', 'ip', 'ua'])}</table>
<h2>Mode changes</h2>
<table><tr><th>time</th><th>from</th><th>to</th><th>by</th></tr>${rows(state.history, ['at', 'from', 'to', 'by'])}</table>
<script>setTimeout(()=>location.reload(),5000)</script>`);
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => resolve(new URLSearchParams(b)));
  });
}

async function handleControl(req, res, url) {
  if (url.searchParams.get('token') !== CONTROL_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('forbidden: missing or wrong ?token=');
  }
  const back = () => { res.writeHead(303, { Location: `/__control?token=${encodeURIComponent(CONTROL_TOKEN)}` }); res.end(); };
  const p = url.pathname;

  if (req.method === 'GET' && p === '/__control') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(controlPanel(CONTROL_TOKEN));
  }
  if (req.method === 'GET' && p === '/__control/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      mode: state.mode, description: MODES[state.mode], changedAt: state.changedAt,
      flapSeconds: state.flap?.seconds ?? null, slowSeconds: state.slowSeconds,
      history: state.history, recentHits: state.hits.slice(0, 50),
    }, null, 2));
  }
  if (req.method === 'POST' && p.startsWith('/__control/mode/')) {
    const mode = p.split('/').pop();
    if (!MODES[mode]) { res.writeHead(400); return res.end(`unknown mode; valid: ${Object.keys(MODES).join(', ')}`); }
    stopFlap();
    setMode(mode);
    return req.headers.accept?.includes('text/html') ? back() : (res.writeHead(200), res.end(`mode=${mode}\n`));
  }
  if (req.method === 'POST' && p === '/__control/flap') {
    const s = Math.max(10, Number((await readBody(req)).get('seconds') || url.searchParams.get('seconds')) || 120);
    startFlap(s);
    return req.headers.accept?.includes('text/html') ? back() : (res.writeHead(200), res.end(`flapping every ${s}s\n`));
  }
  if (req.method === 'POST' && p === '/__control/flap/stop') {
    stopFlap();
    return req.headers.accept?.includes('text/html') ? back() : (res.writeHead(200), res.end('flap stopped\n'));
  }
  if (req.method === 'POST' && p === '/__control/slow') {
    state.slowSeconds = Math.max(1, Number((await readBody(req)).get('seconds') || url.searchParams.get('seconds')) || 8);
    return req.headers.accept?.includes('text/html') ? back() : (res.writeHead(200), res.end(`slow=${state.slowSeconds}s\n`));
  }
  res.writeHead(404); res.end('unknown control route');
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/__control')) return handleControl(req, res, url);
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  handlePublic(req, res);
}).listen(PORT, () => {
  console.log(`uptime-test-app listening on http://localhost:${PORT}`);
  console.log(`control panel: http://localhost:${PORT}/__control?token=${encodeURIComponent(CONTROL_TOKEN)}`);
});
