const http = require('http');
const https = require('https');

function pluginConfig(context) {
  const cfg = context.getConfig();
  return {
    sectionTitle: cfg.sectionTitle || 'Uptime Status',
    url: String(cfg.url || '').trim(),
    slug: String(cfg.slug || 'default').trim(),
    ignoreTlsErrors: Boolean(cfg.ignoreTlsErrors),
    refreshMinutes: Math.max(1, Number(cfg.refreshMinutes || 2))
  };
}

async function refreshUptimeKuma(context) {
  const cfg = pluginConfig(context);
  if (!cfg.url) {
    return { count: 0, reason: 'URL not configured' };
  }
  const baseUrl = cfg.url.replace(/\/+$/, '');
  const slug = encodeURIComponent(cfg.slug || 'default');

  try {
    const configData = await fetchJson(context, `${baseUrl}/api/status-page/${slug}`, cfg.ignoreTlsErrors, 'Status page config fetch failed');

    const heartbeatData = await fetchJson(context, `${baseUrl}/api/status-page/heartbeat/${slug}`, cfg.ignoreTlsErrors, 'Heartbeats fetch failed');

    const heartbeats = heartbeatData.heartbeatList || {};
    const monitors = [];

    const groups = configData.publicGroupList || [];
    for (const group of groups) {
      const monitorList = group.monitorList || [];
      for (const m of monitorList) {
        if (!m || !m.id) continue;
        const mHeartbeats = heartbeats[m.id] || [];
        const latestHb = mHeartbeats[mHeartbeats.length - 1] || null;
        
        const history = mHeartbeats.slice(-24).map(h => ({
          status: h.status,
          ping: h.ping,
          time: h.time
        }));

        monitors.push({
          id: m.id,
          name: m.name || `Monitor #${m.id}`,
          active: m.active !== false,
          status: latestHb ? latestHb.status : -1,
          ping: latestHb ? latestHb.ping : null,
          msg: latestHb ? latestHb.msg : '',
          history
        });
      }
    }

    context.db.prepare(`
      INSERT INTO plugin_uptime_kuma_cache (key, value, updated_at, last_error)
      VALUES ('monitors', ?, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP, last_error=NULL
    `).run(JSON.stringify(monitors));

    return { count: monitors.length };
  } catch (error) {
    context.log?.('warn', 'refresh_failed', { error: error.message });
    
    // Update cache row but keep the last successful value if present
    const existing = context.db.prepare("SELECT value FROM plugin_uptime_kuma_cache WHERE key='monitors'").get();
    const fallbackValue = existing ? existing.value : '[]';
    
    context.db.prepare(`
      INSERT INTO plugin_uptime_kuma_cache (key, value, updated_at, last_error)
      VALUES ('monitors', ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET updated_at=CURRENT_TIMESTAMP, last_error=excluded.last_error
    `).run(fallbackValue, error.message);
    
    throw error;
  }
}

exports.register = async function register(context) {
  context.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_uptime_kuma_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT
    );
  `);

  const router = context.createRouter();

  router.get('/monitors', async (req, res) => {
    const cfg = pluginConfig(context);
    let row = context.db.prepare("SELECT value, updated_at AS updatedAt, last_error AS lastError FROM plugin_uptime_kuma_cache WHERE key='monitors'").get();
    const cachedMonitors = row ? parseCachedMonitors(row.value) : [];

    if (cfg.url && (!row || (row.lastError && cachedMonitors.length === 0))) {
      try {
        await refreshUptimeKuma(context);
      } catch {
        // refreshUptimeKuma stores last_error for the frontend response.
      }
      row = context.db.prepare("SELECT value, updated_at AS updatedAt, last_error AS lastError FROM plugin_uptime_kuma_cache WHERE key='monitors'").get();
    }
    
    res.json({
      title: cfg.sectionTitle,
      configured: !!cfg.url,
      slug: cfg.slug,
      monitors: row ? parseCachedMonitors(row.value) : [],
      lastUpdated: row ? row.updatedAt : null,
      lastError: row ? row.lastError : null
    });
  });

  router.post('/refresh', requireEditor, async (req, res) => {
    try {
      const result = await refreshUptimeKuma(context);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  context.mountRouter(router);

  context.registerDashboardSection({
    id: 'uptime-kuma',
    title: pluginConfig(context).sectionTitle,
    script: context.publicScriptUrl
  });

  // Run initial refresh and schedule next jobs
  refreshUptimeKuma(context).catch((error) => {
    context.log?.('warn', 'initial_refresh_failed', { error: error.message });
  });

  context.setInterval(
    () => refreshUptimeKuma(context).catch(() => {}),
    pluginConfig(context).refreshMinutes * 60 * 1000,
    'refresh uptime kuma'
  );
};

function requireEditor(req, res, next) {
  if (!['admin', 'editor'].includes(req.session?.user?.role)) {
    return res.status(403).json({ error: 'Editor access required' });
  }
  next();
}

function parseCachedMonitors(value) {
  try {
    const monitors = JSON.parse(value || '[]');
    return Array.isArray(monitors) ? monitors : [];
  } catch {
    return [];
  }
}

async function fetchJson(context, url, ignoreTlsErrors, errorPrefix) {
  if (!ignoreTlsErrors) {
    const response = await context.fetch(url, { headers: { 'User-Agent': 'home-lab-launcher-plugin' } });
    if (!response.ok) throw new Error(`${errorPrefix}: HTTP ${response.status}`);
    return response.json();
  }

  return requestJson(url, { rejectUnauthorized: false });
}

function requestJson(url, { rejectUnauthorized = true } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, {
      method: 'GET',
      headers: { 'User-Agent': 'home-lab-launcher-plugin', Accept: 'application/json' },
      rejectUnauthorized,
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(new Error(`Invalid JSON response: ${error.message}`)); }
      });
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}
