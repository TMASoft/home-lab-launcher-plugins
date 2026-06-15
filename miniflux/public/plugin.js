if (!document.querySelector('link[data-plugin-style="miniflux"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/plugins/miniflux/styles.css';
  link.dataset.pluginStyle = 'miniflux';
  document.head.appendChild(link);
}

window.HomeLabLauncher.registerPluginSection({
  id: 'miniflux',
  title: 'Miniflux RSS',
  render: async ({ container, api, user }) => {
    container.innerHTML = '<div class="miniflux-loading"><span class="miniflux-spinner"></span>Loading unread articles…</div>';
    const canEdit = ['admin', 'editor'].includes(user?.role);
    const isLoggedIn = !!user;
    let autoRefreshTimer = null;
    let lastConfig = null;

    async function render() {
      try {
        const data = await api('/api/plugins/miniflux/entries');
        if (data) {
          lastConfig = {
            uiAutoRefresh: data.uiAutoRefresh,
            uiAutoRefreshInterval: data.uiAutoRefreshInterval
          };
        }

        if (!data.configured) {
          container.innerHTML = `
            <div class="miniflux-empty">
              <h3>Miniflux Integration</h3>
              <p>The Miniflux plugin is installed but has not been configured yet.</p>
              ${canEdit ? '<p class="admin-only-tip">Go to <strong>Admin → Plugins</strong> to configure the Miniflux URL and API Token.</p>' : ''}
            </div>
          `;
          setupAutoRefresh();
          return;
        }

        const entries = data.entries || [];
        const total = data.total || 0;

        if (total === 0) {
          const hasError = Boolean(data.lastError);
          container.innerHTML = `
            <div class="miniflux-empty">
              <h3>${hasError ? 'Miniflux sync error' : 'All caught up! 🎉'}</h3>
              <p>${hasError
                ? `Could not refresh RSS entries: <code>${escapeHtml(data.lastError)}</code>`
                : 'No unread articles in your feed reader.'}</p>
              <div class="miniflux-actions">
                ${data.url ? `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer" class="button primary">Go to Miniflux</a>` : ''}
                <button class="ghost" id="miniflux-refresh" type="button">Refresh</button>
              </div>
            </div>
          `;
          bind(data);
          setupAutoRefresh();
          return;
        }

        const lastUpdatedText = data.lastUpdated
          ? `Updated ${new Date(data.lastUpdated).toLocaleTimeString()}`
          : '';

        container.innerHTML = `
          <div class="miniflux-section">
            <div class="miniflux-header">
              <div class="miniflux-header-title">
                <span class="miniflux-badge">${total} unread</span>
                <span class="miniflux-time">${lastUpdatedText}</span>
              </div>
              <div class="miniflux-header-actions">
                ${isLoggedIn ? '<button class="ghost warning-hover" id="miniflux-read-all" type="button">Mark All Read</button>' : ''}
                <button class="ghost" id="miniflux-refresh" type="button">Refresh</button>
                ${data.url ? `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer" class="button icon-btn" title="Open Miniflux">↗</a>` : ''}
              </div>
            </div>
            <div class="miniflux-list">
              ${entries.map(entry => {
                const relTime = formatRelativeTime(entry.publishedAt);
                return `
                  <article class="miniflux-card" data-id="${entry.id}">
                    <div class="miniflux-card-content">
                      <div class="miniflux-meta">
                        <span class="miniflux-feed-title" title="${escapeHtml(entry.feedTitle)}">${escapeHtml(entry.feedTitle)}</span>
                        <span class="miniflux-date" title="${new Date(entry.publishedAt).toLocaleString()}">${escapeHtml(relTime)}</span>
                      </div>
                      <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" class="miniflux-entry-title">
                        ${escapeHtml(entry.title)}
                      </a>
                    </div>
                    ${isLoggedIn ? `
                      <button class="miniflux-mark-read" data-id="${entry.id}" title="Mark as read" type="button">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </button>
                    ` : ''}
                  </article>
                `;
              }).join('')}
            </div>
            ${total > entries.length ? `
              <div class="miniflux-footer">
                <p>Showing latest ${entries.length} of ${total} unread articles. <a href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer">View more on Miniflux</a></p>
              </div>
            ` : ''}
          </div>
        `;
        bind(data);
        setupAutoRefresh();
      } catch (error) {
        container.innerHTML = `
          <div class="miniflux-error">
            <p>Miniflux integration error: ${escapeHtml(error.message)}</p>
            <button class="ghost" id="miniflux-refresh" type="button">Retry</button>
          </div>
        `;
        bind();
        setupAutoRefresh();
      }
    }

    function setupAutoRefresh() {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }

      const config = lastConfig || { uiAutoRefresh: false, uiAutoRefreshInterval: 60 };
      if (config.uiAutoRefresh) {
        const intervalMs = Math.max(10, Number(config.uiAutoRefreshInterval || 60)) * 1000;
        autoRefreshTimer = setInterval(async () => {
          if (!document.body.contains(container)) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
            return;
          }
          await render();
        }, intervalMs);
      }
    }

    function bind(data) {
      const refreshBtn = container.querySelector('#miniflux-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          refreshBtn.disabled = true;
          refreshBtn.textContent = 'Refreshing…';
          try {
            if (isLoggedIn) {
              await api('/api/plugins/miniflux/refresh', { method: 'POST' });
            }
            await render();
          } catch (err) {
            console.error(err);
            await render();
          }
        });
      }

      const markButtons = container.querySelectorAll('.miniflux-mark-read');
      markButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const entryId = btn.getAttribute('data-id');
          const card = container.querySelector(`.miniflux-card[data-id="${entryId}"]`);
          
          if (card) {
            card.classList.add('marking-read');
          }
          btn.disabled = true;

          try {
            await api('/api/plugins/miniflux/read', {
              method: 'POST',
              body: JSON.stringify({ id: entryId })
            });
            await render();
          } catch (err) {
            console.error(err);
            if (card) {
              card.classList.remove('marking-read');
            }
            btn.disabled = false;
            alert(`Failed to mark as read: ${err.message}`);
          }
        });
      });

      const readAllBtn = container.querySelector('#miniflux-read-all');
      if (readAllBtn) {
        readAllBtn.addEventListener('click', async () => {
          if (!confirm('Are you sure you want to mark ALL unread articles as read in Miniflux?')) {
            return;
          }
          readAllBtn.disabled = true;
          readAllBtn.textContent = 'Marking all read…';

          try {
            await api('/api/plugins/miniflux/read-all', { method: 'POST' });
            await render();
          } catch (err) {
            console.error(err);
            readAllBtn.disabled = false;
            readAllBtn.textContent = 'Mark All Read';
            alert(`Failed to mark all as read: ${err.message}`);
          }
        });
      }
    }

    function formatRelativeTime(dateString) {
      const now = new Date();
      const date = new Date(dateString);
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHrs = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHrs / 24);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHrs < 24) return `${diffHrs}h ago`;
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function escapeHtml(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    await render();
  }
});
