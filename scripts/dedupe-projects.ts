#!/usr/bin/env bun
/**
 * Removes duplicate Dokploy projects
 *
 * Usage: bun run scripts/dedupe-projects.ts [--dry-run]
 *
 * Finds projects with duplicate names and removes extras,
 * keeping the one with the most applications.
 */

import { createDokployClient } from "./lib/dokploy-client";

async function main() {
  const dryRun = Bun.argv.includes("--dry-run");

  console.log("🔍 Dokploy Project Deduplication");
  console.log("═".repeat(60));
  if (dryRun) {
    console.log("⚠️  DRY RUN MODE - no changes will be made\n");
  }

  const client = createDokployClient();

  // Check connectivity
  console.log("🔌 Checking Dokploy connection...");
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("❌ Cannot connect to Dokploy API");
    process.exit(1);
  }
  console.log("✓ Connected to Dokploy\n");

  // Get all projects
  const projects = await client.listProjects();
  console.log(`📦 Found ${projects.length} total projects\n`);

  // Group by name
  const byName = new Map<string, typeof projects>();
  for (const project of projects) {
    const existing = byName.get(project.name) || [];
    existing.push(project);
    byName.set(project.name, existing);
  }

  // Find duplicates
  const duplicates = [...byName.entries()].filter(([, list]) => list.length > 1);

  if (duplicates.length === 0) {
    console.log("✅ No duplicate projects found!");
    process.exit(0);
  }

  console.log(`⚠️  Found ${duplicates.length} project names with duplicates:\n`);

  let totalDeleted = 0;

  for (const [name, projectList] of duplicates) {
    console.log(`\n📁 "${name}" (${projectList.length} instances)`);

    // Get full details for each project to count resources
    const details = await Promise.all(
      projectList.map(async (p) => {
        const full = await client.getProject(p.projectId);
        const env = full.environments?.[0];
        const appCount = env?.applications?.length || 0;
        return {
          ...p,
          appCount,
        };
      })
    );

    // Sort by resource count (most first), then by projectId (newer IDs last, keep newer)
    details.sort((a, b) => {
      if (b.appCount !== a.appCount) return b.appCount - a.appCount;
      return a.projectId.localeCompare(b.projectId); // Keep older one if tied
    });

    const [keep, ...remove] = details;

    console.log(`   Keep: ${keep.projectId} (${keep.appCount} apps)`);

    for (const dup of remove) {
      console.log(`   Delete: ${dup.projectId} (${dup.appCount} apps)`);

      if (!dryRun) {
        try {
          await client.deleteProject(dup.projectId);
          console.log(`   ✓ Deleted ${dup.projectId}`);
          totalDeleted++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`   ❌ Failed to delete: ${msg}`);
        }
      } else {
        totalDeleted++;
      }
    }
  }

  console.log("\n" + "═".repeat(60));
  if (dryRun) {
    console.log(`📊 Would delete ${totalDeleted} duplicate projects`);
    console.log("\nRun without --dry-run to apply changes.");
  } else {
    console.log(`📊 Deleted ${totalDeleted} duplicate projects`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
