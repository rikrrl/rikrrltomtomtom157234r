import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import * as store from './store.js';
import { analyzeWorld } from './analyzer.js';
import { buildPlan } from './planner.js';
import { buildDemoWorld } from './demoWorld.js';
import { robloxOAuthConfigured, buildAuthorizeUrl, exchangeCode, fetchRobloxUser } from './robloxAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = path.join(__dirname, '..', 'plugin', 'RobloxAIBuilder.lua');
const DIST_PATH = path.join(__dirname, '..', 'dist');
const SESSION_COOKIE = 'rab_sid';

const STEP_DEFS = [
  { key: 'detect', label: 'Spiel wird erkannt' },
  { key: 'analyze', label: 'Spielwelt wird analysiert' },
  { key: 'models', label: 'Modelle werden erstellt' },
  { key: 'build', label: 'Spielwelt wird gebaut' },
  { key: 'done', label: 'Nachbau ist fertig' },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function readCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index === -1) continue;
    cookies[chunk.slice(0, index).trim()] = decodeURIComponent(chunk.slice(index + 1).trim());
  }
  return cookies;
}

function cookieHeader(name, value, maxAgeSeconds, secure) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    method: user.method,
    robloxId: user.robloxId || null,
    createdAt: user.createdAt,
  };
}

function serializeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    steps: job.steps,
    models: job.models,
    scripts: job.scripts,
    stats: job.stats,
    fidelity: job.fidelity,
    disclaimer: job.disclaimer,
    analysis: job.analysis,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function setStep(job, key, progress, status) {
  const step = job.steps.find((entry) => entry.key === key);
  if (!step) return;
  step.progress = clamp(Math.round(progress), 0, 100);
  if (status) step.status = status;
  job.updatedAt = Date.now();
}

function finishJob(job, inserted, errors = []) {
  setStep(job, 'build', 100, 'completed');
  setStep(job, 'done', 100, 'completed');
  job.status = 'done';
  job.result = { inserted, errors: errors.slice(0, 10), completedAt: Date.now() };
  job.updatedAt = Date.now();
}

function simulateBuild(job, plan) {
  const totalParts = plan.stats.builtParts;
  const ticks = 10;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    if (tick >= ticks) {
      clearInterval(timer);
      setStep(job, 'build', 100, 'completed');
      finishJob(job, totalParts, []);
      return;
    }
    setStep(job, 'build', Math.round((tick / ticks) * 100), 'active');
  }, 260);
  if (typeof timer.unref === 'function') timer.unref();
}

async function runJob(job, world) {
  try {
    setStep(job, 'detect', 100, 'completed');
    await delay(120);
    setStep(job, 'analyze', 30, 'active');
    await delay(120);
    const analysis = analyzeWorld(world);
    job.analysis = {
      categories: analysis.categoryCounts,
      palette: analysis.palette,
      materials: analysis.materials,
      metrics: analysis.metrics,
      bounds: analysis.bounds,
    };
    setStep(job, 'analyze', 100, 'completed');
    await delay(120);
    setStep(job, 'models', 45, 'active');
    await delay(120);
    const plan = buildPlan(world, analysis);
    job.models = plan.models.map((model) => ({
      name: model.name,
      category: model.category,
      categoryLabel: model.categoryLabel,
      partCount: model.parts.length,
    }));
    job.scripts = plan.scripts;
    job.stats = plan.stats;
    job.fidelity = plan.fidelity;
    job.disclaimer = plan.disclaimer;
    setStep(job, 'models', 100, 'completed');
    setStep(job, 'build', 5, 'active');
    job.status = 'awaiting_studio';

    if (job.mode === 'demo') {
      simulateBuild(job, plan);
    } else {
      store.queueCommand(job.userId, {
        type: 'build',
        jobId: job.id,
        models: plan.models,
        scripts: plan.scripts,
      });
    }
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unbekannter Fehler bei der Analyse.';
    job.updatedAt = Date.now();
    const active = job.steps.find((step) => step.status === 'active');
    if (active) active.status = 'pending';
  }
}

function createJob(userId, world, mode) {
  const job = {
    id: crypto.randomUUID(),
    userId,
    worldId: world.id,
    mode: mode === 'demo' ? 'demo' : 'plugin',
    status: 'running',
    steps: STEP_DEFS.map((def) => ({ ...def, status: 'pending', progress: 0 })),
    models: [],
    scripts: [],
    stats: null,
    fidelity: null,
    disclaimer: null,
    analysis: null,
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.createJob(job);
  runJob(job, world);
  return job;
}

function stateFor(userId) {
  const user = store.getUser(userId);
  const studio = store.getStudio(userId);
  const world = store.getWorld(userId);
  const job = store.latestJob(userId);
  const jobRunning = Boolean(job && (job.status === 'running' || job.status === 'awaiting_studio'));
  const needsConfirm = Boolean(world && world.decision === null && !jobRunning);
  return {
    user: publicUser(user),
    studio,
    world: world
      ? {
          id: world.id,
          createdAt: world.createdAt,
          decision: world.decision,
          place: world.place,
          summary: world.summary,
        }
      : null,
    job: serializeJob(job),
    needsConfirm,
  };
}

function worldSummary(analysis, place) {
  return {
    partCount: analysis.partCount,
    rejectedParts: analysis.rejectedParts,
    bounds: analysis.bounds,
    categories: analysis.categoryCounts.map((entry) => ({
      category: entry.category,
      label: entry.label,
      count: entry.count,
    })),
    palette: analysis.palette,
    materials: analysis.materials,
    metrics: analysis.metrics,
    place: place || null,
  };
}

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  // --- Middleware -------------------------------------------------------
  const requireAuth = (req, res, next) => {
    const cookies = readCookies(req);
    const user = store.getSessionUser(cookies[SESSION_COOKIE]);
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'Bitte zuerst anmelden.' });
      return;
    }
    req.user = user;
    req.sid = cookies[SESSION_COOKIE];
    next();
  };

  const requirePlugin = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const found = store.getStudioByToken(token);
    if (!found) {
      res.status(401).json({
        error: 'invalid_token',
        message: 'Kopplung ungültig. Bitte in Roblox Studio mit einem neuen Code verbinden.',
      });
      return;
    }
    req.userId = found.userId;
    req.studio = found.studio;
    next();
  };

  const pairingAttempts = new Map();
  const limitPairing = (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = pairingAttempts.get(key);
    if (!entry || now > entry.resetAt) {
      pairingAttempts.set(key, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > 30) {
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele Versuche. Bitte kurz warten.' });
      return;
    }
    next();
  };

  // --- Basis ------------------------------------------------------------
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'roblox-ai-builder', version: '1.0.0', stats: store.stats() });
  });

  app.get('/api/auth/config', (req, res) => {
    res.json({ robloxOAuth: robloxOAuthConfigured(), service: 'Roblox AI Builder' });
  });

  // --- Anmeldung --------------------------------------------------------
  app.post('/api/auth/login', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const user = store.createUser(name);
    const sid = store.createSession(user.id);
    res.setHeader('Set-Cookie', cookieHeader(SESSION_COOKIE, sid, 30 * 24 * 60 * 60, isSecure(req)));
    res.status(201).json({ user: publicUser(user) });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const cookies = readCookies(req);
    store.deleteSession(cookies[SESSION_COOKIE]);
    res.setHeader('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0, isSecure(req)));
    res.json({ ok: true });
  });

  app.get('/api/auth/roblox/start', (req, res) => {
    if (!robloxOAuthConfigured()) {
      res.status(503).json({
        error: 'roblox_oauth_not_configured',
        message:
          'Roblox-OAuth ist nicht eingerichtet. Trage ROBLOX_CLIENT_ID und ROBLOX_CLIENT_SECRET in den Einstellungen (Environment variables) ein.',
      });
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', cookieHeader('rab_oauth_state', state, 600, isSecure(req)));
    res.redirect(buildAuthorizeUrl({ state, redirectUri: `${baseUrl(req)}/api/auth/roblox/callback` }));
  });

  app.get('/api/auth/roblox/callback', async (req, res) => {
    const cookies = readCookies(req);
    const state = cookies.rab_oauth_state;
    if (!robloxOAuthConfigured()) {
      res.status(503).send('Roblox-OAuth ist nicht eingerichtet.');
      return;
    }
    if (!state || state !== req.query.state || typeof req.query.code !== 'string') {
      res.redirect('/?oauth=invalid_state');
      return;
    }
    try {
      const tokens = await exchangeCode({
        code: req.query.code,
        redirectUri: `${baseUrl(req)}/api/auth/roblox/callback`,
      });
      const profile = await fetchRobloxUser(tokens.access_token);
      const user = store.createUser(profile.preferred_username || profile.name || 'Roblox-Konto');
      user.method = 'roblox';
      user.robloxId = profile.sub || null;
      const sid = store.createSession(user.id);
      res.setHeader('Set-Cookie', [
        cookieHeader(SESSION_COOKIE, sid, 30 * 24 * 60 * 60, isSecure(req)),
        cookieHeader('rab_oauth_state', '', 0, isSecure(req)),
      ]);
      res.redirect('/?oauth=ok');
    } catch (error) {
      res.redirect(`/?oauth=error&reason=${encodeURIComponent(error instanceof Error ? error.message : 'unknown')}`);
    }
  });

  // --- Kopplung mit Roblox Studio --------------------------------------
  app.post('/api/pairing', requireAuth, (req, res) => {
    const pairing = store.createPairing(req.user.id);
    res.status(201).json({
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      pluginUrl: `${baseUrl(req)}/api/plugin/source`,
    });
  });

  app.post('/api/plugin/pair', limitPairing, (req, res) => {
    const result = store.consumePairing(req.body?.code);
    if (!result.ok) {
      res.status(400).json({
        error: result.error,
        message:
          result.error === 'code_expired'
            ? 'Der Kopplungscode ist abgelaufen. Bitte in der Web-App einen neuen Code erzeugen.'
            : 'Kopplungscode unbekannt. Bitte prüfe den Code in der Web-App.',
      });
      return;
    }
    res.json({ token: result.token, user: publicUser(result.user) });
  });

  app.post('/api/plugin/heartbeat', requirePlugin, (req, res) => {
    const place = req.body?.place || {};
    const studio = store.touchStudio(req.userId, {
      placeId: Number(place.placeId) || 0,
      gameName: typeof place.gameName === 'string' ? place.gameName.slice(0, 120) : 'Roblox Studio',
      partCount: Number(req.body?.partCount) || 0,
    });
    res.json({
      ok: true,
      studio: { gameName: studio.gameName, placeId: studio.placeId, partCount: studio.partCount },
      serverTime: Date.now(),
    });
  });

  app.post('/api/plugin/world', requirePlugin, (req, res) => {
    const body = req.body || {};
    const parts = Array.isArray(body.parts) ? body.parts : null;
    if (!parts || parts.length === 0) {
      res.status(400).json({ error: 'no_parts', message: 'Es wurden keine Bauteile übertragen.' });
      return;
    }
    const place = {
      placeId: Number(body.place?.placeId) || 0,
      gameName:
        typeof body.place?.gameName === 'string' && body.place.gameName
          ? body.place.gameName.slice(0, 120)
          : 'Roblox-Spiel',
      source: 'studio',
    };

    let analysis;
    try {
      analysis = analyzeWorld({ parts });
    } catch (error) {
      res.status(422).json({
        error: 'analysis_failed',
        message: error instanceof Error ? error.message : 'Spielwelt konnte nicht analysiert werden.',
      });
      return;
    }

    const world = store.setWorld(req.userId, {
      place,
      parts,
      summary: worldSummary(analysis, place),
    });
    store.touchStudio(req.userId, { gameName: place.gameName, placeId: place.placeId, partCount: parts.length });

    res.status(201).json({
      worldId: world.id,
      detectedAt: world.createdAt,
      summary: world.summary,
    });
  });

  app.get('/api/plugin/commands', requirePlugin, (req, res) => {
    store.touchStudio(req.userId, {});
    const commands = store.drainCommands(req.userId);
    res.json({ commands });
  });

  app.post('/api/plugin/progress', requirePlugin, (req, res) => {
    const job = store.getJob(String(req.body?.jobId || ''));
    if (!job || job.userId !== req.userId) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    const done = Number(req.body?.done) || 0;
    const total = Number(req.body?.total) || 0;
    const progress = total > 0 ? clamp(Math.round((done / total) * 100), 5, 100) : 5;
    setStep(job, 'build', progress, 'active');
    res.json({ ok: true, progress });
  });

  app.post('/api/plugin/complete', requirePlugin, (req, res) => {
    const job = store.getJob(String(req.body?.jobId || ''));
    if (!job || job.userId !== req.userId) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    const errors = Array.isArray(req.body?.errors) ? req.body.errors.map((entry) => String(entry).slice(0, 200)) : [];
    finishJob(job, Number(req.body?.inserted) || 0, errors);
    res.json({ ok: true });
  });

  // --- Nachbau-Jobs -----------------------------------------------------
  app.post('/api/jobs', requireAuth, (req, res) => {
    const world = store.getWorld(req.user.id);
    if (!world) {
      res.status(409).json({ error: 'no_world', message: 'Es wurde noch keine Spielwelt erkannt.' });
      return;
    }
    const studio = store.getStudio(req.user.id);
    if (!studio.connected) {
      res.status(409).json({
        error: 'studio_offline',
        message: 'Roblox Studio ist nicht verbunden. Bitte zuerst das Plugin verbinden.',
      });
      return;
    }
    const running = store.latestJob(req.user.id);
    if (running && (running.status === 'running' || running.status === 'awaiting_studio')) {
      res.status(409).json({ error: 'job_running', message: 'Ein Nachbau läuft bereits.' });
      return;
    }
    const job = createJob(req.user.id, world, studio.mode);
    store.setWorldDecision(req.user.id, 'accepted', job.id);
    res.status(201).json({ job: serializeJob(job) });
  });

  app.post('/api/jobs/decline', requireAuth, (req, res) => {
    store.setWorldDecision(req.user.id, 'declined');
    res.json({ ok: true });
  });

  app.get('/api/state', requireAuth, (req, res) => {
    res.json(stateFor(req.user.id));
  });

  // --- Demo-Modus (ohne installiertes Roblox Studio) --------------------
  app.post('/api/demo/studio', requireAuth, (req, res) => {
    const world = buildDemoWorld();
    const analysis = analyzeWorld(world);
    store.setDemoStudio(req.user.id);
    const entry = store.setWorld(req.user.id, {
      place: world.place,
      parts: world.parts,
      summary: worldSummary(analysis, world.place),
    });
    store.touchStudio(req.user.id, {
      gameName: world.place.gameName,
      placeId: world.place.placeId,
      partCount: world.parts.length,
    });
    res.status(201).json({ worldId: entry.id, summary: entry.summary });
  });

  app.delete('/api/demo/studio', requireAuth, (req, res) => {
    const studio = store.getStudio(req.user.id);
    if (studio.mode === 'demo') store.removeStudio(req.user.id);
    res.json({ ok: true });
  });

  // --- Plugin-Quelle ----------------------------------------------------
  app.get('/api/plugin/source', (req, res) => {
    let source;
    try {
      source = fs.readFileSync(PLUGIN_PATH, 'utf8');
    } catch {
      res.status(500).json({ error: 'plugin_missing', message: 'Plugin-Datei nicht gefunden.' });
      return;
    }
    const withBase = source.replace(/__BASE_URL__/g, baseUrl(req));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="RobloxAIBuilder.lua"');
    res.send(withBase);
  });

  app.get('/plugin/RobloxAIBuilder.lua', (req, res) => {
    let source;
    try {
      source = fs.readFileSync(PLUGIN_PATH, 'utf8');
    } catch {
      res.status(404).send('-- Plugin nicht gefunden');
      return;
    }
    const withBase = source.replace(/__BASE_URL__/g, baseUrl(req));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="RobloxAIBuilder.lua"');
    res.send(withBase);
  });

  // --- Statischer Client ------------------------------------------------
  if (fs.existsSync(DIST_PATH)) {
    app.use(express.static(DIST_PATH, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(DIST_PATH, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error?.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({
      error: 'server_error',
      message: status === 413 ? 'Die übertragene Spielwelt ist zu groß.' : 'Interner Serverfehler.',
    });
  });

  return app;
}
