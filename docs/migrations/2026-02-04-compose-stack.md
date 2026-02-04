# Migration to Single ComposeStack (2026-02-04)

## Goals
- Single Dokploy ComposeStack named `provisioner`
- Traefik managed by provisioner (not Dokploy's built-in)
- App services generated from `apps/*/provision.yaml`

## Domain Changes
- Apps: `https://{app}-p.apps.quickable.co`
- UI: `https://p.apps.quickable.co`

## Steps
1. Merge this change set to main.
2. Ensure wildcard cert files exist on Dokploy host:
   - `/etc/dokploy/provisioner/certs/apps.quickable.co.crt`
   - `/etc/dokploy/provisioner/certs/apps.quickable.co.key`
3. On Dokploy, create a project named `provisioner` if it does not exist.
4. Set environment variables for apply:
   - `PROVISIONER_REPO_OWNER`
   - `PROVISIONER_REPO_NAME`
   - `PROVISIONER_REPO_BRANCH=main`
   - `DOKPLOY_API_URL`, `DOKPLOY_API_KEY`
5. Run `bun run scripts/apply.ts` to create the ComposeStack and deploy.
6. Validate:
   - `https://p.apps.quickable.co` loads provisioner UI
   - `https://<app>-p.apps.quickable.co` loads each app
7. Remove legacy Dokploy projects named `provisioner-<app>` after verification.

## Rollback
1. `git revert` the commit that updated `generated/docker-compose.yaml` or this change set.
2. Run `bun run scripts/apply.ts` to redeploy the previous stack.
