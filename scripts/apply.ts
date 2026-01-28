#!/usr/bin/env bun
/**
 * Applies provision.yaml configurations to Dokploy
 *
 * Usage: bun run scripts/apply.ts <file1.yaml> [file2.yaml ...]
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { basename, dirname } from "path";
import {
  createDokployClient,
  type DokployClient,
  type ResourceSize,
} from "./lib/dokploy-client";
import type {
  ProvisionConfig,
  ApplicationConfig,
  ComposeConfig,
  isApplicationConfig,
  isComposeConfig,
} from "./lib/types";

const DOMAIN_SUFFIX = "apps.quickable.co";

interface ProvisionResult {
  success: boolean;
  appName: string;
  subdomain: string;
  applicationId?: string;
  composeId?: string;
  projectId?: string;
  domain?: string;
  error?: string;
}

/**
 * Extract subdomain from file path
 * apps/my-app/provision.yaml -> my-app
 */
function getSubdomainFromPath(filePath: string): string {
  const dir = dirname(filePath);
  return basename(dir);
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
  const fullDomain = `${subdomain}.${DOMAIN_SUFFIX}`;

  try {
    console.log(`\n📦 Provisioning Application: ${appName}`);
    console.log(`   Subdomain: ${fullDomain}`);

    // 1. Create project for isolation (returns project + default environment)
    console.log("   → Creating project...");
    const { project, environment } = await client.createProject({
      name: `provisioner-${subdomain}`,
      description: config.metadata.description || `Provisioned app: ${appName}`,
    });
    console.log(`   ✓ Project created: ${project.projectId}`);

    // 3. Create application
    console.log("   → Creating application...");
    const app = await client.createApplication({
      name: appName,
      environmentId: environment.environmentId,
      description: config.metadata.description,
    });
    console.log(`   ✓ Application created: ${app.applicationId}`);

    // 4. Configure source
    const appSpec = config.spec as ApplicationConfig["spec"];
    const source = appSpec.source;

    if (source.type === "github" && source.github) {
      console.log("   → Configuring Git source...");
      // First, set sourceType to "git" so Dokploy knows to clone
      await client.updateApplication({
        applicationId: app.applicationId,
        sourceType: "git",
      });
      // Use custom git provider for public repos (no GitHub integration required)
      const gitUrl = `https://github.com/${source.github.owner}/${source.github.repo}.git`;
      await client.configureCustomGitProvider({
        applicationId: app.applicationId,
        customGitUrl: gitUrl,
        customGitBranch: source.github.branch,
        customGitBuildPath: source.github.path || "/",
      });
      console.log(`   ✓ Git source: ${gitUrl}@${source.github.branch}`);
    } else if (source.type === "docker" && source.docker) {
      console.log("   → Configuring Docker source...");
      await client.configureDockerProvider({
        applicationId: app.applicationId,
        dockerImage: `${source.docker.image}:${source.docker.tag}`,
      });
      console.log(`   ✓ Docker image: ${source.docker.image}:${source.docker.tag}`);
    }

    // 5. Configure build type
    if (appSpec.build) {
      console.log("   → Configuring build type...");
      await client.configureBuildType({
        applicationId: app.applicationId,
        buildType: appSpec.build.type,
        dockerfile: appSpec.build.dockerfile || "Dockerfile",
        dockerContextPath: appSpec.build.context || ".",
        dockerBuildStage: "",
      });
      console.log(`   ✓ Build type: ${appSpec.build.type}`);
    }

    // 6. Set resource limits
    console.log("   → Setting resource limits...");
    await client.setResourceLimits(
      app.applicationId,
      appSpec.resources.size as ResourceSize
    );
    console.log(`   ✓ Resources: Size ${appSpec.resources.size}`);

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

    // 8. Create domain (Cloudflare handles TLS, Traefik receives HTTP)
    console.log("   → Creating domain...");
    const port = appSpec.ports?.[0]?.containerPort || 3000;
    await client.createDomain({
      applicationId: app.applicationId,
      host: fullDomain,
      port,
      https: false,
      certificateType: "none",
    });
    console.log(`   ✓ Domain: https://${fullDomain}`);

    // 9. Trigger initial deployment
    console.log("   → Triggering deployment...");
    await client.deployApplication({
      applicationId: app.applicationId,
      title: "Initial deployment via provisioner",
    });
    console.log("   ✓ Deployment triggered");

    return {
      success: true,
      appName,
      subdomain,
      applicationId: app.applicationId,
      projectId: project.projectId,
      domain: `https://${fullDomain}`,
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
 * Provision a ComposeStack to Dokploy
 */
async function provisionCompose(
  client: DokployClient,
  config: ProvisionConfig,
  subdomain: string
): Promise<ProvisionResult> {
  const appName = config.metadata.name;
  const fullDomain = `${subdomain}.${DOMAIN_SUFFIX}`;

  try {
    console.log(`\n📦 Provisioning ComposeStack: ${appName}`);
    console.log(`   Subdomain: ${fullDomain}`);

    // 1. Create project (returns project + default environment)
    console.log("   → Creating project...");
    const { project, environment } = await client.createProject({
      name: `provisioner-${subdomain}`,
      description: config.metadata.description || `Provisioned compose: ${appName}`,
    });
    console.log(`   ✓ Project created: ${project.projectId}`);

    // 3. Create compose stack
    console.log("   → Creating compose stack...");
    const compose = await client.createCompose({
      name: appName,
      environmentId: environment.environmentId,
      description: config.metadata.description,
      composeType: "docker-compose",
    });
    console.log(`   ✓ Compose created: ${compose.composeId}`);

    // 4. Configure source
    const composeSpec = config.spec as ComposeConfig["spec"];
    const source = composeSpec.source;

    if (source.type === "github" && source.github) {
      console.log("   → Configuring GitHub source...");
      await client.configureComposeGitHubProvider({
        composeId: compose.composeId,
        owner: source.github.owner,
        repository: source.github.repo,
        branch: source.github.branch,
        buildPath: source.github.composePath || "docker-compose.yaml",
      });
      console.log(`   ✓ GitHub source: ${source.github.owner}/${source.github.repo}`);
    }

    // 5. Configure environment variables
    if (composeSpec.env) {
      console.log("   → Configuring environment...");
      const envVars: string[] = [];

      for (const [key, value] of Object.entries(composeSpec.env)) {
        if (key !== "secretRefs" && typeof value === "string") {
          envVars.push(`${key}=${value}`);
        }
      }

      if (composeSpec.env.secretRefs) {
        for (const ref of composeSpec.env.secretRefs) {
          const secretValue = Bun.env[`SECRET_${ref.secret}`];
          if (secretValue) {
            envVars.push(`${ref.name}=${secretValue}`);
          }
        }
      }

      if (envVars.length > 0) {
        await client.configureComposeEnvironment({
          composeId: compose.composeId,
          env: envVars.join("\n"),
        });
        console.log(`   ✓ Environment: ${envVars.length} variable(s)`);
      }
    }

    // 6. Create domain for ingress service (Cloudflare handles TLS)
    console.log("   → Creating domain...");
    await client.createDomain({
      composeId: compose.composeId,
      host: fullDomain,
      port: composeSpec.ingress.port,
      https: false,
      certificateType: "none",
      serviceName: composeSpec.ingress.service,
    });
    console.log(`   ✓ Domain: https://${fullDomain} → ${composeSpec.ingress.service}:${composeSpec.ingress.port}`);

    // 7. Trigger deployment
    console.log("   → Triggering deployment...");
    await client.deployCompose({
      composeId: compose.composeId,
      title: "Initial deployment via provisioner",
    });
    console.log("   ✓ Deployment triggered");

    return {
      success: true,
      appName,
      subdomain,
      composeId: compose.composeId,
      projectId: project.projectId,
      domain: `https://${fullDomain}`,
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

  // Provision based on kind
  if (config.kind === "Application") {
    return provisionApplication(client, config, subdomain);
  } else if (config.kind === "ComposeStack") {
    return provisionCompose(client, config, subdomain);
  } else {
    return {
      success: false,
      appName: config.metadata?.name || "unknown",
      subdomain,
      error: `Unknown kind: ${config.kind}`,
    };
  }
}

/**
 * Print deployment instructions for auto-update
 */
function printAutoUpdateInstructions(results: ProvisionResult[]) {
  const successful = results.filter((r) => r.success);

  if (successful.length === 0) return;

  console.log("\n" + "═".repeat(60));
  console.log("📋 AUTO-UPDATE SETUP INSTRUCTIONS");
  console.log("═".repeat(60));

  for (const result of successful) {
    const id = result.applicationId || result.composeId;
    const type = result.applicationId ? "application" : "compose";

    console.log(`\n🔧 ${result.appName} (${result.subdomain})`);
    console.log("─".repeat(40));
    console.log(`   ${type}Id: ${id}`);
    console.log(`   Domain: ${result.domain}`);
    console.log("\n   To enable auto-deploy, add this to your source repo:");
    console.log("\n   1. Add repository secret DOKPLOY_DEPLOY_TOKEN");
    console.log("   2. Add repository variable DOKPLOY_APP_ID = " + id);
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
         - uses: quickable/deploy-action@v1
           with:
             ${type}-id: \${{ vars.DOKPLOY_APP_ID }}
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
