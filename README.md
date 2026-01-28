# Provisioner

Deploy your app to `*.apps.quickable.co` by opening a PR.

## How to Deploy

1. Create `apps/<your-subdomain>/provision.yaml`
2. Open a PR
3. Wait for validation to pass
4. Get maintainer approval
5. Merge → your app is live at `<your-subdomain>.apps.quickable.co`

## Example

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

## Configuration

| Field | Description |
|-------|-------------|
| `metadata.name` | App name (for display) |
| `metadata.maintainer` | Your GitHub handle |
| `spec.source.github.owner` | Repo owner |
| `spec.source.github.repo` | Repo name |
| `spec.source.github.branch` | Branch to deploy |
| `spec.build.type` | `dockerfile`, `nixpacks`, or `static` |
| `spec.resources.size` | `S` (512MB), `M` (1GB), or `L` (2GB) |
| `spec.ports[].containerPort` | Port your app listens on |
| `spec.healthCheck.path` | Health check endpoint |

## Environment Variables

```yaml
spec:
  env:
    NODE_ENV: "production"
    # Reference org secrets:
    secretRefs:
      - name: DATABASE_URL          # Env var in your app
        secret: SHARED_DATABASE_URL # Org secret name
```

## Docker Compose Apps

For multi-container apps:

```yaml
apiVersion: provisioner.quickable.co/v1
kind: ComposeStack
metadata:
  name: my-stack
  maintainer: "@your-github-username"
spec:
  source:
    type: github
    github:
      owner: "your-org"
      repo: "your-repo"
      branch: "main"
      composePath: "docker-compose.yaml"
  resources:
    size: M
  ingress:
    service: web    # Service that gets the public domain
    port: 80
```

## Removing Your App

Delete your `apps/<subdomain>/provision.yaml` file and merge the PR.
