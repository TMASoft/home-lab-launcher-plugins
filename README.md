# Home Lab Launcher Plugin Catalog

This repository is the official plugin catalog for [Home Lab Launcher](https://github.com/TMASoft/home-lab-launcher), plus reference documentation for plugin authors.

Official plugins live in standalone repositories and are indexed by [`catalog.json`](catalog.json):

| Plugin | Repository |
| --- | --- |
| HLL Weather | <https://github.com/TMASoft/hll-weather> |
| Uptime Kuma | <https://github.com/TMASoft/hll-uptime-kuma> |
| Miniflux RSS | <https://github.com/TMASoft/hll-miniflux> |
| Proxmox VE | <https://github.com/TMASoft/hll-proxmox> |
| SearXNG Search | <https://github.com/TMASoft/hll-searxng> |
| MeshKeep | <https://github.com/TMASoft/hll-meshkeep> |

## Plugin Catalog (`catalog.json`)

The launcher's Admin -> Plugins catalog view fetches `catalog.json` from this repository's default branch. The file is static JSON:

```json
{
  "format": "home-lab-launcher-plugin-catalog-v1",
  "updatedAt": "2026-07-06",
  "plugins": [
    {
      "id": "hll-weather",
      "name": "HLL Weather",
      "description": "Weather forecast dashboard section powered by Open-Meteo.",
      "repo": "https://github.com/TMASoft/hll-weather",
      "homepage": "https://github.com/TMASoft/hll-weather#readme",
      "trust": "official",
      "launcherApiVersion": 1,
      "latestVersion": "v0.3.0",
      "permissions": ["routes", "storage", "jobs", "dashboard-section"],
      "tags": ["weather", "dashboard"]
    }
  ]
}
```

Catalog entry fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Must equal the plugin manifest `id` so the launcher can match installed plugins to catalog entries. |
| `name` | Yes | Display name shown in the catalog. |
| `description` | Yes | Short description shown in the catalog. |
| `repo` | Yes | GitHub repository URL, or `owner/repo`. Installs use the launcher's normal pinned GitHub install path. |
| `homepage` | Optional | Documentation link. |
| `trust` | Optional | `official` or `community`. Default `community`. This is curation metadata, not sandboxing; plugins are trusted server-side code. |
| `launcherApiVersion` | Optional | Launcher plugin API version the plugin targets. Default `1`. |
| `latestVersion` | Optional | Latest published release/tag, used as an update hint. The launcher still discovers and pins real versions from GitHub at install time. |
| `permissions` | Optional | Declared capability tokens, mirrored from the plugin manifest so operators can compare before installing. |
| `tags` | Optional | Search keywords. |
| `sha256` | Optional | Map of version -> expected SHA-256 of the GitHub tarball. GitHub does not guarantee stable archive bytes over time, so hashes are optional and installs surface mismatches rather than silently proceeding. |

Catalog installs never bypass the launcher's trust acknowledgement, version pinning, or archive safety checks.

## Repository Layout

This catalog repository intentionally does not contain plugin source directories. Keep plugin code in standalone repositories such as `hll-weather`, `hll-uptime-kuma`, or `hll-miniflux`, then add or update entries in `catalog.json`.

```text
home-lab-launcher-plugins/
├── catalog.json
├── README.md
└── .gitignore
```

## Plugin Repository Structure

A standalone plugin repository should contain a plugin root with this shape:

```text
hll-my-plugin/
├── plugin.json       # Required manifest detailing plugin metadata and configuration
├── server/
│   └── index.js      # Optional backend CommonJS module defining routes, jobs, and database tables
├── public/
│   ├── plugin.js     # Optional frontend dashboard section script
│   └── styles.css    # Optional plugin-local styles
└── README.md         # Plugin-specific installation and usage docs
```

## Manifest Schema (`plugin.json`)

Every installable plugin must contain a `plugin.json` manifest at its root:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "launcherApiVersion": "1",
  "backend": "server/index.js",
  "frontend": "public/plugin.js",
  "permissions": ["routes", "storage", "jobs", "dashboard-section"],
  "configSchema": {
    "sectionTitle": {
      "type": "string",
      "default": "My Plugin",
      "scope": "editor",
      "description": "Dashboard section title."
    },
    "url": {
      "type": "string",
      "default": "",
      "scope": "admin",
      "description": "Base URL of the upstream service."
    }
  }
}
```

Manifest fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable, unique identifier containing only alphanumeric characters and hyphens. |
| `name` | Yes | User-friendly display name shown in the Admin console. |
| `version` | Yes | Current version of the plugin, for example `0.1.0`. |
| `launcherApiVersion` | Yes | Target launcher plugin API version. Current value is `1`. |
| `backend` | Optional | Path to the CommonJS entrypoint script relative to the plugin root. |
| `frontend` | Optional | Path to the browser-compatible entrypoint script relative to the plugin root. |
| `permissions` | Optional | Capability tokens requested by the plugin. |
| `configSchema` | Optional | Key-value settings schema rendered by the launcher Admin console. |

Configuration scopes:

| Scope | Access | Use For |
| --- | --- | --- |
| `admin` | Admin read/write only | Credentials, private endpoints, server authority, destructive behavior. |
| `editor` | Admin and Editor read/write | Operational display or refresh settings safe for editors. |
| `user` | User-preference-safe | Display preferences intended for per-user preference flows. |

## Backend Entrypoint

If a plugin has server-side logic, its backend module must export `register(context)`:

```javascript
exports.register = async function register(context) {
  context.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_my_plugin_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const router = context.createRouter();
  router.get('/data', (req, res) => {
    const data = context.db.prepare('SELECT * FROM plugin_my_plugin_cache').all();
    res.json({ data });
  });

  context.mountRouter(router);

  context.registerDashboardSection({
    id: 'my-plugin',
    title: 'My Plugin',
    script: context.publicScriptUrl
  });
};
```

Useful backend context APIs:

| API | Description |
| --- | --- |
| `context.db` | Shared `better-sqlite3` database connection. Prefix plugin-owned tables with `plugin_<pluginId>_`. |
| `context.guardedFetch(url, options, guard)` | SSRF-guarded server-side fetch for configured or user-provided URLs. Prefer this over raw `context.fetch`. |
| `context.fetch(url, options)` | Raw fetch function for trusted fixed URLs. |
| `context.createRouter()` | Creates an Express router. |
| `context.json()` | Express JSON body parser middleware for plugin routes that read request bodies. |
| `context.mountRouter(router)` | Mounts routes under `/api/plugins/:pluginId`. |
| `context.getConfig()` | Reads current plugin configuration. |
| `context.requireRole(...roles)` | Express middleware for signed-in role checks on mutating routes. |
| `context.setInterval(fn, ms, name)` | Registers an in-process scheduled job. |
| `context.log(level, action, details)` | Writes plugin-scoped audit logs. |

## Frontend Dashboard Section

Frontend scripts register dashboard sections through `window.HomeLabLauncher.registerPluginSection`:

```javascript
window.HomeLabLauncher.registerPluginSection({
  id: 'my-plugin',
  title: 'My Plugin',
  render: async ({ container, api, user, preferences = {}, setPluginPreference }) => {
    container.innerHTML = '<p>Loading...</p>';
    const response = await api('/api/plugins/my-plugin/data');
    container.innerHTML = `<div>Found ${response.data.length} records.</div>`;
  }
});
```

Use plugin preferences for display-only choices such as density, theme, hidden panels, and local filters.

## Local Development

To test a standalone plugin locally:

1. Set `ENABLE_LOCAL_PLUGIN_INSTALL=true` in the launcher's environment.
2. Open Home Lab Launcher Admin -> Plugins.
3. Under Local development plugin, enter the absolute path to the standalone plugin repository:

```text
/mnt/storage/code/hll-my-plugin
```

4. Click Install local plugin. The launcher mounts the directory, registers backend/frontend assets, and runs the plugin backend entrypoint when enabled.

## Updating The Catalog

1. Publish or tag the plugin in its standalone repository.
2. Update the matching `catalog.json` entry, including `latestVersion` when appropriate.
3. Keep descriptions concise and operator-focused.
4. Validate `catalog.json` before committing.
