# Provisioner

A PR-based deployment system for hosting apps on `*.apps.quickable.co` using Dokploy as the backend.

## How It Works

1. **Create a PR** with your app config in `apps/<subdomain>/provision.yaml`
2. **Validation runs** automatically (schema, security, reserved names)
3. **Maintainer reviews** and merges
4. **App deploys** to `<subdomain>.apps.quickable.co`

## Quick Start

```yaml
# apps/my-app/provision.yaml
apiVersion: provisioner.quickable.co/v1
kind: Application
metadata:
  name: my-app
  description: "My awesome app"
  maintainer: "@your-github-username"
spec:
  source:
    type: github
    github:
      owner: "your-org"
      repo: "your-repo"
      branch: "main"
  build:
    type: dockerfile
  resources:
    size: S
  ports:
    - containerPort: 3000
  healthCheck:
    path: "/health"
    port: 3000
```

## Configuration Reference

### Application Kind

For single-container apps built from a Dockerfile or using buildpacks.

```yaml
apiVersion: provisioner.quickable.co/v1
kind: Application
metadata:
  name: my-app                    # Required: becomes subdomain
  description: "Description"      # Optional
  maintainer: "@github-user"      # Required: for contact
spec:
  source:
    type: github                  # "github" or "docker"
    github:
      owner: "org-or-user"
      repo: "repo-name"
      branch: "main"
      path: "/"                   # Optional: subdirectory
    # OR use docker:
    # docker:
    #   image: "ghcr.io/org/image"
    #   tag: "latest"

  build:
    type: dockerfile              # "dockerfile" | "nixpacks" | "static"
    dockerfile: "Dockerfile"      # Optional: default "Dockerfile"
    context: "."                  # Optional: build context

  resources:
    size: S                       # S | M | L (see sizing below)

  ports:
    - containerPort: 3000         # Port your app listens on

  healthCheck:                    # Optional but recommended
    path: "/health"
    port: 3000
    intervalSeconds: 30

  env:                            # Optional: environment variables
    NODE_ENV: "production"
    PUBLIC_URL: "https://my-app.apps.quickable.co"
    secretRefs:                   # Reference org secrets
      - name: DATABASE_URL        # Env var name in your app
        secret: SHARED_DATABASE_URL  # Org secret name
```

### ComposeStack Kind

For multi-container apps using Docker Compose.

```yaml
apiVersion: provisioner.quickable.co/v1
kind: ComposeStack
metadata:
  name: my-stack
  maintainer: "@github-user"
spec:
  source:
    type: github
    github:
      owner: "org"
      repo: "repo"
      branch: "main"
      composePath: "docker-compose.yaml"

  resources:
    size: M

  ingress:
    service: web                  # Which compose service gets the domain
    port: 80

  env:
    secretRefs:
      - name: DATABASE_URL
        secret: SHARED_DATABASE_URL
```

## Resource Sizing

| Size | CPU   | Memory |
|------|-------|--------|
| S    | 0.5   | 512MB  |
| M    | 1     | 1GB    |
| L    | 2     | 2GB    |

## Security Rules

The following are **blocked** for security:

- `privileged: true`
- `network_mode: host`
- `pid: host` / `ipc: host`
- `cap_add: [SYS_ADMIN, ...]`
- `devices: [...]`
- Host path mounts outside allowed directories

## Reserved Subdomains

These subdomains cannot be used: `www`, `api`, `admin`, `dashboard`, `auth`, `login`, `docs`, `status`, `mail`, `cdn`, `static`, `git`, `registry`, and others.

See `config/reserved-subdomains.yaml` for the full list.

## Workflows

### On Pull Request

- Schema validation
- Security policy check
- Reserved subdomain check
- Source repository accessibility check

### On Merge to Main

- Provision app to Dokploy
- Configure domain routing
- Trigger initial deployment
- Write audit log

### On Delete

When you delete `apps/<subdomain>/provision.yaml` and merge:

- App is deprovisioned from Dokploy
- Domain is removed
- Resources are cleaned up

## Local Development

```bash
# Install dependencies
bun install

# Validate a config file
bun run scripts/validate.ts apps/my-app/provision.yaml

# Apply a config (requires DOKPLOY_API_URL and DOKPLOY_API_KEY)
bun run scripts/apply.ts apps/my-app/provision.yaml
```

## Environment Variables

For GitHub Actions (set as repository secrets):

| Variable | Description |
|----------|-------------|
| `DOKPLOY_API_URL` | Dokploy API endpoint |
| `DOKPLOY_API_KEY` | Dokploy API token |
| `SECRET_*` | Org secrets apps can reference |

## Architecture

```
provisioner/
├── .github/workflows/
│   ├── validate.yaml     # PR validation
│   └── apply.yaml        # Deployment on merge
├── apps/
│   └── <subdomain>/
│       └── provision.yaml
├── scripts/
│   ├── validate.ts       # Validation logic
│   ├── apply.ts          # Provisioning logic
│   ├── cleanup.ts        # Deprovisioning logic
│   └── lib/
│       └── dokploy-client.ts
├── schemas/
│   └── provision.schema.json
└── config/
    └── reserved-subdomains.yaml
```

## Troubleshooting

### Deployment fails immediately

Check the Dokploy deployment logs. Common issues:
- Source repo not accessible (private repo without SSH key)
- Dockerfile not found
- Build errors

### Domain not working

- DNS propagation can take a few minutes
- Check Cloudflare for the `*.apps.quickable.co` wildcard record
- Verify the domain was created in Dokploy

### App crashes on startup

- Check container logs in Dokploy
- Verify your app listens on the correct port
- Ensure health check endpoint exists

## Contributing

1. Fork the repo
2. Create your feature branch
3. Submit a PR

All PRs require maintainer approval.
