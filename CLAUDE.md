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
