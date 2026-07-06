# Home Lab Launcher Plugins

This repository is the **plugin catalog** for [Home Lab Launcher](https://github.com/TMASoft/home-lab-launcher), plus documentation for plugin authors.

Plugins extend Home Lab Launcher by adding optional dashboard sections, backend API routes, scheduled background jobs, and persistent SQLite database storage.

Official plugins live in their own repositories and are indexed by [`catalog.json`](catalog.json):

| Plugin | Repository |
| --- | --- |
| HLL Weather | <https://github.com/TMASoft/hll-weather> |
| Uptime Kuma | <https://github.com/TMASoft/hll-uptime-kuma> |
| Miniflux RSS | <https://github.com/TMASoft/hll-miniflux> |

> The `miniflux/` and `uptime-kuma/` directories in this repository are the historical in-tree copies from before those plugins moved to their own repositories. Install from the standalone repositories (or the launcher's catalog UI) instead.

---

## 0. Plugin Catalog (`catalog.json`)

The launcher's Admin → Plugins catalog view fetches `catalog.json` from this repository's default branch. The file is static JSON:

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
      "tags": ["weather", "dashboard"],
      "sha256": { "v0.3.0": "<64-hex sha-256 of the release tarball, optional>" }
    }
  ]
}
```

### Catalog entry fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Must equal the plugin's manifest `id` so the launcher can match installed plugins to catalog entries. |
| `name` | Yes | Display name shown in the catalog. |
| `description` | Yes | Short description shown in the catalog. |
| `repo` | Yes | GitHub repository URL (or `owner/repo`). Installs go through the launcher's normal pinned GitHub install path. |
| `homepage` | Optional | Documentation link. |
| `trust` | Optional | `official` or `community`. Default `community`. This is curation metadata, not sandboxing — plugins are always trusted server-side code. |
| `launcherApiVersion` | Optional | Launcher plugin API version the plugin targets. Default `1`. |
| `latestVersion` | Optional | Latest published release/tag, used as an update hint. The launcher always discovers and pins real versions from GitHub at install time. |
| `permissions` | Optional | Declared capability tokens, mirrored from the plugin manifest so operators can compare before installing. |
| `tags` | Optional | Search keywords. |
| `sha256` | Optional | Map of version → expected SHA-256 of the GitHub tarball. Note GitHub does not guarantee stable archive bytes over time, so hashes are optional and installs surface mismatches rather than silently proceeding. |

Catalog installs never bypass the launcher's trust acknowledgement, version pinning, or archive safety checks.

---

## 1. Plugin Taxonomy & Directory Structure

Plugins are organized as independent subdirectories at the root of this repository. Each plugin must conform to a specific file structure to be correctly parsed and loaded by the launcher.

A typical plugin directory structure is shown below:

```text
home-lab-launcher-plugins/
├── <plugin-id>/
│   ├── plugin.json       # Required manifest detailing plugin metadata and configuration
│   ├── server/
│   │   └── index.js      # Backend CommonJS module defining route handlers and database tables
│   ├── public/
│   │   ├── plugin.js     # Frontend script providing the dashboard section view
│   │   └── styles.css    # Custom styles loaded dynamically by the frontend script
│   └── README.md         # Documentation specific to the plugin installation and usage
```

---

## 2. Manifest Schema (`plugin.json`)

Every plugin must contain a `plugin.json` manifest at its root. This manifest defines how the launcher registers and exposes the plugin.

```json
{
  "id": "uptime-kuma",
  "name": "Uptime Kuma",
  "version": "0.1.0",
  "launcherApiVersion": "1",
  "backend": "server/index.js",
  "frontend": "public/plugin.js",
  "permissions": ["routes", "storage", "jobs", "dashboard-section"],
  "configSchema": {
    "sectionTitle": { 
      "type": "string", 
      "default": "Uptime Status", 
      "scope": "editor", 
      "description": "Dashboard section title." 
    },
    "url": { 
      "type": "string", 
      "default": "", 
      "scope": "admin", 
      "description": "Base URL of your Uptime Kuma instance." 
    }
  }
}
```

### Manifest Fields Description

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable, unique identifier containing only alphanumeric characters and hyphens. |
| `name` | Yes | User-friendly display name of the plugin shown in the Admin console. |
| `version` | Yes | Current version of the plugin (e.g. `1.0.0`). |
| `launcherApiVersion` | Yes | Target API version of the launcher. Currently `1`. |
| `backend` | Optional | Path to the CommonJS entrypoint script relative to the plugin root. |
| `frontend` | Optional | Path to the browser-compatible entrypoint script relative to the plugin root. |
| `permissions` | Optional | Array of permission tokens representing the features requested by the plugin. |
| `configSchema` | Optional | Key-value settings schema rendered dynamically on the Admin console. |

### Configuration Scopes

Fields within the `configSchema` define a `scope` property to restrict access:
- `admin` (default): Read/write restricted to system Admins. Use for credentials, private endpoints, or server settings.
- `editor`: Read/write allowed for both Editors and Admins.
- `user`: User-preference-safe settings (intended for future per-user preferences).

---

## 3. How to Make a Plugin

### Step 3.1: Initialize the Manifest
Create a new directory (e.g., `my-plugin/`) at the repository root and add `plugin.json` using the schema described above.

### Step 3.2: Implement the Backend Entrypoint
If your plugin has server-side logic, create the backend script (e.g., `server/index.js`). The script must export a `register(context)` function:

```javascript
exports.register = async function register(context) {
  // Initialize Database Tables (using the prefix rule)
  context.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_myplugin_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Define Custom Express Routes
  const router = context.createRouter();
  router.get('/data', (req, res) => {
    const data = context.db.prepare('SELECT * FROM plugin_myplugin_cache').all();
    res.json({ ok: true, data });
  });
  
  context.mountRouter(router); // Accessible at /api/plugins/my-plugin/data

  // Register Dashboard View
  context.registerDashboardSection({
    id: 'my-plugin',
    title: 'My Custom Section',
    script: context.publicScriptUrl
  });
};
```

#### The `context` API Reference
The backend `context` object provides secure access to launcher utilities:
* `context.db`: Direct `better-sqlite3` database instance sharing the main launcher database.
* `context.fetch(url, options)`: Same-origin/external request runner (unrestricted by private network blocking).
* `context.XMLParser`: An instance of `fast-xml-parser` for feed parsing.
* `context.createRouter()`: Generates a scoped Express Router.
* `context.mountRouter(router)`: Mounts your router under `/api/plugins/:pluginId`.
* `context.getConfig()`: Retrieves current plugin settings parsed according to the manifest schema.
* `context.setInterval(fn, ms, name)`: Registers an in-process scheduled background job.
* `context.log(level, action, details)`: Writes logs to the launcher audit trail.

### Step 3.3: Implement the Frontend Dashboard Section
For plugins that render a dashboard widget, create a browser-compatible script (e.g., `public/plugin.js`). Register the plugin section via the global API:

```javascript
window.HomeLabLauncher.registerPluginSection({
  id: 'my-plugin',
  title: 'My Custom View',
  render: async ({ container, api, user }) => {
    container.innerHTML = '<p>Loading...</p>';
    try {
      const response = await api('/api/plugins/my-plugin/data');
      container.innerHTML = `<div>Found ${response.data.length} records.</div>`;
    } catch (err) {
      container.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
    }
  }
});
```

---

## 4. Local Development and Installation

To test and develop plugins locally:

1. Enable local installations in your launcher’s environment config (`.env`):
   ```ini
   ENABLE_LOCAL_PLUGIN_INSTALL=true
   ```
2. Navigate to **Admin → Plugins** in the Home Lab Launcher UI.
3. Under **Local development plugin**, enter the absolute path to your plugin subdirectory:
   ```text
   /mnt/storage/code/home-lab-launcher-plugins/uptime-kuma
   ```
4. Click **Install local plugin**. The server will mount the directory, register custom database tables, and make backend/frontend assets immediately available.
