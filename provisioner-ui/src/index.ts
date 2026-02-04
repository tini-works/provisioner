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
  // Find provisioner project
  const projects = await dokployRequest<any[]>("/project.all");
  const project = projects.find((p) => p.name === PROJECT_NAME);
  if (!project) return [];

  // Get project details with environments
  const details = await dokployRequest<any>(`/project.one?projectId=${project.projectId}`);
  const env = details.environments?.[0];
  if (!env) return [];

  const apps: AppWithDetails[] = [];

  for (const app of env.applications || []) {
    // Get domains
    const domains = await dokployRequest<Domain[]>(
      `/domain.byApplicationId?applicationId=${app.applicationId}`
    );

    // Get app details with deployments
    const appDetails = await dokployRequest<any>(
      `/application.one?applicationId=${app.applicationId}`
    );

    apps.push({
      ...app,
      domains,
      deployments: (appDetails.deployments || []).slice(0, 5),
    });
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    done: "background: #22c55e; color: white;",
    running: "background: #3b82f6; color: white;",
    error: "background: #ef4444; color: white;",
    idle: "background: #6b7280; color: white;",
  };
  return `<span style="padding: 2px 8px; border-radius: 4px; font-size: 12px; ${colors[status] || colors.idle}">${status}</span>`;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

app.get("/", async (c) => {
  let apps: AppWithDetails[] = [];
  let error: string | null = null;

  try {
    apps = await getProvisionerApps();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch apps";
  }

  const totalApps = apps.length;
  const healthyApps = apps.filter((a) => a.applicationStatus === "done").length;
  const errorApps = apps.filter((a) => a.applicationStatus === "error").length;

  const page = html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Provisioner Dashboard</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0f172a;
            color: #e2e8f0;
            padding: 20px;
            min-height: 100vh;
          }
          .container { max-width: 1200px; margin: 0 auto; }
          h1 { font-size: 24px; margin-bottom: 20px; color: #f8fafc; }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
          }
          .stat {
            background: #1e293b;
            padding: 16px;
            border-radius: 8px;
            text-align: center;
          }
          .stat-value { font-size: 32px; font-weight: bold; color: #f8fafc; }
          .stat-label { font-size: 14px; color: #94a3b8; margin-top: 4px; }
          .stat.healthy .stat-value { color: #22c55e; }
          .stat.error .stat-value { color: #ef4444; }
          .apps { display: flex; flex-direction: column; gap: 16px; }
          .app {
            background: #1e293b;
            border-radius: 8px;
            padding: 20px;
            border-left: 4px solid #3b82f6;
          }
          .app.error { border-left-color: #ef4444; }
          .app.done { border-left-color: #22c55e; }
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }
          .app-name { font-size: 18px; font-weight: 600; color: #f8fafc; }
          .app-source {
            font-size: 13px;
            color: #64748b;
            margin-bottom: 12px;
          }
          .app-source a { color: #3b82f6; text-decoration: none; }
          .app-source a:hover { text-decoration: underline; }
          .domains { margin-bottom: 12px; }
          .domain {
            display: inline-block;
            background: #334155;
            padding: 4px 10px;
            border-radius: 4px;
            margin-right: 8px;
            margin-bottom: 4px;
            font-size: 13px;
          }
          .domain a { color: #38bdf8; text-decoration: none; }
          .domain a:hover { text-decoration: underline; }
          .deployments { margin-top: 12px; border-top: 1px solid #334155; padding-top: 12px; }
          .deployments-title { font-size: 13px; color: #94a3b8; margin-bottom: 8px; }
          .deployment {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 13px;
            padding: 4px 0;
          }
          .deployment-time { color: #64748b; min-width: 70px; }
          .deployment-title { color: #cbd5e1; flex: 1; }
          .deployment-error { color: #f87171; font-size: 12px; margin-left: 82px; }
          .error-banner {
            background: #7f1d1d;
            color: #fecaca;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          .refresh { color: #64748b; font-size: 13px; margin-bottom: 16px; }
          .refresh a { color: #3b82f6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Provisioner Dashboard</h1>

          ${error ? html`<div class="error-banner">${error}</div>` : ""}

          <div class="stats">
            <div class="stat">
              <div class="stat-value">${totalApps}</div>
              <div class="stat-label">Total Apps</div>
            </div>
            <div class="stat healthy">
              <div class="stat-value">${healthyApps}</div>
              <div class="stat-label">Healthy</div>
            </div>
            <div class="stat error">
              <div class="stat-value">${errorApps}</div>
              <div class="stat-label">Errors</div>
            </div>
          </div>

          <p class="refresh">Auto-refreshes every 30s. <a href="/">Refresh now</a></p>

          <div class="apps">
            ${apps.length === 0 && !error ? html`<p style="color: #64748b;">No apps deployed yet.</p>` : ""}
            ${apps.map(
              (app) => html`
                <div class="app ${app.applicationStatus}">
                  <div class="app-header">
                    <span class="app-name">${app.name}</span>
                    ${html([statusBadge(app.applicationStatus)])}
                  </div>
                  <div class="app-source">
                    ${app.sourceType === "github" && app.owner && app.repository
                      ? html`<a href="https://github.com/${app.owner}/${app.repository}" target="_blank">${app.owner}/${app.repository}</a> @ ${app.branch || "main"}`
                      : app.sourceType === "docker" && app.dockerImage
                        ? html`Docker: ${app.dockerImage}`
                        : html`Source: ${app.sourceType}`}
                  </div>
                  <div class="domains">
                    ${app.domains.map(
                      (d) => html`
                        <span class="domain">
                          <a href="https://${d.host}" target="_blank">${d.host}</a>
                        </span>
                      `
                    )}
                    ${app.domains.length === 0 ? html`<span style="color: #64748b; font-size: 13px;">No domains configured</span>` : ""}
                  </div>
                  ${app.deployments.length > 0
                    ? html`
                        <div class="deployments">
                          <div class="deployments-title">Recent Deployments</div>
                          ${app.deployments.slice(0, 3).map(
                            (d) => html`
                              <div class="deployment">
                                <span class="deployment-time">${timeAgo(d.createdAt)}</span>
                                ${html([statusBadge(d.status)])}
                                <span class="deployment-title">${d.title || "Deployment"}</span>
                              </div>
                              ${d.errorMessage ? html`<div class="deployment-error">${d.errorMessage}</div>` : ""}
                            `
                          )}
                        </div>
                      `
                    : ""}
                </div>
              `
            )}
          </div>
        </div>
        <script>
          setTimeout(() => location.reload(), 30000);
        </script>
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
