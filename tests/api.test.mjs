import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../server/app.js';
import { buildDemoWorld } from '../server/demoWorld.js';

async function startServer() {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function makeClient(base) {
  let cookie = '';
  const call = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    let body;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers,
      body,
    });
    const setCookie = response.headers.getSetCookie?.() || [];
    for (const entry of setCookie) {
      const pair = entry.split(';')[0];
      if (pair.startsWith('rab_sid=')) cookie = pair;
    }
    const text = await response.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* Textantwort */
    }
    return { status: response.status, data, headers: response.headers };
  };
  return { call, setCookie: (value) => { cookie = value; } };
}

async function waitFor(fn, { timeout = 12000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Zeitüberschreitung beim Warten auf den Zustand');
}

test('kompletter Ablauf: Anmeldung -> Kopplung -> Welt-Scan -> Bestätigung -> Einfügen', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = makeClient(server.base);
  const world = buildDemoWorld();

  // Anmeldung mit einem Klick
  const login = await client.call('/api/auth/login', { method: 'POST', json: { name: '' } });
  assert.equal(login.status, 201);
  assert.ok(login.data.user.id);

  const me = await client.call('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, login.data.user.id);

  // Anfangs ist nichts verbunden
  const initial = await client.call('/api/state');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.studio.connected, false);
  assert.equal(initial.data.world, null);
  assert.equal(initial.data.needsConfirm, false);

  // Kopplungscode erzeugen und Plugin verbinden
  const pairing = await client.call('/api/pairing', { method: 'POST' });
  assert.equal(pairing.status, 201);
  assert.match(pairing.data.code, /^[A-Z0-9]{6}$/);
  assert.ok(pairing.data.pluginUrl.endsWith('/api/plugin/source'));

  const pair = await client.call('/api/plugin/pair', { method: 'POST', json: { code: pairing.data.code } });
  assert.equal(pair.status, 200);
  const token = pair.data.token;
  assert.ok(token.length > 20);
  assert.equal(pair.data.user.id, login.data.user.id);

  // Kopplungscode ist nur einmal gültig
  const reuse = await client.call('/api/plugin/pair', { method: 'POST', json: { code: pairing.data.code } });
  assert.equal(reuse.status, 400);

  const auth = { authorization: `Bearer ${token}` };

  const heartbeat = await client.call('/api/plugin/heartbeat', {
    method: 'POST',
    headers: auth,
    json: { place: { placeId: 987654, gameName: 'Testspiel' }, partCount: 0 },
  });
  assert.equal(heartbeat.status, 200);

  const connected = await client.call('/api/state');
  assert.equal(connected.data.studio.connected, true);
  assert.equal(connected.data.studio.mode, 'plugin');
  assert.equal(connected.data.studio.gameName, 'Testspiel');

  // Welt-Scan des Plugins
  const scan = await client.call('/api/plugin/world', {
    method: 'POST',
    headers: auth,
    json: { place: { placeId: 987654, gameName: 'Testspiel' }, parts: world.parts },
  });
  assert.equal(scan.status, 201);
  assert.ok(scan.data.summary.partCount > 20);
  assert.ok(scan.data.summary.categories.length >= 3);

  const detected = await client.call('/api/state');
  assert.equal(detected.data.needsConfirm, true, 'der Nachbau-Dialog muss erscheinen');
  assert.equal(detected.data.world.place.gameName, 'Testspiel');
  assert.equal(detected.data.world.decision, null);

  // "Ja, nachbauen"
  const job = await client.call('/api/jobs', { method: 'POST' });
  assert.equal(job.status, 201);
  const jobId = job.data.job.id;
  assert.equal(job.data.job.steps.length, 5);
  assert.deepEqual(
    job.data.job.steps.map((step) => step.label),
    [
      'Spiel wird erkannt',
      'Spielwelt wird analysiert',
      'Modelle werden erstellt',
      'Spielwelt wird gebaut',
      'Nachbau ist fertig',
    ],
  );

  const queued = await waitFor(async () => {
    const state = await client.call('/api/state');
    if (state.data.job.status === 'awaiting_studio') return state.data;
    return null;
  });
  assert.ok(queued.job.models.length >= 3);
  assert.ok(queued.job.scripts.length >= 1);
  assert.ok(queued.job.fidelity >= 40 && queued.job.fidelity <= 98);

  // Das Plugin holt den Auftrag ab
  const commands = await client.call('/api/plugin/commands', { headers: auth });
  assert.equal(commands.status, 200);
  assert.equal(commands.data.commands.length, 1);
  const command = commands.data.commands[0];
  assert.equal(command.type, 'build');
  assert.equal(command.jobId, jobId);
  assert.ok(command.models.length >= 3);
  assert.ok(command.models[0].parts.length > 0);
  assert.ok(command.scripts.length >= 1);

  const drained = await client.call('/api/plugin/commands', { headers: auth });
  assert.equal(drained.data.commands.length, 0, 'Auftrag darf nur einmal ausgeliefert werden');

  // Fortschritt aus Studio
  const total = command.models.reduce((sum, model) => sum + model.parts.length, 0);
  const progress = await client.call('/api/plugin/progress', {
    method: 'POST',
    headers: auth,
    json: { jobId, done: Math.floor(total / 2), total },
  });
  assert.equal(progress.status, 200);
  assert.ok(progress.data.progress >= 5 && progress.data.progress <= 100);

  const complete = await client.call('/api/plugin/complete', {
    method: 'POST',
    headers: auth,
    json: { jobId, inserted: total, errors: [] },
  });
  assert.equal(complete.status, 200);

  const done = await client.call('/api/state');
  assert.equal(done.data.job.status, 'done');
  assert.equal(done.data.job.result.inserted, total);
  assert.ok(done.data.job.steps.every((step) => step.status === 'completed' && step.progress === 100));
  assert.equal(done.data.world.decision, 'accepted');
  assert.equal(done.data.needsConfirm, false);
});

test('Demo-Modus ohne Roblox Studio läuft bis zum fertigen Nachbau', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = makeClient(server.base);

  await client.call('/api/auth/login', { method: 'POST', json: {} });
  const demo = await client.call('/api/demo/studio', { method: 'POST' });
  assert.equal(demo.status, 201);
  assert.ok(demo.data.summary.partCount > 20);

  const detected = await client.call('/api/state');
  assert.equal(detected.data.studio.connected, true);
  assert.equal(detected.data.studio.mode, 'demo');
  assert.equal(detected.data.needsConfirm, true);

  const job = await client.call('/api/jobs', { method: 'POST' });
  assert.equal(job.status, 201);

  const finished = await waitFor(async () => {
    const state = await client.call('/api/state');
    return state.data.job.status === 'done' ? state.data.job : null;
  });
  assert.ok(finished.result.inserted > 0);
  assert.ok(finished.models.length >= 3);
  assert.ok(finished.fidelity >= 40);

  const disconnect = await client.call('/api/demo/studio', { method: 'DELETE' });
  assert.equal(disconnect.status, 200);
  const offline = await client.call('/api/state');
  assert.equal(offline.data.studio.connected, false);
});

test('"Nein" lehnt den Nachbau ab und schließt den Dialog', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = makeClient(server.base);

  await client.call('/api/auth/login', { method: 'POST', json: {} });
  await client.call('/api/demo/studio', { method: 'POST' });

  const before = await client.call('/api/state');
  assert.equal(before.data.needsConfirm, true);

  const decline = await client.call('/api/jobs/decline', { method: 'POST' });
  assert.equal(decline.status, 200);

  const after = await client.call('/api/state');
  assert.equal(after.data.world.decision, 'declined');
  assert.equal(after.data.needsConfirm, false);
  assert.equal(after.data.job, null);
});

test('Zugriffsschutz: ohne Sitzung und ohne Plugin-Token kein Zugriff', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = makeClient(server.base);

  const state = await client.call('/api/state');
  assert.equal(state.status, 401);

  const jobs = await client.call('/api/jobs', { method: 'POST' });
  assert.equal(jobs.status, 401);

  const world = await client.call('/api/plugin/world', {
    method: 'POST',
    headers: { authorization: 'Bearer ungueltig' },
    json: { parts: [{ position: [0, 0, 0], size: [4, 4, 4] }] },
  });
  assert.equal(world.status, 401);

  const health = await client.call('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
});

test('Plugin-Quelle wird mit der Server-Adresse ausgeliefert', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = makeClient(server.base);

  const source = await client.call('/api/plugin/source');
  assert.equal(source.status, 200);
  assert.equal(typeof source.data, 'string');
  assert.ok(source.data.includes('Roblox AI Builder'));
  assert.ok(source.data.includes(server.base));
  assert.ok(!source.data.includes('__BASE_URL__'), 'Platzhalter muss ersetzt sein');

  const download = await fetch(`${server.base}/plugin/RobloxAIBuilder.lua`);
  assert.equal(download.status, 200);
  const body = await download.text();
  assert.ok(body.includes('HttpService:RequestAsync'));
});
