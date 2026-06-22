const http = require('http');
const https = require('https');

function pluginConfig(context) {
  const cfg = context.getConfig();
  return {
    sectionTitle: cfg.sectionTitle || 'Miniflux RSS',
    url: String(cfg.url || '').trim(),
    apiToken: String(cfg.apiToken || '').trim(),
    ignoreTlsErrors: Boolean(cfg.ignoreTlsErrors),
    limit: Math.min(20, Math.max(1, Number(cfg.limit || 5))),
    refreshMinutes: Math.max(1, Number(cfg.refreshMinutes || 15)),
    uiAutoRefresh: cfg.uiAutoRefresh !== undefined ? Boolean(cfg.uiAutoRefresh) : false,
    uiAutoRefreshInterval: Math.max(10, Number(cfg.uiAutoRefreshInterval || 60)),
    showCategories: Boolean(cfg.showCategories)
  };
}

function minifluxRequest(context, path, method = 'GET', body = null) {
  const cfg = pluginConfig(context);
  if (!cfg.url) {
    throw new Error('Miniflux URL is not configured');
  }
  if (!cfg.apiToken) {
    throw new Error('Miniflux API Token is not configured');
  }

  const baseUrl = cfg.url.replace(/\/+$/, '');
  const url = `${baseUrl}${path}`;
  const headers = {
    'User-Agent': 'home-lab-launcher-plugin',
    'X-Auth-Token': cfg.apiToken
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  // If ignoreTlsErrors is false, use context.fetch
  if (!cfg.ignoreTlsErrors) {
    return context.fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Miniflux API returned HTTP ${res.status}`);
      }
      if (res.status === 204) {
        return null;
      }
      return res.json();
    });
  }

  // If ignoreTlsErrors is true, use native http/https modules
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const options = {
      method,
      headers,
      rejectUnauthorized: false,
      timeout: 15000
    };

    const req = client.request(parsed, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Miniflux API returned HTTP ${res.statusCode}`));
        }
        if (res.statusCode === 204) {
          return resolve(null);
        }
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(bodyStr || '{}'));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function refreshMiniflux(context) {
  const cfg = pluginConfig(context);
  if (!cfg.url || !cfg.apiToken) {
    return { count: 0, reason: 'Not configured' };
  }

  try {
    const response = await minifluxRequest(context, `/v1/entries?status=unread&limit=${cfg.limit}&order=published_at&direction=desc`);
    
    const total = response.total || 0;
    const entries = (response.entries || []).map(entry => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      publishedAt: entry.published_at,
      feedTitle: entry.feed ? entry.feed.title : 'Unknown Feed',
      feedUrl: entry.feed ? entry.feed.site_url : '',
      categoryTitle: entry.feed?.category?.title || entry.category?.title || 'Uncategorized'
    }));

    const dataToCache = {
      total,
      entries
    };

    context.db.prepare(`
      INSERT INTO plugin_miniflux_cache (key, value, updated_at, last_error)
      VALUES ('unread', ?, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP, last_error=NULL
    `).run(JSON.stringify(dataToCache));

    return { total, count: entries.length };
  } catch (error) {
    context.log?.('warn', 'miniflux_refresh_failed', { error: error.message });

    const existing = context.db.prepare("SELECT value FROM plugin_miniflux_cache WHERE key='unread'").get();
    const fallbackValue = existing ? existing.value : '{"total":0,"entries":[]}';

    context.db.prepare(`
      INSERT INTO plugin_miniflux_cache (key, value, updated_at, last_error)
      VALUES ('unread', ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET updated_at=CURRENT_TIMESTAMP, last_error=excluded.last_error
    `).run(fallbackValue, error.message);

    throw error;
  }
}

exports.register = async function register(context) {
  context.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_miniflux_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT
    );
  `);

  const router = context.createRouter();

  router.get('/entries', async (req, res) => {
    const cfg = pluginConfig(context);
    let row = context.db.prepare("SELECT value, updated_at AS updatedAt, last_error AS lastError FROM plugin_miniflux_cache WHERE key='unread'").get();
    let cache = row ? parseCachedData(row.value) : { total: 0, entries: [] };

    if (cfg.url && cfg.apiToken && !row) {
      try {
        await refreshMiniflux(context);
        row = context.db.prepare("SELECT value, updated_at AS updatedAt, last_error AS lastError FROM plugin_miniflux_cache WHERE key='unread'").get();
        cache = row ? parseCachedData(row.value) : { total: 0, entries: [] };
      } catch (err) {
        // Ignored, we'll return lastError in the response
      }
    }

    res.json({
      title: cfg.sectionTitle,
      configured: !!(cfg.url && cfg.apiToken),
      url: cfg.url,
      total: cache.total,
      entries: cache.entries,
      lastUpdated: row ? row.updatedAt : null,
      lastError: row ? row.lastError : null,
      uiAutoRefresh: cfg.uiAutoRefresh,
      uiAutoRefreshInterval: cfg.uiAutoRefreshInterval,
      showCategories: cfg.showCategories
    });
  });

  router.post('/refresh', requireUser, async (req, res) => {
    try {
      const result = await refreshMiniflux(context);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  router.post('/read', requireUser, async (req, res) => {
    const { id } = req.body;
    const entryId = Number(id);
    if (!Number.isSafeInteger(entryId) || entryId <= 0) {
      return res.status(400).json({ error: 'Entry ID is required' });
    }

    try {
      await minifluxRequest(context, `/v1/entries/${entryId}`, 'PUT', {
        status: 'read'
      });

      removeCachedEntries(context, [entryId]);
      refreshMiniflux(context).catch((error) => {
        context.log?.('warn', 'miniflux_refresh_after_read_failed', { error: error.message });
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  router.post('/read-all', requireUser, async (req, res) => {
    try {
      await minifluxRequest(context, '/v1/mark_all_as_read', 'PUT');
      replaceCachedData(context, { total: 0, entries: [] });
      refreshMiniflux(context).catch((error) => {
        context.log?.('warn', 'miniflux_refresh_after_read_all_failed', { error: error.message });
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  context.mountRouter(router);

  context.registerDashboardSection({
    id: 'miniflux',
    title: pluginConfig(context).sectionTitle,
    script: context.publicScriptUrl
  });

  refreshMiniflux(context).catch((error) => {
    context.log?.('warn', 'miniflux_initial_refresh_failed', { error: error.message });
  });

  context.setInterval(
    () => refreshMiniflux(context).catch(() => {}),
    pluginConfig(context).refreshMinutes * 60 * 1000,
    'refresh miniflux'
  );
};

function requireUser(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function parseCachedData(value) {
  try {
    const data = JSON.parse(value || '{"total":0,"entries":[]}');
    return {
      total: Number(data.total || 0),
      entries: Array.isArray(data.entries) ? data.entries : []
    };
  } catch {
    return { total: 0, entries: [] };
  }
}

function removeCachedEntries(context, ids) {
  const row = context.db.prepare("SELECT value FROM plugin_miniflux_cache WHERE key='unread'").get();
  if (!row) return;

  const idSet = new Set(ids.map(Number));
  const cache = parseCachedData(row.value);
  const entries = cache.entries.filter((entry) => !idSet.has(Number(entry.id)));
  const removed = cache.entries.length - entries.length;
  replaceCachedData(context, {
    total: Math.max(0, cache.total - removed),
    entries
  });
}

function replaceCachedData(context, data) {
  context.db.prepare(`
    INSERT INTO plugin_miniflux_cache (key, value, updated_at, last_error)
    VALUES ('unread', ?, CURRENT_TIMESTAMP, NULL)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP, last_error=NULL
  `).run(JSON.stringify(data));
}
