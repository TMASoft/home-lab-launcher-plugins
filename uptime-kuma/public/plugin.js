if (!document.querySelector('link[data-plugin-style="uptime-kuma"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/plugins/uptime-kuma/styles.css';
  link.dataset.pluginStyle = 'uptime-kuma';
  document.head.appendChild(link);
}

window.HomeLabLauncher.registerPluginSection({
  id: 'uptime-kuma',
  title: 'Uptime Status',
  render: async ({ container, api, user }) => {
    container.innerHTML = '<p class="uptime-kuma-loading">Loading uptime metrics…</p>';
    const canEdit = ['admin', 'editor'].includes(user?.role);
    
    async function render() {
      try {
        const data = await api('/api/plugins/uptime-kuma/monitors');
        
        if (!data.configured) {
          container.innerHTML = `
            <div class="uptime-kuma-empty">
              <h3>Uptime Kuma Integration</h3>
              <p>The Uptime Kuma plugin is installed but has not been configured yet.</p>
              ${canEdit ? '<p class="admin-only-tip">Go to <strong>Admin → Plugins</strong> to configure the Uptime Kuma URL and Status Page slug.</p>' : ''}
            </div>
          `;
          return;
        }

        const monitors = data.monitors || [];
        if (monitors.length === 0) {
          const hasError = Boolean(data.lastError);
          container.innerHTML = `
            <div class="uptime-kuma-empty">
              <h3>${hasError ? 'Uptime Kuma sync error' : 'No monitors found'}</h3>
              <p>${hasError
                ? `Could not refresh status page <code>${escapeHtml(data.slug || 'default')}</code>: ${escapeHtml(data.lastError)}`
                : `Connected to Uptime Kuma but no public monitors were found on the status page <code>${escapeHtml(data.slug || 'default')}</code>.`}</p>
              <div class="uptime-kuma-actions">
                <button class="ghost" id="uptime-kuma-refresh" type="button">Refresh</button>
              </div>
            </div>
          `;
          bind();
          return;
        }

        const total = monitors.length;
        const upCount = monitors.filter(m => m.status === 1).length;
        const downCount = monitors.filter(m => m.status === 0).length;
        const unknownCount = total - upCount - downCount;
        const allUp = total > 0 && upCount === total;

        let summaryClass = allUp ? 'all-up' : 'some-down';
        let summaryText = '💚 All services operational';
        if (!allUp) {
          summaryText = downCount > 0
            ? `⚠️ ${downCount} of ${total} services are down`
            : `⚠️ ${unknownCount} of ${total} services are not reporting up`;
        }

        if (data.lastError) {
          summaryText = `⚠️ Sync Error: ${escapeHtml(data.lastError)}`;
          summaryClass = 'some-down';
        }

        const lastUpdatedText = data.lastUpdated 
          ? `Updated ${new Date(data.lastUpdated).toLocaleTimeString()}`
          : '';

        container.innerHTML = `
          <div class="uptime-kuma-section">
            <div class="uptime-kuma-summary">
              <span class="uptime-kuma-summary-text ${summaryClass}">${summaryText}</span>
              <div class="uptime-kuma-summary-meta">
                <small class="uptime-kuma-time">${lastUpdatedText}</small>
                <button class="ghost" id="uptime-kuma-refresh" type="button">Refresh</button>
              </div>
            </div>
            <div class="uptime-kuma-grid">
              ${monitors.map(m => {
                const isUp = m.status === 1;
                const isDown = m.status === 0;
                const statusClass = isUp ? 'up' : isDown ? 'down' : 'unknown';
                const statusText = isUp ? 'Up' : isDown ? 'Down' : 'Unknown';
                const pingText = m.ping !== null ? `${m.ping} ms` : '—';
                const history = m.history || [];

                return `
                  <article class="uptime-kuma-card">
                    <div class="uptime-kuma-card-header">
                      <strong class="uptime-kuma-monitor-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</strong>
                      <span class="uptime-kuma-status-dot ${statusClass}" title="${statusText}"></span>
                    </div>
                    <div class="uptime-kuma-card-meta">
                      <span>Status: ${statusText}</span>
                      <span>${pingText}</span>
                    </div>
                    <div class="uptime-kuma-timeline" title="${history.length ? 'Recent heartbeats' : 'No history yet'}">
                      ${history.length 
                        ? history.map(h => {
                            const hClass = h.status === 1 ? 'up' : h.status === 0 ? 'down' : 'unknown';
                            const timeStr = h.time ? new Date(h.time).toLocaleTimeString() : '';
                            return `<span class="uptime-kuma-bar ${hClass}" title="${h.status === 1 ? 'Up' : 'Down'} ${h.ping ? '· ' + h.ping + 'ms' : ''} ${timeStr}"></span>`;
                          }).join('')
                        : Array(24).fill(0).map(() => `<span class="uptime-kuma-bar unknown"></span>`).join('')
                      }
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </div>
        `;
        bind();
      } catch (error) {
        container.innerHTML = `<p class="uptime-kuma-error">Uptime Kuma integration error: ${escapeHtml(error.message)}</p>`;
      }
    }

    function bind() {
      const btn = container.querySelector('#uptime-kuma-refresh');
      if (!btn) return;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Refreshing…';
        try {
          if (canEdit) {
            await api('/api/plugins/uptime-kuma/refresh', { method: 'POST' });
          }
          await render();
        } catch (err) {
          console.error(err);
          await render();
        }
      });
    }

    function escapeHtml(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    await render();
  }
});
