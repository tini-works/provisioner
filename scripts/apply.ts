#!/usr/bin/env bun
/**
 * Applies the generated ComposeStack to Dokploy
 *
 * Usage: bun run scripts/apply.ts [--allow-removals]
 *
 * This script:
 * 1. Generates docker-compose.yaml from apps/
 * 2. Creates/finds a single "provisioner" project in Dokploy
 * 3. Creates/finds a "provisioner" compose in that project
 * 4. Configures GitHub provider pointing to this repo
 * 5. Sets environment variables from secret bindings
 * 6. Redeploys the compose
 * 7. Tracks app names in generated/compose.lock.json
 *
 * Environment variables:
 *   DOKPLOY_API_URL        - Dokploy API URL (required)
 *   DOKPLOY_API_KEY        - Dokploy API key (required)
 *   PROVISIONER_REPO_OWNER - GitHub owner for this repo (required)
 *   PROVISIONER_REPO_NAME  - GitHub repo name (required)
 *   PROVISIONER_REPO_BRANCH - Branch to deploy from (default: "main")
 *   TRAEFIK_IMAGE          - Traefik image (default: "traefik:v2.11")
 *   SECRET_*               - Secrets to inject (e.g., SECRET_DATABASE_URL)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { createDokployClient, type DokployClient } from "./lib/dokploy-client";
import { generateComposeBundle } from "./lib/compose/generator";

const PROJECT_NAME = "provisioner";
const COMPOSE_NAME = "provisioner";
const DOMAIN_SUFFIX = "apps.quickable.co";
const UI_HOST = "p.apps.quickable.co";
const OUT_PATH = "generated/docker-compose.yaml";
const LOCK_PATH = "generated/compose.lock.json";

interface LockFile {
  version: number;
  apps: string[];
  composeHash: string;
  generatedAt: string;
}

/**
 * Hash content for change detection
 */
function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Load previous app list from lock file
 */
function loadPreviousApps(): string[] {
  if (!existsSync(LOCK_PATH)) return [];
  try {
    const content = readFileSync(LOCK_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<LockFile>;
    return parsed.apps || [];
  } catch {
    return [];
  }
}

/**
 * Save lock file with app names and hash
 */
function saveLock(apps: string[], composeHash: string): void {
  mkdirSync("generated", { recursive: true });
  const lock: LockFile = {
    version: 1,
    apps,
    composeHash,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
}

/**
 * Find or create the provisioner project
 */
async function ensureProject(
  client: DokployClient
): Promise<{ projectId: string; environmentId: string }> {
  // Try to find existing project
  const existing = await client.findProjectByName(PROJECT_NAME);

  if (existing) {
    console.log(`   Found existing project: ${existing.projectId}`);
    const details = await client.getProject(existing.projectId);
    const env = details.environments?.[0];
    if (!env) {
      throw new Error("No environment found in existing project");
    }
    return { projectId: existing.projectId, environmentId: env.environmentId };
  }

  // Create new project
  console.log("   Creating project...");
  const result = await client.createProject({
    name: PROJECT_NAME,
    description: "Provisioner ComposeStack - all apps in one compose",
  });
  console.log(`   Created project: ${result.project.projectId}`);
  return {
    projectId: result.project.projectId,
    environmentId: result.environment.environmentId,
  };
}

/**
 * Find or create the provisioner compose
 */
async function ensureCompose(
  client: DokployClient,
  projectId: string,
  environmentId: string
): Promise<{ composeId: string; isNew: boolean }> {
  // Get project details to find existing compose
  const details = await client.getProject(projectId);
  const existingCompose = details.compose?.find((c) => c.name === COMPOSE_NAME);

  if (existingCompose) {
    console.log(`   Found existing compose: ${existingCompose.composeId}`);
    return { composeId: existingCompose.composeId, isNew: false };
  }

  // Create new compose
  console.log("   Creating compose...");
  const compose = await client.createCompose({
    name: COMPOSE_NAME,
    environmentId,
    description: "Generated from apps/ manifests",
    composeType: "docker-compose",
  });
  console.log(`   Created compose: ${compose.composeId}`);
  return { composeId: compose.composeId, isNew: true };
}

/**
 * Main entry point
 */
async function main() {
  const allowRemovals = Bun.argv.includes("--allow-removals");

  console.log("ComposeStack Apply");
  console.log("=".repeat(60));

  // Generate compose bundle
  console.log("\n1. Generating compose from apps/...");
  const bundle = generateComposeBundle({
    appsRoot: "apps",
    domainSuffix: DOMAIN_SUFFIX,
    uiHost: UI_HOST,
    traefikImage: Bun.env.TRAEFIK_IMAGE || "traefik:v2.11",
  });

  console.log(`   Apps: ${bundle.appNames.join(", ") || "(none)"}`);
  if (bundle.secretBindings.length > 0) {
    console.log(`   Secret bindings: ${bundle.secretBindings.map((s) => s.envKey).join(", ")}`);
  }

  // Check for removed apps
  const previousApps = loadPreviousApps();
  const removedApps = previousApps.filter((a) => !bundle.appNames.includes(a));

  if (removedApps.length > 0) {
    console.log(`\n   Removed apps detected: ${removedApps.join(", ")}`);
    if (!allowRemovals) {
      console.error("\nRefusing to remove apps without --allow-removals flag.");
      console.error("Run with --allow-removals to confirm app removal.");
      process.exit(1);
    }
    console.log("   --allow-removals flag present, proceeding...");
  }

  // Write compose file
  console.log("\n2. Writing compose file...");
  mkdirSync("generated", { recursive: true });
  writeFileSync(OUT_PATH, bundle.yaml);
  console.log(`   Written to: ${OUT_PATH}`);

  // Connect to Dokploy
  console.log("\n3. Connecting to Dokploy...");
  const client = createDokployClient();

  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("Cannot connect to Dokploy API");
    process.exit(1);
  }
  console.log("   Connected");

  // Ensure project exists
  console.log("\n4. Ensuring project exists...");
  const { projectId, environmentId } = await ensureProject(client);

  // Ensure compose exists
  console.log("\n5. Ensuring compose exists...");
  const { composeId, isNew } = await ensureCompose(client, projectId, environmentId);

  // Configure GitHub provider
  console.log("\n6. Configuring GitHub provider...");
  const repoOwner = Bun.env.PROVISIONER_REPO_OWNER;
  const repoName = Bun.env.PROVISIONER_REPO_NAME;
  const repoBranch = Bun.env.PROVISIONER_REPO_BRANCH || "main";

  if (!repoOwner || !repoName) {
    console.error("Set PROVISIONER_REPO_OWNER and PROVISIONER_REPO_NAME environment variables");
    process.exit(1);
  }

  await client.configureComposeGitHubProvider({
    composeId,
    owner: repoOwner,
    repository: repoName,
    branch: repoBranch,
    buildPath: OUT_PATH,
  });
  console.log(`   Configured: ${repoOwner}/${repoName}@${repoBranch}`);
  console.log(`   Build path: ${OUT_PATH}`);

  // Configure environment from secret bindings
  console.log("\n7. Configuring environment...");
  const envLines: string[] = [];

  for (const binding of bundle.secretBindings) {
    const secretValue = Bun.env[`SECRET_${binding.secretName}`];
    if (secretValue) {
      envLines.push(`${binding.envKey}=${secretValue}`);
      console.log(`   Set: ${binding.envKey} (from SECRET_${binding.secretName})`);
    } else {
      console.log(`   Warning: SECRET_${binding.secretName} not found in environment`);
    }
  }

  if (envLines.length > 0) {
    await client.configureComposeEnvironment({
      composeId,
      env: envLines.join("\n"),
    });
    console.log(`   Configured ${envLines.length} environment variable(s)`);
  } else {
    console.log("   No environment variables to configure");
  }

  // Redeploy
  console.log("\n8. Deploying...");
  if (isNew) {
    await client.deployCompose({
      composeId,
      title: "Initial deployment via provisioner",
    });
    console.log("   Initial deployment triggered");
  } else {
    await client.redeployCompose(composeId);
    console.log("   Redeploy triggered");
  }

  // Save lock file
  saveLock(bundle.appNames, hash(bundle.yaml));
  console.log(`   Lock file saved: ${LOCK_PATH}`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("ComposeStack deployed successfully");
  console.log("=".repeat(60));
  console.log(`   Project:  ${PROJECT_NAME} (${projectId})`);
  console.log(`   Compose:  ${COMPOSE_NAME} (${composeId})`);
  console.log(`   Apps:     ${bundle.appNames.length}`);

  if (removedApps.length > 0) {
    console.log(`   Removed:  ${removedApps.join(", ")}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
