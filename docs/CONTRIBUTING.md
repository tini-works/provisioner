# Contributing to Provisioner

Thank you for your interest in hosting your app on apps.quickable.co!

## Submitting Your App

### Requirements

Before submitting, ensure:

1. Your app has a working Dockerfile or can be built with Nixpacks
2. Your app responds to HTTP requests on a configured port
3. You have a GitHub account to be listed as maintainer
4. Your subdomain name follows the rules (see below)

### Subdomain Rules

- 3-63 characters
- Lowercase letters, numbers, and hyphens only
- Must start and end with a letter or number
- Must not be in the reserved list
- Must not start with: `admin-`, `api-`, `internal-`, `system-`, `test-`, `dev-`

### Steps

1. **Fork this repository**

2. **Create your app directory**
   ```bash
   mkdir apps/your-subdomain
   ```

3. **Create provision.yaml**
   ```bash
   cp docs/examples/docker-app.yaml apps/your-subdomain/provision.yaml
   # Edit to match your app
   ```

4. **Validate locally (optional)**
   ```bash
   bun install
   bun run validate apps/your-subdomain/provision.yaml
   ```

5. **Submit PR**
   ```bash
   git checkout -b add-your-subdomain
   git add apps/your-subdomain/
   git commit -m "Add your-subdomain"
   git push origin add-your-subdomain
   ```

6. **Wait for review**
   - Automated checks will run
   - A maintainer will review your PR
   - You may be asked to make changes

7. **After merge**
   - Your app will be deployed automatically
   - Check the Actions log for deployment status
   - Your app will be live at `https://your-subdomain-p.apps.quickable.co`

## PR Checklist

Before submitting, verify:

- [ ] `provision.yaml` is valid YAML
- [ ] Subdomain name is available and follows rules
- [ ] Source repository is public (or you've coordinated access)
- [ ] Health check endpoint exists (if specified)
- [ ] No sensitive data in the config (use `secretRefs` for secrets)
- [ ] Resource size is appropriate for your app

## Updating Your App

### Config Changes

To change your app configuration:

1. Edit `apps/your-subdomain/provision.yaml`
2. Submit a PR with the changes
3. After merge, changes will be applied

### Code Changes (Auto-Update)

If you've set up auto-update:

1. Push to your source repo's tracked branch
2. GitHub Action triggers Dokploy redeploy
3. New version is live in minutes

### Removing Your App

To remove your app:

1. Delete the `apps/your-subdomain/` directory
2. Submit a PR
3. After merge, the app will be deprovisioned

## Getting Help

- **Questions**: Open an issue with the "question" label
- **Bugs**: Open an issue with details and logs
- **Security**: Email security@quickable.co (do not open public issues)

## Code of Conduct

- Be respectful and constructive
- Don't submit malicious apps
- Follow our security guidelines
- Help others when you can

## For Maintainers

See the internal docs for maintainer procedures.
