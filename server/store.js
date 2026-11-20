import crypto from 'node:crypto';

/**
 * In-Memory-Speicher für Roblox AI Builder.
 *
 * Alles, was für den Ablauf gebraucht wird, lebt pro Benutzer:
 * Sitzung -> Kopplungscode -> Plugin-Token -> Welt-Scan -> Nachbau-Job.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const PAIRING_TTL_MS = 15 * 60 * 1000; // 15 Minuten
const STUDIO_TTL_MS = 30 * 1000; // Heartbeat alle 6 s
const WORLD_TTL_MS = 60 * 60 * 1000; // 1 Stunde
const JOB_LIMIT = 20;

const users = new Map(); // userId -> user
const sessions = new Map(); // sid -> { userId, createdAt }
const pairings = new Map(); // code -> { userId, createdAt }
const pluginTokens = new Map(); // token -> userId
const studios = new Map(); // userId -> { token, mode, placeId, gameName, partCount, lastSeen, connectedAt }
const worlds = new Map(); // userId -> world
const jobs = new Map(); // jobId -> job
const userJobs = new Map(); // userId -> [jobId]
const commands = new Map(); // userId -> [command]

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function id() {
  return crypto.randomUUID();
}

export function createPairingCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += PAIRING_ALPHABET[crypto.randomInt(0, PAIRING_ALPHABET.length)];
  }
  return code;
}

export function createUser(name) {
  const cleanName = String(name || '').trim().slice(0, 40);
  const user = {
    id: id(),
    name: cleanName || 'Roblox-Builder',
    createdAt: Date.now(),
    method: 'local',
  };
  users.set(user.id, user);
  return user;
}

export function getUser(userId) {
  return users.get(userId) || null;
}

export function createSession(userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { userId, createdAt: Date.now() });
  return sid;
}

export function getSessionUser(sid) {
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  return users.get(session.userId) || null;
}

export function deleteSession(sid) {
  if (sid) sessions.delete(sid);
}

export function createPairing(userId) {
  for (const [code, entry] of pairings) {
    if (entry.userId === userId) pairings.delete(code);
  }
  const code = createPairingCode();
  const entry = { userId, createdAt: Date.now(), expiresAt: Date.now() + PAIRING_TTL_MS };
  pairings.set(code, entry);
  return { code, expiresAt: entry.expiresAt };
}

export function consumePairing(code) {
  const key = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const entry = pairings.get(key);
  if (!entry) return { ok: false, error: 'code_invalid' };
  if (Date.now() > entry.expiresAt) {
    pairings.delete(key);
    return { ok: false, error: 'code_expired' };
  }
  const token = crypto.randomBytes(28).toString('hex');
  pluginTokens.set(token, entry.userId);
  studios.set(entry.userId, {
    token,
    mode: 'plugin',
    placeId: 0,
    gameName: 'Roblox Studio',
    partCount: 0,
    lastSeen: Date.now(),
    connectedAt: Date.now(),
  });
  return { ok: true, token, userId: entry.userId, user: users.get(entry.userId) || null };
}

export function getStudioByToken(token) {
  if (!token) return null;
  const userId = pluginTokens.get(token);
  if (!userId) return null;
  const studio = studios.get(userId);
  if (!studio || studio.token !== token) return null;
  return { userId, studio };
}

export function touchStudio(userId, patch = {}) {
  const studio = studios.get(userId);
  if (!studio) return null;
  Object.assign(studio, patch, { lastSeen: Date.now() });
  return studio;
}

export function setDemoStudio(userId) {
  const token = `demo-${crypto.randomBytes(12).toString('hex')}`;
  pluginTokens.set(token, userId);
  const studio = {
    token,
    mode: 'demo',
    placeId: 0,
    gameName: 'Demo-Welt',
    partCount: 0,
    lastSeen: Date.now(),
    connectedAt: Date.now(),
  };
  studios.set(userId, studio);
  return studio;
}

export function removeStudio(userId) {
  const studio = studios.get(userId);
  if (!studio) return;
  pluginTokens.delete(studio.token);
  studios.delete(userId);
}

export function getStudio(userId) {
  const studio = studios.get(userId);
  if (!studio) return { connected: false, mode: null, gameName: null, placeId: null, partCount: 0, lastSeen: null };
  const age = Date.now() - studio.lastSeen;
  const connected = studio.mode === 'demo' ? true : age <= STUDIO_TTL_MS;
  return {
    connected,
    mode: studio.mode,
    gameName: studio.gameName,
    placeId: studio.placeId,
    partCount: studio.partCount,
    lastSeen: studio.lastSeen,
    secondsSinceSeen: Math.round(age / 1000),
  };
}

export function setWorld(userId, world) {
  const existing = worlds.get(userId);
  const job = latestJob(userId);
  const jobRunning = job && (job.status === 'running' || job.status === 'awaiting_studio');
  const entry = {
    id: id(),
    userId,
    createdAt: Date.now(),
    decision: jobRunning && existing ? existing.decision : null,
    jobId: jobRunning && existing ? existing.jobId : null,
    ...world,
  };
  worlds.set(userId, entry);
  return entry;
}

export function getWorld(userId) {
  const world = worlds.get(userId);
  if (!world) return null;
  if (Date.now() - world.createdAt > WORLD_TTL_MS) {
    worlds.delete(userId);
    return null;
  }
  return world;
}

export function setWorldDecision(userId, decision, jobId = null) {
  const world = worlds.get(userId);
  if (!world) return null;
  world.decision = decision;
  if (jobId) world.jobId = jobId;
  return world;
}

export function createJob(job) {
  jobs.set(job.id, job);
  const list = userJobs.get(job.userId) || [];
  list.unshift(job.id);
  while (list.length > JOB_LIMIT) {
    const dropped = list.pop();
    jobs.delete(dropped);
  }
  userJobs.set(job.userId, list);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function latestJob(userId) {
  const list = userJobs.get(userId) || [];
  for (const jobId of list) {
    const job = jobs.get(jobId);
    if (job) return job;
  }
  return null;
}

export function queueCommand(userId, command) {
  const list = commands.get(userId) || [];
  list.push(command);
  commands.set(userId, list);
}

export function drainCommands(userId) {
  const list = commands.get(userId) || [];
  commands.set(userId, []);
  return list;
}

export function stats() {
  return {
    users: users.size,
    sessions: sessions.size,
    studios: studios.size,
    worlds: worlds.size,
    jobs: jobs.size,
  };
}

/** Abgelaufene Einträge aufräumen, damit der Speicher nicht wächst. */
export function cleanup() {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(sid);
  }
  for (const [code, pairing] of pairings) {
    if (now > pairing.expiresAt) pairings.delete(code);
  }
  for (const [userId, studio] of studios) {
    if (studio.mode !== 'demo' && now - studio.lastSeen > 10 * 60 * 1000) {
      pluginTokens.delete(studio.token);
      studios.delete(userId);
    }
  }
  for (const [userId, world] of worlds) {
    if (now - world.createdAt > WORLD_TTL_MS) worlds.delete(userId);
  }
}

export const TTL = { SESSION_TTL_MS, PAIRING_TTL_MS, STUDIO_TTL_MS, WORLD_TTL_MS };
