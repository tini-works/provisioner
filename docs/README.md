# Provisioner

A secure bridge for hosting apps on `*.apps.quickable.co`.

## How It Works

1. **Submit a PR** with your app configuration in `apps/<your-subdomain>/provision.yaml`
2. **Automated validation** checks your config for errors and security issues
3. **Maintainer approval** ensures quality and security
4. **Merge triggers deployment** to Dokploy
5. **Auto-update (optional)** via GitHub Action in your source repo

## Quick Start

### 1. Create Your Config

Create a directory and `provision.yaml`:

```bash
mkdir apps/my-app
```

```yaml
# apps/my-app/provision.yaml
apiVersion: provisioner.quickable.co/v1
kind: Application
metadata:
  name: my-app
  description: "My awesome application"
  maintainer: "@your-github-username"
spec:
  source:
    type: github
    github:
      owner: "your-org"
      repo: "my-app"
      branch: "main"
  build:
    type: dockerfile
  resources:
    size: S  # S, M, or L
  ports:
    - containerPort: 3000
  healthCheck:
    path: "/health"
    port: 3000
```

### 2. Submit PR

```bash
git checkout -b add-my-app
git add apps/my-app/
git commit -m "Add my-app"
git push origin add-my-app
# Open PR on GitHub
```

### 3. After Merge

Your app will be available at `https://my-app.apps.quickable.co`

## Configuration Reference

### Application (Single Container)

```yaml
apiVersion: provisioner.quickable.co/v1
kind: Application
metadata:
  name: subdomain-name      # Your subdomain (3-63 chars, lowercase, hyphens ok)
  description: "Optional"
  maintainer: "@github-user"
spec:
  source:
    type: github            # or "docker"
    github:
      owner: "org"
      repo: "repo"
      branch: "main"
      path: "/"             # Optional: subdirectory with Dockerfile
    # OR
    docker:
      image: "ghcr.io/org/image"
      tag: "latest"

  build:
    type: dockerfile        # dockerfile, nixpacks, or static
    dockerfile: "Dockerfile"
    context: "."

  resources:
    size: S                 # S, M, or L (see below)

  env:
    PUBLIC_URL: "https://my-app.apps.quickable.co"
    secretRefs:             # Reference org secrets
      - name: DATABASE_URL
        secret: MY_APP_DATABASE_URL

  ports:
    - containerPort: 3000

  healthCheck:
    path: "/health"
    port: 3000
    intervalSeconds: 30

  autoDeploy: true          # Default: true
```

### ComposeStack (Multi-Container)

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
      repo: "my-stack"
      branch: "main"
      composePath: "docker-compose.prod.yaml"

  resources:
    size: M

  env:
    secretRefs:
      - name: POSTGRES_PASSWORD
        secret: MY_STACK_DB_PASSWORD

  ingress:
    service: web            # Which compose service gets the domain
    port: 80
```

## Resource Sizes

| Size | CPU | Memory | Storage |
|------|-----|--------|---------|
| S    | 0.5 | 512 MB | 1 GB    |
| M    | 1   | 1 GB   | 5 GB    |
| L    | 2   | 2 GB   | 10 GB   |

## Auto-Update Setup

After your app is deployed, you can enable automatic redeployments when you push to your source repo.

### 1. Get Your App ID

After merge, check the GitHub Actions run summary for your `applicationId` or `composeId`.

### 2. Add Secrets to Your Source Repo

- `DOKPLOY_DEPLOY_TOKEN`: API token for deployments (get from maintainers)
- Repository variable `DOKPLOY_APP_ID`: Your application/compose ID

### 3. Add Deploy Workflow

Create `.github/workflows/deploy.yaml` in your source repo:

```yaml
name: Deploy to apps.quickable.co

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: quickable/deploy-action@v1
        with:
          application-id: ${{ vars.DOKPLOY_APP_ID }}
          api-token: ${{ secrets.DOKPLOY_DEPLOY_TOKEN }}
```

Now every push to main will automatically redeploy your app!

## Security Requirements

Your configuration must NOT include:

- `privileged: true`
- `network_mode: host`
- `pid: host` or `ipc: host`
- Dangerous capabilities (`SYS_ADMIN`, `NET_ADMIN`, etc.)
- Device mounts
- Sysctls modifications

## Reserved Subdomains

The following subdomains are reserved and cannot be claimed:

`www`, `api`, `admin`, `dashboard`, `console`, `auth`, `login`, `docs`, `help`, `support`, `cdn`, `static`, `monitoring`, `metrics`, and more.

See `config/reserved-subdomains.yaml` for the full list.

## Need Help?

1. Check the [examples](./examples/) directory
2. Open an issue with the "question" label
3. Read the [contributing guide](./CONTRIBUTING.md)
