#!/usr/bin/env bun
/**
 * Applies provision.yaml configurations to Dokploy
 *
 * Usage: bun run scripts/apply.ts <file1.yaml> [file2.yaml ...]
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import {
  createDokployClient,
  type DokployClient,
  type ResourceSize,
} from "./lib/dokploy-client";
import type {
  ProvisionConfig,
  ApplicationConfig,
} from "./lib/types";
import { getSubdomainFromPath } from "./lib/subdomain";
import { getOrgConfig } from "./lib/github-orgs";
import { setupAutoDeploy, ensureDeploySecret } from "./lib/auto-deploy";

const DOMAIN_SUFFIX = "apps.quickable.co";
const PROJECT_NAME = "provisioner";

interface ProvisionResult {
  success: boolean;
  appName: string;
  subdomain: string;
  applicationId?: string;
  projectId?: string;
  domain?: string;
  branch?: string;
  error?: string;
  autoDeployConfigured?: boolean;
}

/**
 * Ensure the shared provisioner project exists and return its details
 */
async function ensureProvisionerProject(
  client: DokployClient
): Promise<{ projectId: string; environmentId: string }> {
  const existingProject = await client.findProjectByName(PROJECT_NAME);

  if (existingProject) {
    const projectDetails = await client.getProject(existingProject.projectId);
    const environment = projectDetails.environments?.[0];
    if (!environment) {
      throw new Error(`Project "${PROJECT_NAME}" exists but has no environment`);
    }
    return { projectId: existingProject.projectId, environmentId: environment.environmentId };
  }

  // Create the project
  console.log(`   → Creating project "${PROJECT_NAME}"...`);
  const result = await client.createProject({
    name: PROJECT_NAME,
    description: "Provisioner-managed applications",
  });
  console.log(`   ✓ Project created: ${result.project.projectId}`);
  return { projectId: result.project.projectId, environmentId: result.environment.environmentId };
}

/**
 * Find an existing application by name within the provisioner project
 */
async function findAppInProject(
  client: DokployClient,
  projectId: string,
  appName: string
): Promise<{ applicationId: string; name: string } | null> {
  const projectDetails = await client.getProject(projectId);
  const environment = projectDetails.environments?.[0];
  if (!environment) return null;

  const allApps = environment.applications || [];
  const matchingApps = allApps.filter((a) => a.name === appName);

  if (matchingApps.length > 1) {
    throw new Error(
      `DUPLICATE APPS: Found ${matchingApps.length} applications named "${appName}" in project "${PROJECT_NAME}". ` +
        `IDs: ${matchingApps.map((a) => a.applicationId).join(", ")}. ` +
        `Please manually resolve duplicates before applying.`
    );
  }

  return matchingApps[0] || null;
}

/**
 * Provision an Application to Dokploy
 */
async function provisionApplication(
  client: DokployClient,
  config: ProvisionConfig,
  subdomain: string
): Promise<ProvisionResult> {
  const appName = config.metadata.name;
  const fullDomain = `${appName}-p.${DOMAIN_SUFFIX}`;

  try {
    console.log(`\n📦 Provisioning Application: ${appName}`);
    console.log(`   Domain: ${fullDomain}`);

    // 1. Ensure shared provisioner project exists
    const { projectId, environmentId } = await ensureProvisionerProject(client);
    let app: { applicationId: string };
    let isUpdate = false;

    // 2. Check if app already exists in provisioner project
    const existingApp = await findAppInProject(client, projectId, appName);

    if (existingApp) {
      console.log(`   ✓ Found existing application: ${existingApp.applicationId}`);
      app = existingApp;
      isUpdate = true;
    } else {
      console.log("   → Creating application...");
      app = await client.createApplication({
        name: appName,
        environmentId,
        description: config.metadata.description,
      });
      console.log(`   ✓ Application created: ${app.applicationId}`);
    }

    // 4. Configure source
    const appSpec = config.spec as ApplicationConfig["spec"];
    const source = appSpec.source;
    let sourceBranch: string | undefined;

    if (source.type === "github" && source.github) {
      // Default branch to "main" if not specified
      const branch = source.github.branch || "main";
      sourceBranch = branch;
      // Check if org is configured with GitHub OAuth (preferred for private repos)
      const orgConfig = getOrgConfig(source.github.owner);

      if (orgConfig?.githubId) {
        // Use GitHub provider with OAuth for private repos (like tech-dd/docs)
        console.log("   → Configuring GitHub source (OAuth)...");
        await client.updateApplication({
          applicationId: app.applicationId,
          sourceType: "github",
        });

        await client.configureGitHubProvider({
          applicationId: app.applicationId,
          repository: source.github.repo,
          owner: source.github.owner,
          branch: branch,
          buildPath: source.github.path || "/",
          githubId: orgConfig.githubId,
        });
        console.log(`   ✓ GitHub source [OAuth]: ${source.github.owner}/${source.github.repo}@${branch}`);
      } else if (orgConfig?.sshKeyId) {
        // Fallback: Use custom Git provider with SSH for private repos
        console.log("   → Configuring Git source (SSH)...");
        await client.updateApplication({
          applicationId: app.applicationId,
          sourceType: "git",
        });

        const gitUrl = `git@github.com:${source.github.owner}/${source.github.repo}.git`;
        await client.configureCustomGitProvider({
          applicationId: app.applicationId,
          customGitUrl: gitUrl,
          customGitBranch: branch,
          customGitBuildPath: source.github.path || "/",
          customGitSSHKeyId: orgConfig.sshKeyId,
        });
        console.log(`   ✓ Git source [SSH]: ${gitUrl}@${branch}`);
      } else {
        // Public repos use HTTPS
        console.log("   → Configuring Git source (HTTPS)...");
        await client.updateApplication({
          applicationId: app.applicationId,
          sourceType: "git",
        });

        const gitUrl = `https://github.com/${source.github.owner}/${source.github.repo}.git`;
        await client.configureCustomGitProvider({
          applicationId: app.applicationId,
          customGitUrl: gitUrl,
          customGitBranch: branch,
          customGitBuildPath: source.github.path || "/",
        });
        console.log(`   ✓ Git source [HTTPS]: ${gitUrl}@${branch}`);
      }
    } else if (source.type === "docker" && source.docker) {
      console.log("   → Configuring Docker source...");
      await client.configureDockerProvider({
        applicationId: app.applicationId,
        dockerImage: `${source.docker.image}:${source.docker.tag}`,
      });
      console.log(`   ✓ Docker image: ${source.docker.image}:${source.docker.tag}`);
    }

    // 5. Configure build type (default: dockerfile)
    const buildType = appSpec.build?.type || "dockerfile";
    console.log("   → Configuring build type...");
    await client.configureBuildType({
      applicationId: app.applicationId,
      buildType: buildType,
      dockerfile: appSpec.build?.dockerfile || "Dockerfile",
      dockerContextPath: appSpec.build?.context || ".",
      dockerBuildStage: "",
    });
    console.log(`   ✓ Build type: ${buildType}`);

    // 6. Set resource limits (default: S)
    const size = (appSpec.resources?.size || "S") as ResourceSize;
    console.log("   → Setting resource limits...");
    await client.setResourceLimits(app.applicationId, size);
    console.log(`   ✓ Resources: Size ${size}`);

    // 7. Configure environment variables
    if (appSpec.env) {
      console.log("   → Configuring environment...");
      const envVars: string[] = [];

      // Add static env vars
      for (const [key, value] of Object.entries(appSpec.env)) {
        if (key !== "secretRefs" && typeof value === "string") {
          envVars.push(`${key}=${value}`);
        }
      }

      // Add secret refs (these should be passed from GitHub Actions secrets)
      if (appSpec.env.secretRefs) {
        for (const ref of appSpec.env.secretRefs) {
          const secretValue = Bun.env[`SECRET_${ref.secret}`];
          if (secretValue) {
            envVars.push(`${ref.name}=${secretValue}`);
          } else {
            console.log(`   ⚠️  Secret ${ref.secret} not found in environment`);
          }
        }
      }

      if (envVars.length > 0) {
        await client.configureEnvironment({
          applicationId: app.applicationId,
          env: envVars.join("\n"),
        });
        console.log(`   ✓ Environment: ${envVars.length} variable(s)`);
      }
    }

    // 8. Create or update domain
    const expectedPort = appSpec.ports?.[0]?.containerPort || 3000;
    if (!isUpdate) {
      console.log("   → Creating domain...");
      await client.createDomain({
        applicationId: app.applicationId,
        host: fullDomain,
        port: expectedPort,
        https: false,
        certificateType: "none",
      });
      console.log(`   ✓ Domain: https://${fullDomain}:${expectedPort}`);
    } else {
      // Check if domain port needs updating
      console.log("   → Checking domain configuration...");
      const domains = await client.getDomainsByApplication(app.applicationId);
      const existingDomain = domains.find((d) => d.host === fullDomain);

      if (existingDomain) {
        if (existingDomain.port !== expectedPort) {
          console.log(`   → Updating domain port: ${existingDomain.port} → ${expectedPort}`);
          await client.updateDomain({
            domainId: existingDomain.domainId,
            host: fullDomain,
            port: expectedPort,
          });
          console.log(`   ✓ Domain port updated to ${expectedPort}`);
        } else {
          console.log(`   ✓ Domain exists: https://${fullDomain}:${expectedPort}`);
        }
      } else {
        // Domain doesn't exist for this app - create it
        console.log("   → Creating missing domain...");
        await client.createDomain({
          applicationId: app.applicationId,
          host: fullDomain,
          port: expectedPort,
          https: false,
          certificateType: "none",
        });
        console.log(`   ✓ Domain created: https://${fullDomain}:${expectedPort}`);
      }
    }

    // 9. Trigger deployment (redeploy for updates)
    console.log(isUpdate ? "   → Triggering redeploy..." : "   → Triggering deployment...");
    if (isUpdate) {
      await client.redeployApplication(app.applicationId);
    } else {
      await client.deployApplication({
        applicationId: app.applicationId,
        title: "Initial deployment via provisioner",
      });
    }
    console.log("   ✓ Deployment triggered");

    // 10. Setup auto-deploy for tini-works repos
    let autoDeployConfigured = false;
    if (source.type === "github" && source.github) {
      const secretOk = await ensureDeploySecret(source.github.owner, source.github.repo);
      if (secretOk) {
        autoDeployConfigured = await setupAutoDeploy({
          owner: source.github.owner,
          repo: source.github.repo,
          branch: source.github.branch || "main",
          applicationId: app.applicationId,
          subdomain: subdomain,
          dockerfile: appSpec.build?.dockerfile || "Dockerfile",
          context: appSpec.build?.context || ".",
        });
      }
    }

    return {
      success: true,
      appName,
      subdomain,
      applicationId: app.applicationId,
      projectId,
      autoDeployConfigured,
      domain: `https://${fullDomain}`,
      branch: sourceBranch,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`   ❌ Error: ${message}`);
    return {
      success: false,
      appName,
      subdomain,
      error: message,
    };
  }
}

/**
 * Apply a single provision.yaml file
 */
async function applyFile(
  client: DokployClient,
  filePath: string
): Promise<ProvisionResult> {
  // Read and parse config
  const content = readFileSync(filePath, "utf-8");
  const config = parseYaml(content) as ProvisionConfig;

  // Get subdomain from directory structure
  const subdomain = getSubdomainFromPath(filePath);

  if (config.kind === "Application") {
    return provisionApplication(client, config, subdomain);
  } else {
    return {
      success: false,
      appName: config.metadata?.name || "unknown",
      subdomain,
      error: `Unsupported kind: ${config.kind}`,
    };
  }
}

/**
 * Print deployment instructions for auto-update
 */
function printAutoUpdateInstructions(results: ProvisionResult[]) {
  const successful = results.filter((r) => r.success);
  const needsManualSetup = successful.filter((r) => !r.autoDeployConfigured);

  // Print auto-configured apps
  const autoConfigured = successful.filter((r) => r.autoDeployConfigured);
  if (autoConfigured.length > 0) {
    console.log("\n" + "═".repeat(60));
    console.log("🚀 AUTO-DEPLOY CONFIGURED");
    console.log("═".repeat(60));
    for (const result of autoConfigured) {
      console.log(`   ✓ ${result.appName} → ${result.domain}`);
      console.log(`     Pushes to ${result.branch || "main"} will auto-deploy`);
    }
  }

  // Print manual setup instructions for external repos
  if (needsManualSetup.length === 0) return;

  console.log("\n" + "═".repeat(60));
  console.log("📋 MANUAL AUTO-DEPLOY SETUP REQUIRED");
  console.log("═".repeat(60));

  for (const result of needsManualSetup) {
    console.log(`\n🔧 ${result.appName} (${result.subdomain})`);
    console.log("─".repeat(40));
    console.log(`   applicationId: ${result.applicationId}`);
    console.log(`   Domain: ${result.domain}`);
    console.log("\n   To enable auto-deploy, add this to your source repo:");
    console.log("\n   1. Add repository secret DOKPLOY_DEPLOY_TOKEN");
    console.log("   2. Add repository variable DOKPLOY_APP_ID = " + result.applicationId);
    console.log("   3. Create .github/workflows/deploy.yaml:");
    console.log(`
   name: Deploy to apps.quickable.co
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: tini-works/provisioner/deploy-action@main
           with:
             application-id: \${{ vars.DOKPLOY_APP_ID }}
             api-token: \${{ secrets.DOKPLOY_DEPLOY_TOKEN }}
`);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/apply.ts <file1.yaml> [file2.yaml ...]");
    console.error("\nEnvironment variables:");
    console.error("  DOKPLOY_API_URL  - Dokploy API URL (required)");
    console.error("  DOKPLOY_API_KEY  - Dokploy API key (required)");
    console.error("  SECRET_*         - Secrets to inject (e.g., SECRET_DATABASE_URL)");
    process.exit(1);
  }

  console.log("🚀 Provisioner Apply");
  console.log("═".repeat(60));

  // Create Dokploy client
  const client = createDokployClient();

  // Check Dokploy connectivity
  console.log("🔌 Checking Dokploy connection...");
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("❌ Cannot connect to Dokploy API");
    process.exit(1);
  }
  console.log("✓ Connected to Dokploy");

  // Process each file
  const results: ProvisionResult[] = [];

  for (const filePath of args) {
    if (!existsSync(filePath)) {
      console.error(`\n❌ File not found: ${filePath}`);
      results.push({
        success: false,
        appName: "unknown",
        subdomain: getSubdomainFromPath(filePath),
        error: "File not found",
      });
      continue;
    }

    const result = await applyFile(client, filePath);
    results.push(result);
  }

  // Print auto-update instructions
  printAutoUpdateInstructions(results);

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("📊 SUMMARY");
  console.log("═".repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`   ✅ Successful: ${successful.length}`);
  console.log(`   ❌ Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\n   Failed deployments:");
    for (const result of failed) {
      console.log(`   - ${result.subdomain}: ${result.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
