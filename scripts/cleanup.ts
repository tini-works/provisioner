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
import { basename, dirname } from "path";
import { createDokployClient, type DokployClient } from "./lib/dokploy-client";
import type { ProvisionConfig } from "./lib/types";

interface CleanupResult {
  success: boolean;
  subdomain: string;
  appName: string;
  projectId?: string;
  error?: string;
}

/**
 * Extract subdomain from file path or config
 */
function getSubdomainFromPath(filePath: string): string {
  const dir = dirname(filePath);
  return basename(dir);
}

/**
 * Find and delete resources by project name pattern
 */
async function cleanupBySubdomain(
  client: DokployClient,
  subdomain: string,
  config: ProvisionConfig
): Promise<CleanupResult> {
  const appName = config.metadata?.name || subdomain;
  const projectName = `provisioner-${subdomain}`;

  try {
    console.log(`\n🗑️  Cleaning up: ${appName}`);
    console.log(`   Subdomain: ${subdomain}`);
    console.log(`   Looking for project: ${projectName}`);

    // Find matching project
    const projects = await client.listProjects();
    const project = projects.find((p) => p.name === projectName);

    if (!project) {
      console.log(`   ⚠️  Project not found: ${projectName}`);
      console.log("   This may already be cleaned up or was never provisioned.");
      return {
        success: true,
        subdomain,
        appName,
      };
    }

    console.log(`   → Found project: ${project.projectId}`);

    // Delete the project (cascades to applications, composes, domains)
    console.log("   → Deleting project and all resources...");
    await client.deleteProject(project.projectId);
    console.log("   ✓ Project deleted");

    return {
      success: true,
      subdomain,
      appName,
      projectId: project.projectId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`   ❌ Error: ${message}`);
    return {
      success: false,
      subdomain,
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
    // Try to read file content if not provided
    const configContent = content || readFileSync(filePath, "utf-8");
    const config = parseYaml(configContent) as ProvisionConfig;

    return cleanupBySubdomain(client, subdomain, config);
  } catch (e) {
    // If we can't parse the file, try to cleanup by subdomain only
    console.log(`\n🗑️  Cleaning up: ${subdomain} (config not parseable)`);

    return cleanupBySubdomain(client, subdomain, {
      apiVersion: "provisioner.quickable.co/v1",
      kind: "Application",
      metadata: { name: subdomain, maintainer: "@unknown" },
      spec: {
        source: { type: "github" },
        resources: { size: "S" },
      },
    } as ProvisionConfig);
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
      const project = result.projectId ? ` (project: ${result.projectId})` : "";
      console.log(`   - ${result.subdomain}${project}`);
    }
  }

  if (failed.length > 0) {
    console.log("\n   Failed:");
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
