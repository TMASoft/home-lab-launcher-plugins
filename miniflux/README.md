# Miniflux Integration Plugin

Miniflux plugin for Home Lab Launcher. It retrieves unread articles from your Miniflux RSS reader and displays them natively on your launcher dashboard with compact rows, relative publication times, source feed labels, optional category grouping, and interactive mark-as-read options.

## Features

- **Unread Articles Feed**: Lists your most recent unread RSS articles.
- **Compact Reading Layout**: Shows source, publish time, and article title on a single dense row to fit more stories on screen.
- **Optional Categories**: Group unread articles by Miniflux category with expandable sections. Users can toggle categories from the plugin header and keep their own saved preference.
- **Interactive Actions**: Mark individual entries as read directly from the dashboard card, or mark all unread entries as read at once.
- **Smooth Animations**: Includes subtle hover states and fade-out animations for marked-as-read items.
- **Performance Caching**: Persists feed data inside the launcher SQLite database to provide instant dashboard loads and fallback values during network timeouts.
- **Dynamic Config Scoping**: Integrates with the permissions/config model, allowing Admins to set endpoints/tokens securely and Editors to tune titles and limits.

## Configuration Schema

- `sectionTitle`: Title of the dashboard section (default: `Miniflux RSS`).
- `url`: Base URL of your Miniflux instance (e.g. `http://miniflux:8080` or `https://reader.my-domain.com`). Admin-only.
- `apiToken`: Your Miniflux API Key, created in Settings > API Keys. Admin-only.
- `ignoreTlsErrors`: Bypass TLS certificate validation for internal/self-signed certificates. Admin-only.
- `limit`: Maximum number of unread articles to display at once (default: `5`, range `1-20`).
- `refreshMinutes`: Interval in minutes to automatically fetch new articles in the background (default: `15`, minimum `1`).
- `uiAutoRefresh`: Enable automatic refresh of the RSS feed widget in the browser (default: `false`).
- `uiAutoRefreshInterval`: Interval in seconds to automatically refresh the browser UI status card (default: `60`, minimum `10`).
- `showCategories`: Default category grouping preference shown in Admin -> Plugins. Individual users can override it from the plugin header.

## User Preferences

The **Categories** button in the plugin header toggles between a flat compact list and expandable category groups. Home Lab Launcher saves this as a per-user plugin preference for signed-in users, and as browser-local plugin preference data for anonymous public-read viewers.

## Mark-as-read Behavior

The check mark updates the selected Miniflux entry through the Miniflux entry status endpoint, removes it from the local unread cache immediately, and refreshes unread data in the background. If the background refresh fails after Miniflux accepts the read status, the action still succeeds in the launcher UI.

## Development Installation

Start the launcher in development mode, and install using this local path via **Admin → Plugins**:

```text
/mnt/storage/code/home-lab-launcher-plugins/miniflux
```

*Note: For production environments, local-path installation requires `ENABLE_LOCAL_PLUGIN_INSTALL=true`.*
