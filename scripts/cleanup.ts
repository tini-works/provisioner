#!/usr/bin/env bun
/**
 * Cleanup script for removing apps from the ComposeStack
 *
 * Cleanup now happens by removing the app manifest and re-applying the stack.
 * This script is a thin wrapper that runs apply.ts with --allow-removals.
 *
 * Usage: bun run scripts/cleanup.ts
 *
 * To remove an app:
 * 1. Delete the apps/<subdomain>/provision.yaml directory
 * 2. Run this script (or `bun run scripts/apply.ts --allow-removals`)
 */

import { spawnSync } from "bun";

console.log("Cleanup: Running apply with --allow-removals");
console.log("");

const result = spawnSync(["bun", "run", "scripts/apply.ts", "--allow-removals"], {
  stdio: ["inherit", "inherit", "inherit"],
  cwd: import.meta.dir.replace("/scripts", ""),
});

process.exit(result.exitCode ?? 1);
