/**
 * Auto-deploy setup for tini-works repos
 * Adds a GitHub Actions workflow to the source repo to trigger Dokploy redeploys
 */

// Workflow for repos where Dokploy pulls from git (public repos)
const DEPLOY_WORKFLOW_GIT = (appId: string, type: "application" | "compose") => `name: Deploy to apps.quickable.co
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger deployment
        run: |
          curl -s -X POST "https://apps.quickable.co/api/${type}.redeploy" \\
            -H "Content-Type: application/json" \\
            -H "x-api-key: \${{ secrets.DOKPLOY_API_KEY }}" \\
            -d '{"${type}Id": "${appId}"}'
          echo "Deployment triggered"
`;

// Workflow for private repos using prebuilt images
// This builds the image locally and pushes to GHCR, then triggers Dokploy
const DEPLOY_WORKFLOW_PREBUILT = (appId: string, subdomain: string, dockerfile: string, context: string) => `name: Build and Deploy to apps.quickable.co
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        run: |
          IMAGE="ghcr.io/tini-works/${subdomain}:latest"
          IMAGE_SHA="ghcr.io/tini-works/${subdomain}:sha-\${GITHUB_SHA::7}"

          docker build -t "$IMAGE" -t "$IMAGE_SHA" -f ${dockerfile} ${context}
          docker push "$IMAGE"
          docker push "$IMAGE_SHA"

          echo "Built and pushed: $IMAGE"

      - name: Trigger Dokploy deployment
        run: |
          curl -s -X POST "https://apps.quickable.co/api/application.redeploy" \\
            -H "Content-Type: application/json" \\
            -H "x-api-key: \${{ secrets.DOKPLOY_API_KEY }}" \\
            -d '{"applicationId": "${appId}"}'
          echo "Deployment triggered"
`;

interface SetupAutoDeployParams {
  owner: string;
  repo: string;
  branch: string;
  applicationId?: string;
  composeId?: string;
  usePrebuilt?: boolean;
  subdomain?: string;
  dockerfile?: string;
  context?: string;
}

/**
 * Check if a repo is in an org we can write to
 */
function canSetupAutoDeploy(owner: string): boolean {
  const writableOrgs = ["tini-works"];
  return writableOrgs.includes(owner.toLowerCase());
}

/**
 * Setup auto-deploy workflow in the source repo
 */
export async function setupAutoDeploy(params: SetupAutoDeployParams): Promise<boolean> {
  const {
    owner,
    repo,
    branch,
    applicationId,
    composeId,
    usePrebuilt = false,
    subdomain = "",
    dockerfile = "Dockerfile",
    context = "."
  } = params;

  if (!canSetupAutoDeploy(owner)) {
    return false;
  }

  const type = applicationId ? "application" : "compose";
  const id = applicationId || composeId;

  if (!id) {
    console.log("   ⚠️  No application/compose ID for auto-deploy setup");
    return false;
  }

  console.log("   → Setting up auto-deploy...");

  try {
    // Check if workflow already exists
    const checkResult = Bun.spawnSync([
      "gh", "api",
      `repos/${owner}/${repo}/contents/.github/workflows/deploy.yaml`,
      "--jq", ".sha"
    ], { stdout: "pipe", stderr: "pipe" });

    const existingSha = checkResult.stdout.toString().trim();

    // Create workflow content based on whether we're using prebuilt images
    let workflowContent: string;
    if (usePrebuilt && applicationId && subdomain) {
      workflowContent = DEPLOY_WORKFLOW_PREBUILT(applicationId, subdomain, dockerfile, context);
    } else {
      workflowContent = DEPLOY_WORKFLOW_GIT(id, type);
    }

    const base64Content = Buffer.from(workflowContent).toString("base64");

    // Prepare the API request body
    const body: Record<string, string> = {
      message: "Add auto-deploy workflow for apps.quickable.co",
      content: base64Content,
      branch: branch,
    };

    // If file exists, include SHA for update
    if (existingSha && !existingSha.includes("Not Found")) {
      body.sha = existingSha;
      body.message = "Update auto-deploy workflow for apps.quickable.co";
    }

    // Create/update the workflow file
    const result = Bun.spawnSync([
      "gh", "api",
      `repos/${owner}/${repo}/contents/.github/workflows/deploy.yaml`,
      "-X", "PUT",
      "-f", `message=${body.message}`,
      "-f", `content=${body.content}`,
      "-f", `branch=${body.branch}`,
      ...(body.sha ? ["-f", `sha=${body.sha}`] : []),
    ], { stdout: "pipe", stderr: "pipe" });

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString();
      console.log(`   ⚠️  Could not setup auto-deploy: ${stderr}`);
      return false;
    }

    const workflowType = usePrebuilt ? "build+deploy" : "deploy-only";
    console.log(`   ✓ Auto-deploy workflow (${workflowType}) added to ${owner}/${repo}`);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`   ⚠️  Auto-deploy setup failed: ${message}`);
    return false;
  }
}

/**
 * Check if DOKPLOY_API_KEY secret exists in repo, add if not
 */
export async function ensureDeploySecret(owner: string, repo: string): Promise<boolean> {
  if (!canSetupAutoDeploy(owner)) {
    return false;
  }

  try {
    // Check if secret exists
    const checkResult = Bun.spawnSync([
      "gh", "secret", "list",
      "-R", `${owner}/${repo}`,
      "--json", "name",
      "--jq", '.[].name'
    ], { stdout: "pipe", stderr: "pipe" });

    const secrets = checkResult.stdout.toString();

    if (secrets.includes("DOKPLOY_API_KEY")) {
      return true; // Secret already exists
    }

    // Get API key from environment
    const apiKey = Bun.env.DOKPLOY_API_KEY;
    if (!apiKey) {
      console.log("   ⚠️  DOKPLOY_API_KEY not available for secret setup");
      return false;
    }

    // Add the secret
    const result = Bun.spawnSync([
      "gh", "secret", "set", "DOKPLOY_API_KEY",
      "-R", `${owner}/${repo}`,
      "-b", apiKey,
    ], { stdout: "pipe", stderr: "pipe" });

    if (result.exitCode !== 0) {
      console.log(`   ⚠️  Could not set DOKPLOY_API_KEY secret`);
      return false;
    }

    console.log(`   ✓ DOKPLOY_API_KEY secret added to ${owner}/${repo}`);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`   ⚠️  Secret setup failed: ${message}`);
    return false;
  }
}
