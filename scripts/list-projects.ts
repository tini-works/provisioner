#!/usr/bin/env bun
/**
 * Lists all Dokploy projects with their resources
 *
 * Usage: bun run scripts/list-projects.ts
 */

import { createDokployClient } from "./lib/dokploy-client";

async function main() {
  console.log("📦 Dokploy Projects");
  console.log("═".repeat(60));

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
  console.log(`Found ${projects.length} projects:\n`);

  // Group by name to highlight duplicates
  const byName = new Map<string, typeof projects>();
  for (const project of projects) {
    const existing = byName.get(project.name) || [];
    existing.push(project);
    byName.set(project.name, existing);
  }

  for (const [name, projectList] of byName) {
    const isDuplicate = projectList.length > 1;
    const prefix = isDuplicate ? "⚠️ " : "   ";

    for (const project of projectList) {
      const details = await client.getProject(project.projectId);
      const env = details.environments?.[0];
      const appCount = env?.applications?.length || 0;

      console.log(`${prefix}${name}`);
      console.log(`      ID: ${project.projectId}`);
      console.log(`      Apps: ${appCount}`);
      if (isDuplicate) {
        console.log(`      ⚠️  DUPLICATE`);
      }
      console.log();
    }
  }

  const duplicates = [...byName.values()].filter((list) => list.length > 1);
  if (duplicates.length > 0) {
    console.log("═".repeat(60));
    console.log(`⚠️  ${duplicates.length} project names have duplicates`);
    console.log("   Run: bun run scripts/dedupe-projects.ts");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
