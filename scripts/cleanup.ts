#!/usr/bin/env bun
/**
 * De-provisions applications that were deleted from the repository
 *
 * Usage: bun run scripts/cleanup.ts <deleted-file1.yaml> [deleted-file2.yaml ...]
 *
 * Note: Files should contain the content of the deleted provision.yaml
 * (e.g., from git show HEAD~1:apps/myapp/provision.yaml)
 */

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { createDokployClient, type DokployClient } from "./lib/dokploy-client";
import type { ProvisionConfig } from "./lib/types";
import { getSubdomainFromPath } from "./lib/subdomain";

const PROJECT_NAME = "provisioner";

interface CleanupResult {
  success: boolean;
  appName: string;
  applicationId?: string;
  error?: string;
}

/**
 * Find and delete an application by name within the shared provisioner project
 */
async function cleanupApp(
  client: DokployClient,
  appName: string
): Promise<CleanupResult> {
  try {
    console.log(`\n🗑️  Cleaning up: ${appName}`);

    // Find the provisioner project
    const project = await client.findProjectByName(PROJECT_NAME);
    if (!project) {
      console.log(`   ⚠️  Project "${PROJECT_NAME}" not found — nothing to clean up`);
      return { success: true, appName };
    }

    // Find the app within the project
    const projectDetails = await client.getProject(project.projectId);
    const environment = projectDetails.environments?.[0];
    if (!environment) {
      console.log(`   ⚠️  No environment in project — nothing to clean up`);
      return { success: true, appName };
    }

    const allApps = environment.applications || [];
    const app = allApps.find((a) => a.name === appName);

    if (!app) {
      console.log(`   ⚠️  Application "${appName}" not found in project`);
      console.log("   This may already be cleaned up or was never provisioned.");
      return { success: true, appName };
    }

    console.log(`   → Found application: ${app.applicationId}`);
    console.log("   → Deleting application...");
    await client.deleteApplication(app.applicationId);
    console.log("   ✓ Application deleted");

    return {
      success: true,
      appName,
      applicationId: app.applicationId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`   ❌ Error: ${message}`);
    return {
      success: false,
      appName,
      error: message,
    };
  }
}

/**
 * Process a deleted provision.yaml file
 */
async function cleanupFile(
  client: DokployClient,
  filePath: string,
  content?: string
): Promise<CleanupResult> {
  const subdomain = getSubdomainFromPath(filePath);

  try {
    const configContent = content || readFileSync(filePath, "utf-8");
    const config = parseYaml(configContent) as ProvisionConfig;
    const appName = config.metadata?.name || subdomain;
    return cleanupApp(client, appName);
  } catch {
    // If we can't parse the file, use subdomain as app name
    console.log(`\n🗑️  Cleaning up: ${subdomain} (config not parseable)`);
    return cleanupApp(client, subdomain);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/cleanup.ts <file1.yaml> [file2.yaml ...]");
    console.error("\nNote: Pass the content of deleted provision.yaml files.");
    console.error("      Use: git show HEAD~1:apps/myapp/provision.yaml > /tmp/deleted.yaml");
    console.error("\nEnvironment variables:");
    console.error("  DOKPLOY_API_URL  - Dokploy API URL (required)");
    console.error("  DOKPLOY_API_KEY  - Dokploy API key (required)");
    process.exit(1);
  }

  console.log("🧹 Provisioner Cleanup");
  console.log("═".repeat(60));

  // Create Dokploy client
  const client = createDokployClient();

  // Check connectivity
  console.log("🔌 Checking Dokploy connection...");
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("❌ Cannot connect to Dokploy API");
    process.exit(1);
  }
  console.log("✓ Connected to Dokploy");

  // Process each file
  const results: CleanupResult[] = [];

  for (const filePath of args) {
    const result = await cleanupFile(client, filePath);
    results.push(result);
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("📊 CLEANUP SUMMARY");
  console.log("═".repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`   ✅ Cleaned up: ${successful.length}`);
  console.log(`   ❌ Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log("\n   Removed:");
    for (const result of successful) {
      const id = result.applicationId ? ` (${result.applicationId})` : "";
      console.log(`   - ${result.appName}${id}`);
    }
  }

  if (failed.length > 0) {
    console.log("\n   Failed:");
    for (const result of failed) {
      console.log(`   - ${result.appName}: ${result.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
