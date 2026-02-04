#!/usr/bin/env bun
/**
 * Generates docker-compose.yaml from apps directory
 *
 * Usage: bun run scripts/generate-compose.ts
 *
 * Environment variables:
 *   APPS_ROOT     - Directory containing app manifests (default: "apps")
 *   COMPOSE_OUT   - Output path for generated compose (default: "generated/docker-compose.yaml")
 *   TRAEFIK_IMAGE - Traefik image to use (default: "traefik:v2.11")
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { generateComposeBundle } from "./lib/compose/generator";

const appsRoot = Bun.env.APPS_ROOT || "apps";
const outPath = Bun.env.COMPOSE_OUT || "generated/docker-compose.yaml";

const bundle = generateComposeBundle({
  appsRoot,
  domainSuffix: "apps.quickable.co",
  uiHost: "p.apps.quickable.co",
  traefikImage: Bun.env.TRAEFIK_IMAGE || "traefik:v2.11",
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bundle.yaml);

console.log(`Generated ${outPath}`);
console.log(`Apps: ${bundle.appNames.join(", ") || "(none)"}`);

if (bundle.secretBindings.length > 0) {
  console.log(`Secret bindings: ${bundle.secretBindings.map((s) => s.envKey).join(", ")}`);
}
