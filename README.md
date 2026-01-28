# Provisioner

Deploy your app to `*.apps.quickable.co` by opening a PR.

## Steps

1. Create `apps/<your-subdomain>/provision.yaml`
2. Open a PR
3. Merge after approval
4. Your app is live at `https://<your-subdomain>.apps.quickable.co`

---

## Docker App

```yaml
# apps/hello-world/provision.yaml
apiVersion: provisioner.quickable.co/v1
kind: Application
metadata:
  name: hello-world
  maintainer: "@your-github"
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
```

→ Deploys to `https://hello-world.apps.quickable.co`

---

## Docker Compose App

```yaml
# apps/my-stack/provision.yaml
apiVersion: provisioner.quickable.co/v1
kind: ComposeStack
metadata:
  name: my-stack
  maintainer: "@your-github"
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
    service: web
    port: 80
```

→ Deploys to `https://my-stack.apps.quickable.co`

---

## Sizes

| Size | Memory |
|------|--------|
| S | 512MB |
| M | 1GB |
| L | 2GB |

## Remove

Delete your `provision.yaml` and merge.
