import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 2000;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Fehler ${response.status}`);
    error.status = response.status;
    error.code = data?.error;
    throw error;
  }
  return data;
}

function overallProgress(steps) {
  if (!steps || steps.length === 0) return 0;
  const total = steps.reduce((sum, step) => sum + (step.progress || 0), 0);
  return Math.round(total / steps.length);
}

function stepIcon(step) {
  if (step.status === 'completed') return '✓';
  if (step.status === 'active') return '◐';
  return '○';
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE').format(Math.round(Number(value) || 0));
}

function swatchStyle(hex) {
  return { background: hex };
}

/* ------------------------------------------------------------------ Login */

function Login({ onLogin, config, busy, error }) {
  return (
    <main className="login">
      <div className="login-orb login-orb--blue" />
      <div className="login-orb login-orb--violet" />
      <section className="login-card">
        <div className="brand">
          <span className="brand-mark">RB</span>
          <div>
            <h1>Roblox AI Builder</h1>
            <p className="brand-sub">Meine eigene Roblox-KI</p>
          </div>
        </div>

        <p className="login-lead">
          Spielwelt öffnen, ein Klick – und deine KI baut sie mit eigenen Modellen und Skripten in
          Roblox Studio nach.
        </p>

        <button className="btn btn--primary btn--xl" onClick={onLogin} disabled={busy}>
          {busy ? 'Anmeldung läuft …' : 'Mit einem Klick starten'}
        </button>

        {config?.robloxOAuth ? (
          <a className="btn btn--ghost btn--xl" href="/api/auth/roblox/start">
            Mit Roblox-Konto verbinden
          </a>
        ) : (
          <p className="hint">
            Die Anmeldung funktioniert sofort ohne Passwort. Eine echte Roblox-OAuth-Verknüpfung lässt
            sich zusätzlich über die Einstellungen aktivieren.
          </p>
        )}

        {error ? <p className="alert alert--error">{error}</p> : null}

        <ul className="login-facts">
          <li>Erkennt deine geöffnete Spielwelt in Roblox Studio</li>
          <li>Erzeugt eigene Modelle, Gebäude, Straßen und Landschaften</li>
          <li>Fügt alles automatisch in dein Studio-Projekt ein</li>
        </ul>
      </section>
      <p className="login-foot">
        Nur eigene Inhalte: Es werden keine fremden Modelle, Assets oder privaten Skripte übernommen.
      </p>
    </main>
  );
}

/* --------------------------------------------------------------- Bausteine */

function StudioCard({ studio, pairing, pluginUrl, onNewCode, onConnectDemo, onDisconnectDemo, onCopy, copied }) {
  const connected = Boolean(studio?.connected);
  const isDemo = studio?.mode === 'demo';

  return (
    <section className="card">
      <header className="card-head">
        <h2>Roblox Studio</h2>
        <span className={`pill ${connected ? 'pill--ok' : 'pill--off'}`}>
          <span className="dot" />
          {connected ? (isDemo ? 'Demo verbunden' : 'Studio verbunden') : 'Nicht verbunden'}
        </span>
      </header>

      {connected ? (
        <dl className="kv">
          <div>
            <dt>Projekt</dt>
            <dd>{studio.gameName || 'Roblox Studio'}</dd>
          </div>
          <div>
            <dt>Place-ID</dt>
            <dd>{studio.placeId ? formatNumber(studio.placeId) : '—'}</dd>
          </div>
          <div>
            <dt>Bauteile im Workspace</dt>
            <dd>{formatNumber(studio.partCount)}</dd>
          </div>
          <div>
            <dt>Letztes Signal</dt>
            <dd>{studio.secondsSinceSeen != null ? `vor ${studio.secondsSinceSeen} s` : '—'}</dd>
          </div>
        </dl>
      ) : (
        <>
          <p className="muted">
            Verbinde Roblox Studio mit dem Kopplungscode. Das Plugin meldet sich danach automatisch und
            überträgt die geöffnete Spielwelt.
          </p>

          <div className="pair-box">
            <span className="pair-label">Kopplungscode</span>
            <strong className="pair-code">{pairing?.code || '······'}</strong>
            <div className="pair-actions">
              <button className="btn btn--small" onClick={() => onCopy(pairing?.code)}>
                {copied === 'code' ? 'Kopiert' : 'Code kopieren'}
              </button>
              <button className="btn btn--small btn--ghost" onClick={onNewCode}>
                Neuer Code
              </button>
            </div>
            {pairing?.expiresAt ? (
              <span className="pair-hint">
                Gültig bis {new Date(pairing.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
              </span>
            ) : null}
          </div>

          <ol className="steps-list">
            <li>
              <a className="link" href="/plugin/RobloxAIBuilder.lua" download>
                Plugin herunterladen
              </a>{' '}
              (Datei <code>RobloxAIBuilder.lua</code>)
            </li>
            <li>
              In Studio: Reiter <strong>Plugins</strong> → <strong>Plugins Folder</strong> öffnen und die
              Datei dort ablegen, dann Studio neu starten.
            </li>
            <li>
              In Studio: <strong>Home → Game Settings → Security</strong> →{' '}
              <strong>Allow HTTP Requests</strong> aktivieren.
            </li>
            <li>
              Plugin-Button <strong>Nachbau-Panel</strong> öffnen, Server-Adresse und Kopplungscode
              eingeben, <strong>Verbinden</strong> drücken.
            </li>
          </ol>
        </>
      )}

      <div className="card-foot">
        {isDemo ? (
          <button className="btn btn--ghost btn--small" onClick={onDisconnectDemo}>
            Demo trennen
          </button>
        ) : (
          <button className="btn btn--ghost btn--small" onClick={onConnectDemo}>
            Ohne Studio testen (Demo-Welt)
          </button>
        )}
        <a className="link" href="/plugin/RobloxAIBuilder.lua" download>
          Plugin-Datei
        </a>
      </div>
      <p className="hint hint--tiny">Plugin-Endpunkt: {pluginUrl || '/plugin/RobloxAIBuilder.lua'}</p>
    </section>
  );
}

function WorldCard({ world }) {
  if (!world) {
    return (
      <section className="card">
        <header className="card-head">
          <h2>Erkanntes Spiel</h2>
        </header>
        <p className="muted">
          Noch keine Spielwelt erkannt. Sobald Roblox Studio verbunden ist und eine Welt geöffnet wird,
          erscheint hier die Analyse.
        </p>
      </section>
    );
  }

  const summary = world.summary || {};
  const metrics = summary.metrics || {};
  const bounds = summary.bounds || { size: [0, 0, 0] };

  return (
    <section className="card">
      <header className="card-head">
        <h2>Erkanntes Spiel</h2>
        <span className="pill pill--info">{formatNumber(summary.partCount)} Bauteile</span>
      </header>

      <p className="game-name">{world.place?.gameName || 'Roblox-Spiel'}</p>

      <div className="metric-grid">
        <div className="metric">
          <span className="metric-value">{formatNumber(metrics.clusterCount)}</span>
          <span className="metric-label">Modellgruppen</span>
        </div>
        <div className="metric">
          <span className="metric-value">
            {formatNumber(bounds.size?.[0])} × {formatNumber(bounds.size?.[2])}
          </span>
          <span className="metric-label">Fläche (Studs)</span>
        </div>
        <div className="metric">
          <span className="metric-value">{Number(metrics.averageHeight || 0).toFixed(1)}</span>
          <span className="metric-label">Ø Höhe</span>
        </div>
      </div>

      <h3 className="sub-head">Erkannte Kategorien</h3>
      <ul className="tag-list">
        {(summary.categories || []).map((entry) => (
          <li key={entry.category} className="tag">
            {entry.label}
            <span>{formatNumber(entry.count)}</span>
          </li>
        ))}
      </ul>

      <h3 className="sub-head">Farbpalette</h3>
      <div className="palette">
        {(summary.palette || []).map((entry) => (
          <span
            key={entry.hex}
            className="swatch"
            style={swatchStyle(entry.hex)}
            title={`${entry.hex} · ${Math.round(entry.share * 100)} %`}
          />
        ))}
      </div>

      <h3 className="sub-head">Materialien</h3>
      <ul className="tag-list tag-list--soft">
        {(summary.materials || []).slice(0, 6).map((entry) => (
          <li key={entry.material} className="tag tag--soft">
            {entry.material}
            <span>{formatNumber(entry.count)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgressCard({ job }) {
  if (!job) {
    return (
      <section className="card">
        <header className="card-head">
          <h2>Nachbau-Fortschritt</h2>
        </header>
        <p className="muted">Der Fortschritt erscheint, sobald du „Ja, nachbauen“ bestätigst.</p>
      </section>
    );
  }

  const overall = job.status === 'done' ? 100 : overallProgress(job.steps);

  return (
    <section className="card">
      <header className="card-head">
        <h2>Nachbau-Fortschritt</h2>
        <span className={`pill ${job.status === 'done' ? 'pill--ok' : 'pill--info'}`}>
          {job.status === 'done'
            ? 'Fertig'
            : job.status === 'failed'
              ? 'Fehler'
              : job.status === 'awaiting_studio'
                ? 'Wird in Studio eingefügt'
                : 'Läuft'}
        </span>
      </header>

      <div className="progress progress--lg" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-bar" style={{ width: `${overall}%` }} />
        <span className="progress-value">{overall} %</span>
      </div>

      <ul className="step-list">
        {job.steps.map((step) => (
          <li key={step.key} className={`step step--${step.status}`}>
            <span className="step-icon">{stepIcon(step)}</span>
            <div className="step-body">
              <span className="step-label">{step.label}</span>
              <div className="progress progress--sm">
                <div className="progress-bar" style={{ width: `${step.progress || 0}%` }} />
              </div>
            </div>
            <span className="step-percent">{step.progress || 0} %</span>
          </li>
        ))}
      </ul>

      {job.error ? <p className="alert alert--error">{job.error}</p> : null}
      {job.status === 'awaiting_studio' ? (
        <p className="hint">
          Die Modelle liegen bereit. Das Studio-Plugin holt sie automatisch ab und fügt sie in den
          Workspace ein – der Fortschritt aktualisiert sich live.
        </p>
      ) : null}
    </section>
  );
}

function ResultCard({ job, onRestart, onCopy, copied }) {
  if (!job || job.status !== 'done') return null;
  const result = job.result || {};
  const fidelity = job.fidelity ?? 0;

  return (
    <section className="card card--result">
      <header className="card-head">
        <h2>Nachbau ist fertig</h2>
        <span className="pill pill--ok">{formatNumber(result.inserted)} Teile eingefügt</span>
      </header>

      <div className="fidelity">
        <div className="fidelity-ring" style={{ '--value': `${fidelity}%` }}>
          <span>{fidelity} %</span>
        </div>
        <div>
          <h3 className="sub-head sub-head--tight">Originaltreue</h3>
          <p className="muted">
            {formatNumber(job.stats?.builtParts)} von {formatNumber(job.stats?.sourceParts)} Bauteilen
            übernommen · {formatNumber(job.stats?.modelCount)} eigene Modelle ·{' '}
            {formatNumber(job.stats?.scriptCount)} eigene Skripte
          </p>
        </div>
      </div>

      <h3 className="sub-head">Erstellte Modelle</h3>
      <ul className="model-list">
        {(job.models || []).map((model) => (
          <li key={model.name}>
            <span className="model-name">{model.name}</span>
            <span className="model-meta">
              {model.categoryLabel} · {formatNumber(model.partCount)} Teile
            </span>
          </li>
        ))}
      </ul>

      {job.scripts?.length ? (
        <>
          <h3 className="sub-head">Eigene Skripte</h3>
          <div className="script-list">
            {job.scripts.map((script) => (
              <details key={script.name} className="script">
                <summary>
                  <span>{script.name}</span>
                  <span className="model-meta">Modell: {script.model}</span>
                </summary>
                <pre className="code">{script.source}</pre>
                <button className="btn btn--small btn--ghost" onClick={() => onCopy(script.source, script.name)}>
                  {copied === script.name ? 'Kopiert' : 'Skript kopieren'}
                </button>
              </details>
            ))}
          </div>
        </>
      ) : null}

      {result.errors?.length ? (
        <div className="alert alert--warn">
          <strong>Hinweise aus Studio:</strong>
          <ul>
            {result.errors.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="hint hint--tiny">{job.disclaimer}</p>

      <div className="card-foot">
        <button className="btn btn--primary" onClick={onRestart}>
          Neues Spiel nachbauen
        </button>
      </div>
    </section>
  );
}

function ConfirmDialog({ world, onAccept, onDecline, busy, error }) {
  if (!world) return null;
  const summary = world.summary || {};
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal">
        <span className="modal-badge">Spiel erkannt</span>
        <h2 id="confirm-title">Möchtest du dieses Spiel nachbauen?</h2>
        <p className="modal-game">{world.place?.gameName || 'Roblox-Spiel'}</p>
        <p className="muted">
          {formatNumber(summary.partCount)} Bauteile · {(summary.categories || []).length} Kategorien ·{' '}
          {formatNumber(summary.metrics?.clusterCount)} Modellgruppen
        </p>
        <ul className="tag-list tag-list--center">
          {(summary.categories || []).slice(0, 5).map((entry) => (
            <li key={entry.category} className="tag">
              {entry.label}
            </li>
          ))}
        </ul>
        {error ? <p className="alert alert--error">{error}</p> : null}
        <div className="modal-actions">
          <button className="btn btn--primary btn--xl" onClick={onAccept} disabled={busy}>
            {busy ? 'Starte Nachbau …' : 'Ja, nachbauen'}
          </button>
          <button className="btn btn--ghost btn--xl" onClick={onDecline} disabled={busy}>
            Nein
          </button>
        </div>
        <p className="hint hint--tiny">
          Die KI erstellt eigene Modelle und eigene Skripte – keine fremden Assets oder privaten Skripte.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- App */

export default function App() {
  const [me, setMe] = useState(undefined);
  const [state, setState] = useState(null);
  const [config, setConfig] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(null);
  const [jobError, setJobError] = useState(null);
  const pairingRequested = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/state');
      setState(data);
      setMe(data.user);
    } catch (err) {
      if (err.status === 401) {
        setMe(null);
        setState(null);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api('/api/auth/config');
        if (!cancelled) setConfig(cfg);
      } catch {
        /* Konfiguration ist optional. */
      }

      const params = new URLSearchParams(window.location.search);
      const oauth = params.get('oauth');
      if (oauth === 'ok') setNotice('Roblox-Konto verbunden.');
      if (oauth === 'invalid_state') setError('Roblox-Anmeldung abgebrochen (Sicherheitsprüfung).');
      if (oauth === 'error') {
        setError(`Roblox-Anmeldung fehlgeschlagen: ${params.get('reason') || 'unbekannt'}`);
      }
      if (oauth) window.history.replaceState({}, '', '/');

      try {
        const data = await api('/api/auth/me');
        if (!cancelled) setMe(data.user);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!me) return undefined;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [me, refresh]);

  useEffect(() => {
    if (!state) return;
    if (state.studio?.connected) {
      pairingRequested.current = false;
      if (pairing) setPairing(null);
      return;
    }
    if (pairing && pairing.expiresAt && Date.now() > pairing.expiresAt) {
      setPairing(null);
      pairingRequested.current = false;
      return;
    }
    if (pairing || pairingRequested.current) return;
    pairingRequested.current = true;
    api('/api/pairing', { method: 'POST' })
      .then((data) => setPairing(data))
      .catch(() => {
        pairingRequested.current = false;
      });
  }, [state, pairing]);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ name: '' }) });
      setMe(data.user);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
    setState(null);
    setPairing(null);
  };

  const newPairing = async () => {
    try {
      const data = await api('/api/pairing', { method: 'POST' });
      setPairing(data);
      pairingRequested.current = true;
    } catch (err) {
      setError(err.message);
    }
  };

  const copy = async (text, key = 'code') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Kopieren nicht möglich – bitte den Text manuell markieren.');
    }
  };

  const accept = async () => {
    setBusy(true);
    setJobError(null);
    try {
      await api('/api/jobs', { method: 'POST' });
      await refresh();
    } catch (err) {
      setJobError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await api('/api/jobs/decline', { method: 'POST' });
      await refresh();
    } catch (err) {
      setJobError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const connectDemo = async () => {
    setBusy(true);
    try {
      await api('/api/demo/studio', { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnectDemo = async () => {
    await api('/api/demo/studio', { method: 'DELETE' }).catch(() => {});
    await refresh();
  };

  const restart = async () => {
    setState((prev) => (prev ? { ...prev, world: null, job: null, needsConfirm: false } : prev));
    await refresh();
  };

  if (me === undefined) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p>Roblox AI Builder wird geladen …</p>
      </div>
    );
  }

  if (!me) {
    return <Login onLogin={login} config={config} busy={busy} error={error} />;
  }

  const world = state?.world || null;
  const job = state?.job || null;
  const showConfirm = Boolean(state?.needsConfirm && world);

  return (
    <div className="app">
      <div className="bg-orb bg-orb--blue" />
      <div className="bg-orb bg-orb--violet" />

      <header className="topbar">
        <div className="brand brand--sm">
          <span className="brand-mark">RB</span>
          <div>
            <h1>Roblox AI Builder</h1>
            <p className="brand-sub">KI-Nachbau für Roblox Studio</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className="user-chip">
            <span className="dot dot--ok" />
            {me.name}
          </span>
          <button className="btn btn--ghost btn--small" onClick={logout}>
            Abmelden
          </button>
        </div>
      </header>

      {notice ? (
        <p className="alert alert--ok" onClick={() => setNotice(null)}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="alert alert--error" onClick={() => setError(null)}>
          {error}
        </p>
      ) : null}

      <main className="grid">
        <div className="col">
          <StudioCard
            studio={state?.studio}
            pairing={pairing}
            pluginUrl={pairing?.pluginUrl}
            onNewCode={newPairing}
            onConnectDemo={connectDemo}
            onDisconnectDemo={disconnectDemo}
            onCopy={copy}
            copied={copied}
          />
          <WorldCard world={world} />
        </div>

        <div className="col">
          <ProgressCard job={job} />
          <ResultCard
            job={job}
            onRestart={restart}
            onCopy={copy}
            copied={copied}
          />
          {!job ? (
            <section className="card card--soft">
              <h2>So funktioniert es</h2>
              <ol className="steps-list steps-list--numbered">
                <li>Roblox Studio öffnen und dein Spiel starten.</li>
                <li>Plugin verbinden – die App erkennt das geöffnete Spiel automatisch.</li>
                <li>„Ja, nachbauen“ bestätigen und den Fortschritt verfolgen.</li>
                <li>Modelle in Studio bearbeiten, testen und speichern.</li>
              </ol>
            </section>
          ) : null}
        </div>
      </main>

      <footer className="footer">
        <span>Roblox AI Builder · eigene Modelle, eigene Skripte</span>
        <span className="muted">
          Keine Übernahme fremder geschützter Inhalte – der Nachbau entsteht aus Geometrie- und
          Farbdaten deiner eigenen Szene.
        </span>
      </footer>

      {showConfirm ? (
        <ConfirmDialog world={world} onAccept={accept} onDecline={decline} busy={busy} error={jobError} />
      ) : null}
    </div>
  );
}
