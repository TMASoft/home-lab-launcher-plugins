# Uptime Kuma Integration Plugin

Uptime Kuma plugin for Home Lab Launcher. It retrieves monitor statuses and heartbeat history from an Uptime Kuma status page and displays them natively on your launcher dashboard.

## Features

- **Public Group Mapping**: Discovers public groups and their associated monitors from status pages.
- **Visual Sparklines**: Renders the last 24 heartbeat states (Up, Down, Unknown) as colored indicators.
- **Response Metrics**: Displays response time (ping) for active monitors.
- **Pulsing Animation Badges**: Highlights active status with color-coded pulsing badges (green for up, red for down).
- **Persistent Database Cache**: Persists monitor data inside the launcher SQLite database to provide instant loads and fallback values during network timeouts.
- **Dynamic Config Scoping**: Fully supports the 0.3.3 permission model, allowing Editors to configure integration parameters.

## Configuration Schema

- `sectionTitle`: Title of the dashboard section (default: `Uptime Status`).
- `url`: Base URL of your Uptime Kuma instance (e.g. `http://uptime-kuma:3001` or `https://status.my-domain.com`). Admin-only because it controls server-side fetch targets.
- `slug`: The slug of the status page you wish to fetch monitors from (default: `default`).
- `ignoreTlsErrors`: Allow this plugin to connect when the Uptime Kuma TLS certificate cannot be validated. This is Admin-only and should be used only when you cannot mount or trust the issuing CA certificate.
- `refreshMinutes`: Interval in minutes to automatically fetch new metrics in the background (default: `2`, minimum `1`).
- `uiAutoRefresh`: Enable automatic refresh of the status page widget in the browser (default: `false`).
- `uiAutoRefreshInterval`: Interval in seconds to automatically refresh the browser UI status card (default: `60`, minimum `10`).

## Development Installation

Start the launcher in development mode, and install using this local path via **Admin → Plugins**:

```text
/mnt/storage/code/home-lab-launcher-plugins/uptime-kuma
```

*Note: For production environments, local-path installation requires `ENABLE_LOCAL_PLUGIN_INSTALL=true`.*
