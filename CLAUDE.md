# Provisioner

PR-based app provisioning for `*.apps.quickable.co` via Dokploy.

## Quick Reference

- **Full docs**: See [docs/README.md](docs/README.md)
- **Contributing guide**: See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- **Examples**: See [docs/examples/](docs/examples/)

## For Agents

### What This Repo Does

Users submit PRs adding `apps/<subdomain>/provision.yaml` to claim subdomains on `apps.quickable.co`. On merge, GitHub Actions provisions the app to Dokploy.

### Key Files

| File | Purpose |
|------|---------|
| `apps/*/provision.yaml` | App configurations (one per subdomain) |
| `scripts/validate.ts` | Schema + security validation |
| `scripts/apply.ts` | Provisions to Dokploy API |
| `scripts/cleanup.ts` | Removes apps when directories deleted |
| `scripts/lib/dokploy-client.ts` | Typed Dokploy API wrapper |
| `schemas/provision.schema.json` | JSON Schema for validation |
| `config/reserved-subdomains.yaml` | Blocked subdomain names |

### Workflows

- **validate.yaml**: Runs on PR - validates schema, security, reserved names
- **apply.yaml**: Runs on merge to main - provisions to Dokploy

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
