# Provisioner

PR-based app provisioning for `*.apps.quickable.co` via Dokploy.

## Architecture

- **Single project**: All apps live in one Dokploy project called `provisioner`
- **Domain pattern**: `{metadata.name}-p.apps.quickable.co` (the `-p` suffix distinguishes provisioner-managed apps)
- **App configs**: `apps/<name>.yaml` or `apps/<name>/provision.yaml`
- **Only Application kind** is supported (no ComposeStack)

## Quick Reference

- **Full docs**: See [docs/README.md](docs/README.md)
- **Contributing guide**: See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- **Examples**: See [docs/examples/](docs/examples/)

## For Agents

### What This Repo Does

Users submit PRs adding `apps/<name>.yaml` (or `apps/<name>/provision.yaml`) to provision apps on `apps.quickable.co`. On merge, GitHub Actions provisions the app to the shared `provisioner` project in Dokploy.

### Key Files

| File | Purpose |
|------|---------|
| `apps/*.yaml` or `apps/*/provision.yaml` | App configurations |
| `scripts/apply.ts` | Provisions apps to Dokploy (single `provisioner` project) |
| `scripts/cleanup.ts` | Removes individual apps from `provisioner` project |
| `scripts/validate.ts` | Schema + security validation |
| `scripts/lib/dokploy-client.ts` | Typed Dokploy API wrapper (Application-only) |
| `scripts/lib/types.ts` | ProvisionConfig types |
| `scripts/list-projects.ts` | List all Dokploy projects and apps |
| `scripts/dedupe-projects.ts` | Remove duplicate projects |
| `schemas/provision.schema.json` | JSON Schema for validation |
| `config/reserved-subdomains.yaml` | Blocked subdomain names |

### Workflows

- **validate.yaml**: Runs on PR - validates schema, security, reserved names
- **apply.yaml**: Runs on merge to main - provisions to Dokploy (deprovision waits for provision)

### Testing Locally

```bash
# Validate a config
bun run scripts/validate.ts apps/my-app/provision.yaml

# Apply (requires DOKPLOY_API_URL and DOKPLOY_API_KEY)
DOKPLOY_API_URL=https://apps.quickable.co \
DOKPLOY_API_KEY=<key> \
bun run scripts/apply.ts apps/my-app/provision.yaml
```

### provision.yaml Schema

```yaml
apiVersion: provisioner.quickable.co/v1
kind: Application
metadata:
  name: my-app
  description: "Description"
  maintainer: "@github-user"
spec:
  source:
    type: github
    github:
      owner: "org"
      repo: "repo"
      branch: "main"
  build:
    type: dockerfile
  resources:
    size: S  # S | M | L
  ports:
    - containerPort: 3000
```

### Monorepo / Subdirectory Apps

For apps where the Dockerfile lives in a subdirectory (e.g., `provisioner-ui/` within this repo), do **NOT** use `source.github.path`. Instead, point `build.dockerfile` and `build.context` into the subdirectory:

```yaml
spec:
  source:
    type: github
    github:
      owner: tini-works
      repo: provisioner
      branch: main
      # NO path field here
  build:
    type: dockerfile
    dockerfile: provisioner-ui/Dockerfile   # relative to repo root
    context: provisioner-ui                  # relative to repo root
```

### Dokploy Server Access

- **API**: `https://apps.quickable.co` (Dokploy API)
- **SSH**: `ssh debian@139.99.125.82 -p 22000` (use `sudo` for docker commands)
- **Build logs**: `sudo cat /etc/dokploy/logs/<container-name>/<logfile>`
- **List logs**: `sudo ls -t /etc/dokploy/logs/<container-name>/`

### Troubleshooting

**Dokploy has two separate build path fields** that can conflict:
- `buildPath` — set by `application.saveGithubProvider` (GitHub OAuth)
- `customGitBuildPath` — set by `application.saveCustomGitProvider` or `application.update`

If a build fails with a doubled path like `code/foo/foo`, check both fields via:
```bash
curl -sf 'https://apps.quickable.co/api/application.one?applicationId=<ID>' \
  -H 'x-api-key: <KEY>' | jq '{buildPath, customGitBuildPath, dockerfile, dockerContextPath}'
```

Fix via `application.update` which can set both:
```bash
curl -sf -X POST 'https://apps.quickable.co/api/application.update' \
  -H 'Content-Type: application/json' -H 'x-api-key: <KEY>' \
  -d '{"applicationId": "<ID>", "buildPath": "/", "customGitBuildPath": "/", "dockerfile": "...", "dockerContextPath": "..."}'
```

**Current Dokploy state** (provisioner project: `byP4zWZY7El3qAQ4PnMwM`):

| App | applicationId | Domain |
|-----|---------------|--------|
| docliq-proto | `X6R8OyAFkDExdIksF_Lz2` | docliq-proto-p.apps.quickable.co |
| docliq-1 | `qJvdUx-UADe_hfw2hP0om` | docliq-1-p.apps.quickable.co |
| docliq-2 | `aqb6o2cba03vHa-Io7k1D` | docliq-2-p.apps.quickable.co |
| provisioner-ui | `JSQoeaZL6pVGkPQVoVRdL` | p.apps.quickable.co |

**GitHub OAuth** for `tini-works` org: `githubId: W6uKDj7mTCtzLWplO_Z5m`
