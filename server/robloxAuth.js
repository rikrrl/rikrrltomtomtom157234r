/**
 * Roblox-OAuth 2.0 (offizielle Schnittstelle).
 *
 * Wird nur aktiv, wenn ROBLOX_CLIENT_ID und ROBLOX_CLIENT_SECRET gesetzt sind
 * (Settings -> Environment variables). Ohne diese Zugangsdaten funktioniert die
 * Ein-Klick-Anmeldung der App ganz normal weiter.
 */

const AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token';
const USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo';
const SCOPES = 'openid profile';

export function robloxOAuthConfigured() {
  return Boolean(process.env.ROBLOX_CLIENT_ID && process.env.ROBLOX_CLIENT_SECRET);
}

export function buildAuthorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: process.env.ROBLOX_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env.ROBLOX_CLIENT_ID,
    client_secret: process.env.ROBLOX_CLIENT_SECRET,
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error(`Roblox-Token-Austausch fehlgeschlagen (HTTP ${response.status})`);
  }
  return response.json();
}

export async function fetchRobloxUser(accessToken) {
  const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Roblox-Profil konnte nicht geladen werden (HTTP ${response.status})`);
  }
  return response.json();
}
