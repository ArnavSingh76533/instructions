import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { watch } from 'node:fs';
import { stateBackup, healthWatchdog } from './space-state.mjs';
const state = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';
const backup = stateBackup(state, '/data/openclaw-backups');
await backup.restore();
await fs.mkdir(state, { recursive: true, mode: 0o700 });
const configPath = path.join(state, 'openclaw.json');
const config = existsSync(configPath) ? JSON.parse(await fs.readFile(configPath, 'utf8')) : {};
config.gateway = { ...config.gateway, mode: 'local', bind: 'loopback', port: 18789, controlUi: { ...config.gateway?.controlUi, allowedOrigins: config.gateway?.controlUi?.allowedOrigins ?? ['*'] } };
config.plugins ??= {};
config.plugins.entries ??= {};
config.plugins.entries.telegram = { ...config.plugins.entries.telegram, enabled: true };
config.channels ??= {};
config.channels.telegram = { dmPolicy: 'open', allowFrom: ['*'], groupPolicy: 'open', groups: { '*': { requireMention: true } }, ...config.channels.telegram, enabled: true };
config.channels.telegram.network = { ...config.channels.telegram.network, autoSelectFamily: false, dnsResultOrder: 'ipv4first' };
config.bindings ??= [];
if (!config.bindings.some(b => b.match?.channel === 'telegram' && b.match?.accountId === 'default')) config.bindings.push({ agentId: 'main', match: { channel: 'telegram', accountId: 'default' } });
const allowed = (process.env.TELEGRAM_ALLOW_FROM || '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
if (allowed.length) { config.channels.telegram.dmPolicy = 'allowlist'; config.channels.telegram.allowFrom = allowed; }
// The bundled Telegram plugin reads TELEGRAM_BOT_TOKEN from the environment.
await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
const children = new Set();
let stopping = false;
let gateway;
function launch(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env, detached: true });
  children.add(child);
  if (command === 'openclaw') gateway = child;
  child.on('error', e => console.error('[startup]', e.message));
  child.on('exit', () => { children.delete(child); if (!stopping) setTimeout(() => launch(command, args), 3000); });
}
launch('node', ['/home/node/proxy.js']);
launch('openclaw', ['gateway', '--port', '18789', '--bind', 'loopback', '--auth', 'token', '--allow-unconfigured']);
const checkpoint = () => backup.save().catch(() => console.error('[space-state] Checkpoint failed; previous backup retained.'));
// shortcut: checkpoints allow a two-minute crash window; use continuous replication if needed.
const backupInterval = setInterval(checkpoint, 120000);
setTimeout(checkpoint, 15000);
let debounce;
const watcher = watch(state, (_, name) => {
  if (name !== 'openclaw.json' || stopping) return;
  clearTimeout(debounce);
  debounce = setTimeout(checkpoint, 10000);
});
const probe = async () => {
  try {
    const response = await fetch('http://127.0.0.1:18789/healthz', { signal: AbortSignal.timeout(5000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
};
const healthInterval = setInterval(healthWatchdog(probe, async () => {
  if (stopping || !gateway || !children.has(gateway)) return;
  const stuck = gateway;
  console.error('[startup] Gateway unresponsive; restarting its process without resetting state.');
  void checkpoint();
  try { process.kill(-stuck.pid, 'SIGTERM'); } catch {}
  setTimeout(() => { if (children.has(stuck)) { try { process.kill(-stuck.pid, 'SIGKILL'); } catch {} } }, 15000);
}), 20000);
// Retain this Space's existing authenticated device-approval behavior.
setTimeout(() => {
  const approve = () => {
    if (stopping) return;
    const child = spawn('openclaw', ['devices', 'approve', '--latest', '--url', 'ws://127.0.0.1:18789', '--token', process.env.OPENCLAW_GATEWAY_TOKEN || ''], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    child.on('error', () => clearTimeout(timer));
    child.on('exit', () => { clearTimeout(timer); if (!stopping) setTimeout(approve, 6000); });
  };
  approve();
}, 25000);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(backupInterval);
  clearInterval(healthInterval);
  clearTimeout(debounce);
  watcher.close();
  const deadline = setTimeout(() => process.exit(0), 20000);
  await checkpoint();
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  clearTimeout(deadline);
  setTimeout(() => process.exit(0), 3000);
});
