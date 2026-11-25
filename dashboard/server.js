const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, 'state.json');
const ENV_FILE = path.join(ROOT, '.env');
const ACTIVE_CONF = path.join(ROOT, 'nginx', 'switchboard', 'active.conf');
const PORT = process.env.PORT || 9000;
const ENVS = ['blue', 'green'];

const DEFAULT_SETTINGS = { version: '1', message: 'The original release', color: '#2563eb', broken: false };

// ---------- helpers ----------

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim()));
      resolve(stdout);
    });
  });

const compose = (...args) => run('docker', ['compose', ...args]);
const other = (env) => (env === 'blue' ? 'green' : 'blue');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- state ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      active: 'blue',
      envs: { blue: { ...DEFAULT_SETTINGS }, green: { ...DEFAULT_SETTINGS } },
      previous: null,
      history: [],
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function log(state, action, detail) {
  state.history.unshift({ at: new Date().toISOString(), action, detail });
  state.history = state.history.slice(0, 50);
}

// Compose reads .env automatically, so settings survive restarts of the stack.
function writeEnvFile(state) {
  const lines = [];
  for (const env of ENVS) {
    const s = state.envs[env];
    const N = env.toUpperCase();
    lines.push(`${N}_VERSION=${s.version}`);
    lines.push(`${N}_MESSAGE=${JSON.stringify(s.message)}`);
    lines.push(`${N}_COLOR=${s.color}`);
    lines.push(`${N}_BROKEN=${s.broken}`);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
}

// ---------- docker / nginx ----------

// Health is checked from inside the container, since app ports are not published.
async function checkHealth(env) {
  try {
    const out = await compose('exec', '-T', env, 'wget', '-qO-', 'http://localhost:3000/health');
    const body = JSON.parse(out);
    return { healthy: body.status === 'ok', version: body.version };
  } catch {
    return { healthy: false, version: null };
  }
}

async function waitHealthy(env, attempts = 10, delayMs = 1000) {
  let result = { healthy: false, version: null };
  for (let i = 0; i < attempts; i++) {
    result = await checkHealth(env);
    if (result.healthy) return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return result;
}

async function pointNginxAt(env) {
  const previous = fs.readFileSync(ACTIVE_CONF, 'utf8');
  fs.writeFileSync(ACTIVE_CONF, `upstream active {\n  server ${env}:3000;\n}\n`);
  try {
    await compose('exec', '-T', 'nginx', 'nginx', '-t');
    await compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload');
  } catch (err) {
    fs.writeFileSync(ACTIVE_CONF, previous);
    throw new HttpError(500, `Nginx rejected the config, left traffic unchanged: ${err.message}`);
  }
  // The reload signal is asynchronous: wait until Nginx really serves from the target.
  if (!(await waitForTraffic(env))) {
    fs.writeFileSync(ACTIVE_CONF, previous);
    await compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload').catch(() => {});
    throw new HttpError(500, `Nginx reloaded but did not start routing to ${env}`);
  }
}

async function waitForTraffic(env, attempts = 20, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await compose('exec', '-T', 'nginx', 'wget', '-qO-', 'http://127.0.0.1/health');
      if (JSON.parse(out).env === env) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

// ---------- operations (serialized) ----------

let busy = false;
async function exclusive(fn) {
  if (busy) throw new HttpError(409, 'Another operation is in progress');
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

function parseSettings(body) {
  const version = String(body.version ?? '').trim();
  if (!/^[\w.-]{1,32}$/.test(version)) throw new HttpError(400, 'version must be 1-32 chars: letters, digits, . _ -');
  const message = String(body.message ?? '').trim() || DEFAULT_SETTINGS.message;
  if (message.length > 120 || /[\r\n"$\\]/.test(message)) throw new HttpError(400, 'message must be under 120 chars and not contain quotes, $, backslashes or newlines');
  const color = String(body.color ?? DEFAULT_SETTINGS.color).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, 'color must look like #2563eb');
  return { version, message, color, broken: body.broken === true };
}

// Deploy to whichever environment is NOT receiving traffic, then health-check it.
function deploy(body) {
  return exclusive(async () => {
    const settings = parseSettings(body);
    const state = loadState();
    const target = other(state.active);

    state.envs[target] = settings;
    writeEnvFile(state);
    await compose('up', '-d', '--no-deps', '--force-recreate', target);
    const health = await waitHealthy(target);

    log(state, 'deploy', `v${settings.version} to ${target}: ${health.healthy ? 'healthy' : 'UNHEALTHY'}`);
    saveState(state);
    return { target, health };
  });
}

function switchTo(env, action) {
  return exclusive(async () => {
    const state = loadState();
    if (env === state.active) throw new HttpError(400, `${env} is already active`);

    const health = await checkHealth(env);
    if (!health.healthy) throw new HttpError(409, `Refusing to switch: ${env} failed its health check`);

    await pointNginxAt(env);
    state.previous = state.active;
    state.active = env;
    log(state, action, `traffic moved to ${env} (v${state.envs[env].version})`);
    saveState(state);
    return { active: env };
  });
}

async function getState() {
  const state = loadState();
  const [blue, green] = await Promise.all(ENVS.map(checkHealth));
  return { ...state, health: { blue, green }, busy };
}

// ---------- http ----------

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) reject(new HttpError(413, 'Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
  });

const routes = {
  'GET /api/state': () => getState(),
  'POST /api/deploy': async (req) => deploy(await readBody(req)),
  'POST /api/switch': () => switchTo(other(loadState().active), 'switch'),
  'POST /api/rollback': () => {
    const { previous } = loadState();
    if (!previous) throw new HttpError(400, 'Nothing to roll back to');
    return switchTo(previous, 'rollback');
  },
};

const server = http.createServer(async (req, res) => {
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  };
  const sendJson = (status, obj) => send(status, 'application/json', JSON.stringify(obj));

  try {
    const handler = routes[`${req.method} ${req.url}`];
    if (handler) return sendJson(200, await handler(req));

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    sendJson(404, { error: 'Not found' });
  } catch (err) {
    sendJson(err.status || 500, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`switchboard dashboard on http://localhost:${PORT}`));
}
