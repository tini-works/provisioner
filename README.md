# Provisioner

Deploy your app to `*.apps.quickable.co` by opening a PR.

## Steps

1. Create `apps/<your-subdomain>.yaml`
2. Open a PR
3. Merge after approval
4. Your app is live at `https://<your-subdomain>.apps.quickable.co`

---

## Docker App

```yaml
# apps/hello-world.yaml
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
```

> Deploys to `https://hello-world.apps.quickable.co`

**Defaults:** branch=main, build=dockerfile, size=S, port=3000

---

## Docker Compose App

```yaml
# apps/my-stack.yaml
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
  ingress:
    service: web
    port: 80
```

> Deploys to `https://my-stack.apps.quickable.co`

**Defaults:** branch=main, composePath=docker-compose.yaml

---

## Sizes

| Size | Memory | CPU |
|------|--------|-----|
| **S** (default) | 512MB | 0.5 |
| M | 1GB | 1 |
| L | 2GB | 2 |

## Remove

Delete your yaml file and merge.
