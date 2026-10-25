import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stateBackup, healthWatchdog } from './space-state.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'state-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, 'state');
  const bucket = path.join(root, 'bucket');
  await fs.mkdir(state); await fs.mkdir(bucket);
  await fs.writeFile(path.join(state, 'openclaw.json'), JSON.stringify({ model: 'codex/test-model' }));
  await fs.writeFile(path.join(state, 'credential-fixture'), 'test-only-oauth');
  const cli = async args => {
    if (args[1] === 'create') {
      const config = await fs.readFile(path.join(state, 'openclaw.json'), 'utf8');
      await fs.writeFile(args[3], JSON.stringify({ config, auth: 'test-only-oauth' }));
      return { verified: true, assets: [{ kind: 'state', sourcePath: state, archivePath: 'root/payload/state' }] };
    }
    const data = JSON.parse(await fs.readFile(args[2], 'utf8'));
    const restored = path.join(args[4], 'root/payload/state');
    await fs.mkdir(restored, { recursive: true });
    await fs.writeFile(path.join(restored, 'openclaw.json'), data.config);
    await fs.writeFile(path.join(restored, 'credential-fixture'), data.auth);
  };
  return { state, bucket, backup: stateBackup(state, bucket, cli), cli };
}

test('checkpoint restores model and credential files after an empty-disk restart', async t => {
  const f = await fixture(t);
  await f.backup.save();
  await fs.rename(f.state, f.state + '-old');
  await f.backup.restore();
  assert.equal(JSON.parse(await fs.readFile(path.join(f.state, 'openclaw.json'))).model, 'codex/test-model');
  assert.equal(await fs.readFile(path.join(f.state, 'credential-fixture'), 'utf8'), 'test-only-oauth');
});

test('local configuration survives supervisor restarts without rollback', async t => {
  const f = await fixture(t);
  await f.backup.save();
  await fs.writeFile(path.join(f.state, 'openclaw.json'), '{"model":"new-model"}');
  await f.backup.restore();
  assert.equal(JSON.parse(await fs.readFile(path.join(f.state, 'openclaw.json'))).model, 'new-model');
});

test('missing bucket fails closed rather than creating ephemeral backup storage', async t => {
  const f = await fixture(t);
  await assert.rejects(stateBackup(f.state, path.join(f.bucket, 'absent')).restore());
});

test('corrupt archive cannot replace or silently reset state', async t => {
  const f = await fixture(t);
  await f.backup.save();
  const archive = (await fs.readdir(f.bucket)).find(n => n.endsWith('.gz'));
  await fs.writeFile(path.join(f.bucket, archive), 'corrupt');
  await fs.rename(f.state, f.state + '-old');
  await assert.rejects(f.backup.restore(), /hash mismatch/);
  await assert.rejects(fs.access(f.state));
});

test('metadata traversal is rejected before extraction', async t => {
  const f = await fixture(t);
  await f.backup.save();
  const name = (await fs.readdir(f.bucket)).find(n => n.endsWith('.json'));
  const file = path.join(f.bucket, name);
  const metadata = JSON.parse(await fs.readFile(file));
  metadata.statePath = '../outside';
  await fs.writeFile(file, JSON.stringify(metadata));
  await fs.rename(f.state, f.state + '-old');
  await assert.rejects(f.backup.restore(), /Invalid checkpoint/);
});

test('failed native verification does not publish a checkpoint', async t => {
  const f = await fixture(t);
  const backup = stateBackup(f.state, f.bucket, async () => ({ verified: false }));
  await assert.rejects(backup.save(), /did not verify/);
  assert.deepEqual(await fs.readdir(f.bucket), []);
});

test('concurrent saves join one checkpoint and retention keeps three complete generations', async t => {
  const f = await fixture(t);
  await Promise.all([f.backup.save(), f.backup.save()]);
  assert.equal((await fs.readdir(f.bucket)).length, 2);
  for (let i = 0; i < 4; i++) await f.backup.save();
  assert.equal((await fs.readdir(f.bucket)).length, 6);
});

test('watchdog restarts only after consecutive failures, and resets on recovery', async () => {
  const results = [false, false, true, false, false, false];
  let restarts = 0;
  const tick = healthWatchdog(async () => results.shift(), async () => { restarts++; });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(restarts, 0);
  await tick(); assert.equal(restarts, 1);
});
