import { Hono } from "hono";
import { html } from "hono/html";

const app = new Hono();

const DOKPLOY_API_URL = process.env.DOKPLOY_API_URL || "https://apps.quickable.co";
const DOKPLOY_API_KEY = process.env.DOKPLOY_API_KEY || "";
const PROJECT_NAME = "provisioner";

interface Application {
  applicationId: string;
  name: string;
  appName: string;
  applicationStatus: string;
  sourceType: string;
  repository?: string;
  owner?: string;
  branch?: string;
  dockerImage?: string;
  createdAt: string;
}

interface Domain {
  domainId: string;
  host: string;
  port: number;
  https: boolean;
}

interface Deployment {
  deploymentId: string;
  title: string;
  status: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
}

interface AppWithDetails extends Application {
  domains: Domain[];
  deployments: Deployment[];
}

async function dokployRequest<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${DOKPLOY_API_URL}/api${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": DOKPLOY_API_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`Dokploy API error: ${res.status}`);
  }
  return res.json();
}

async function getProvisionerApps(): Promise<AppWithDetails[]> {
  const projects = await dokployRequest<any[]>("/project.all");
  const project = projects.find((p) => p.name === PROJECT_NAME);
  if (!project) return [];

  const details = await dokployRequest<any>(`/project.one?projectId=${project.projectId}`);
  const env = details.environments?.[0];
  if (!env) return [];

  const apps: AppWithDetails[] = [];

  for (const app of env.applications || []) {
    const domains = await dokployRequest<Domain[]>(
      `/domain.byApplicationId?applicationId=${app.applicationId}`
    );
    const appDetails = await dokployRequest<any>(
      `/application.one?applicationId=${app.applicationId}`
    );

    apps.push({
      ...app,
      domains,
      deployments: (appDetails.deployments || []).slice(0, 10),
    });
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "now";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #09090b;
    --bg-subtle: #18181b;
    --border: #27272a;
    --border-hover: #3f3f46;
    --text: #fafafa;
    --text-muted: #a1a1aa;
    --text-subtle: #71717a;
    --accent: #22c55e;
    --error: #ef4444;
    --warning: #f59e0b;
    --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
  }

  .layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100vh;
  }

  .sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .logo svg {
    width: 18px;
    height: 18px;
    opacity: 0.9;
  }

  .stats-row {
    display: flex;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stat-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-subtle);
  }

  .stat-dot.healthy { background: var(--accent); }
  .stat-dot.error { background: var(--error); }

  .stat-value {
    font-weight: 600;
  }

  .stat-label {
    color: var(--text-subtle);
  }

  .app-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .app-item {
    padding: 10px 12px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background 0.15s;
    margin-bottom: 2px;
  }

  .app-item:hover {
    background: var(--bg-subtle);
  }

  .app-item.active {
    background: var(--bg-subtle);
  }

  .app-item-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .app-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-subtle);
  }

  .app-status.done { background: var(--accent); }
  .app-status.error { background: var(--error); }
  .app-status.running { background: var(--warning); animation: pulse 1.5s infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .app-name {
    font-weight: 500;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-time {
    font-size: 11px;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .main-header {
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .main-title {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .main-actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }

  .btn:hover {
    background: var(--bg-subtle);
    border-color: var(--border-hover);
  }

  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-subtle);
    text-align: center;
    gap: 8px;
  }

  .empty-state svg {
    width: 48px;
    height: 48px;
    opacity: 0.3;
    margin-bottom: 8px;
  }

  .detail-section {
    margin-bottom: 32px;
  }

  .detail-section:last-child {
    margin-bottom: 0;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-subtle);
    margin-bottom: 12px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .info-item {
    background: var(--bg-subtle);
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .info-label {
    font-size: 11px;
    color: var(--text-subtle);
    margin-bottom: 4px;
  }

  .info-value {
    font-size: 13px;
    font-weight: 500;
  }

  .info-value a {
    color: var(--text);
    text-decoration: none;
  }

  .info-value a:hover {
    text-decoration: underline;
  }

  .info-value.mono {
    font-size: 12px;
    letter-spacing: -0.01em;
  }

  .domain-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .domain-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    transition: border-color 0.15s;
  }

  .domain-chip:hover {
    border-color: var(--border-hover);
  }

  .domain-chip a {
    color: var(--text);
    text-decoration: none;
    font-size: 13px;
  }

  .domain-chip a:hover {
    text-decoration: underline;
  }

  .domain-chip svg {
    width: 14px;
    height: 14px;
    opacity: 0.5;
  }

  .deployment-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .deployment-item {
    display: grid;
    grid-template-columns: 100px auto 1fr 80px;
    gap: 16px;
    padding: 12px 14px;
    background: var(--bg-subtle);
    align-items: center;
    font-size: 13px;
  }

  .deployment-item:first-child {
    border-radius: 8px 8px 0 0;
  }

  .deployment-item:last-child {
    border-radius: 0 0 8px 8px;
  }

  .deployment-item:only-child {
    border-radius: 8px;
  }

  .deployment-time {
    font-size: 12px;
    color: var(--text-muted);
  }

  .deployment-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .deployment-status .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .deployment-status.done { color: var(--accent); }
  .deployment-status.done .dot { background: var(--accent); }
  .deployment-status.error { color: var(--error); }
  .deployment-status.error .dot { background: var(--error); }
  .deployment-status.running { color: var(--warning); }
  .deployment-status.running .dot { background: var(--warning); }

  .deployment-title {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .deployment-duration {
    text-align: right;
    font-size: 12px;
    color: var(--text-subtle);
  }

  .deployment-error {
    grid-column: 1 / -1;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 4px;
    font-size: 12px;
    color: #fca5a5;
    margin-top: 4px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 100px;
    font-size: 12px;
    font-weight: 500;
  }

  .status-badge.done {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  .status-badge.error {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .status-badge.running {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
  }

  .status-badge .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  @media (max-width: 768px) {
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .sidebar {
      border-right: none;
      border-bottom: 1px solid var(--border);
      max-height: 40vh;
    }
  }
`;

app.get("/", async (c) => {
  const selectedId = c.req.query("app");

  let apps: AppWithDetails[] = [];
  let error: string | null = null;

  try {
    apps = await getProvisionerApps();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch apps";
  }

  const selectedApp = selectedId ? apps.find(a => a.applicationId === selectedId) : apps[0];
  const totalApps = apps.length;
  const healthyApps = apps.filter((a) => a.applicationStatus === "done").length;
  const errorApps = apps.filter((a) => a.applicationStatus === "error").length;

  const page = html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Provisioner</title>
        <style>${styles}</style>
      </head>
      <body>
        <div class="layout">
          <aside class="sidebar">
            <div class="sidebar-header">
              <div class="logo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                Provisioner
              </div>
            </div>

            <div class="stats-row">
              <div class="stat">
                <span class="stat-value">${totalApps}</span>
                <span class="stat-label">apps</span>
              </div>
              <div class="stat">
                <span class="stat-dot healthy"></span>
                <span class="stat-value">${healthyApps}</span>
              </div>
              ${errorApps > 0 ? html`
                <div class="stat">
                  <span class="stat-dot error"></span>
                  <span class="stat-value">${errorApps}</span>
                </div>
              ` : ''}
            </div>

            <div class="app-list">
              ${error ? html`
                <div style="padding: 16px; color: var(--error); font-size: 13px;">${error}</div>
              ` : ''}
              ${apps.map(app => html`
                <a href="/?app=${app.applicationId}" style="text-decoration: none; color: inherit;">
                  <div class="app-item ${selectedApp?.applicationId === app.applicationId ? 'active' : ''}">
                    <div class="app-item-left">
                      <span class="app-status ${app.applicationStatus}"></span>
                      <span class="app-name">${app.name}</span>
                    </div>
                    <span class="app-time">${timeAgo(app.createdAt)}</span>
                  </div>
                </a>
              `)}
            </div>
          </aside>

          <main class="main">
            ${selectedApp ? html`
              <header class="main-header">
                <h1 class="main-title">${selectedApp.name}</h1>
                <div class="main-actions">
                  <span class="status-badge ${selectedApp.applicationStatus}">
                    <span class="dot"></span>
                    ${selectedApp.applicationStatus}
                  </span>
                </div>
              </header>

              <div class="main-content">
                <section class="detail-section">
                  <h2 class="section-title">Overview</h2>
                  <div class="info-grid">
                    <div class="info-item">
                      <div class="info-label">Source</div>
                      <div class="info-value">
                        ${selectedApp.sourceType === "github" && selectedApp.owner && selectedApp.repository
                          ? html`<a href="https://github.com/${selectedApp.owner}/${selectedApp.repository}" target="_blank">${selectedApp.owner}/${selectedApp.repository}</a>`
                          : selectedApp.sourceType === "docker" && selectedApp.dockerImage
                            ? selectedApp.dockerImage
                            : selectedApp.sourceType}
                      </div>
                    </div>
                    <div class="info-item">
                      <div class="info-label">Branch</div>
                      <div class="info-value mono">${selectedApp.branch || "main"}</div>
                    </div>
                    <div class="info-item">
                      <div class="info-label">Created</div>
                      <div class="info-value">${formatDate(selectedApp.createdAt)}</div>
                    </div>
                    <div class="info-item">
                      <div class="info-label">App ID</div>
                      <div class="info-value mono" style="font-size: 11px;">${selectedApp.applicationId}</div>
                    </div>
                  </div>
                </section>

                <section class="detail-section">
                  <h2 class="section-title">Domains</h2>
                  ${selectedApp.domains.length > 0 ? html`
                    <div class="domain-list">
                      ${selectedApp.domains.map(d => html`
                        <div class="domain-chip">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                          </svg>
                          <a href="https://${d.host}" target="_blank">${d.host}</a>
                        </div>
                      `)}
                    </div>
                  ` : html`
                    <div style="color: var(--text-subtle); font-size: 13px;">No domains configured</div>
                  `}
                </section>

                <section class="detail-section">
                  <h2 class="section-title">Deployments</h2>
                  ${selectedApp.deployments.length > 0 ? html`
                    <div class="deployment-list">
                      ${selectedApp.deployments.map(d => html`
                        <div class="deployment-item">
                          <span class="deployment-time">${formatDate(d.createdAt)}</span>
                          <span class="deployment-status ${d.status}">
                            <span class="dot"></span>
                            ${d.status}
                          </span>
                          <span class="deployment-title">${(d.title || "Deployment").split("\n")[0].slice(0, 50)}</span>
                          <span class="deployment-duration">
                            ${d.finishedAt ? timeAgo(d.finishedAt) : "—"}
                          </span>
                          ${d.errorMessage ? html`
                            <div class="deployment-error">${d.errorMessage}</div>
                          ` : ''}
                        </div>
                      `)}
                    </div>
                  ` : html`
                    <div style="color: var(--text-subtle); font-size: 13px;">No deployments yet</div>
                  `}
                </section>
              </div>
            ` : html`
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <div style="font-size: 15px; font-weight: 500;">No applications</div>
                <div style="font-size: 13px;">Deploy your first app to get started</div>
              </div>
            `}
          </main>
        </div>
      </body>
    </html>
  `;

  return c.html(page);
});

app.get("/health", (c) => c.json({ status: "ok" }));

const port = parseInt(process.env.PORT || "3000");
console.log(`Provisioner UI running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
