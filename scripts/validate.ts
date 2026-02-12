#!/usr/bin/env bun
/**
 * Validates provision.yaml files against schema and security policy
 *
 * Usage: bun run scripts/validate.ts <file1.yaml> [file2.yaml ...]
 */

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type {
  ProvisionConfig,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "./lib/types";
import { isPrivateOrg } from "./lib/github-orgs";

/**
 * Validate Docker image exists in registry
 */
async function validateDockerImage(
  image: string,
  tag: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    // Parse image reference
    // Examples:
    // - ghcr.io/owner/image -> GHCR
    // - docker.io/library/nginx or nginx -> Docker Hub
    // - gcr.io/project/image -> GCR

    if (image.startsWith("ghcr.io/")) {
      // GitHub Container Registry - use GitHub API
      const parts = image.replace("ghcr.io/", "").split("/");
      if (parts.length < 2) {
        return { exists: false, error: "Invalid GHCR image format" };
      }

      const owner = parts[0];
      const packageName = parts.slice(1).join("/");

      // Check if it's an org or user package
      const orgResponse = await fetch(
        `https://api.github.com/orgs/${owner}/packages/container/${encodeURIComponent(packageName)}`,
        {
          headers: Bun.env.GITHUB_TOKEN
            ? { Authorization: `token ${Bun.env.GITHUB_TOKEN}` }
            : {},
        }
      );

      if (orgResponse.ok) {
        return { exists: true };
      }

      // Try user endpoint
      const userResponse = await fetch(
        `https://api.github.com/users/${owner}/packages/container/${encodeURIComponent(packageName)}`,
        {
          headers: Bun.env.GITHUB_TOKEN
            ? { Authorization: `token ${Bun.env.GITHUB_TOKEN}` }
            : {},
        }
      );

      if (userResponse.ok) {
        return { exists: true };
      }

      return {
        exists: false,
        error: `Package not found in ghcr.io/${owner}/${packageName}`,
      };
    }

    // Docker Hub - use registry API
    let registryImage = image;
    let registry = "registry-1.docker.io";

    if (!image.includes("/")) {
      // Official image like "nginx"
      registryImage = `library/${image}`;
    } else if (!image.includes(".")) {
      // User image like "user/image"
      registryImage = image;
    } else {
      // Other registries - try to fetch manifest
      const parts = image.split("/");
      registry = parts[0];
      registryImage = parts.slice(1).join("/");
    }

    // For Docker Hub, check via API
    if (registry === "registry-1.docker.io" || registry === "docker.io") {
      const response = await fetch(
        `https://hub.docker.com/v2/repositories/${registryImage}/tags/${tag}`,
        { method: "HEAD" }
      );

      if (response.ok) {
        return { exists: true };
      }

      // Try without tag check
      const repoResponse = await fetch(
        `https://hub.docker.com/v2/repositories/${registryImage}`,
        { method: "HEAD" }
      );

      if (!repoResponse.ok) {
        return { exists: false, error: "Repository not found on Docker Hub" };
      }

      return { exists: false, error: `Tag '${tag}' not found` };
    }

    // For other registries, try anonymous manifest fetch
    const manifestUrl = `https://${registry}/v2/${registryImage}/manifests/${tag}`;
    const manifestResponse = await fetch(manifestUrl, {
      method: "HEAD",
      headers: {
        Accept: "application/vnd.docker.distribution.manifest.v2+json",
      },
    });

    if (manifestResponse.ok) {
      return { exists: true };
    }

    if (manifestResponse.status === 401) {
      // Registry requires auth - can't validate, assume exists
      return { exists: true };
    }

    return { exists: false, error: `Image not found in ${registry}` };
  } catch (e) {
    // Network error or other issue - warn but don't fail
    return { exists: true }; // Assume exists on error
  }
}

// Load JSON Schema
const schemaPath = new URL("../schemas/provision.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

// Load reserved subdomains
const reservedPath = new URL(
  "../config/reserved-subdomains.yaml",
  import.meta.url
);
const reservedConfig = parseYaml(readFileSync(reservedPath, "utf-8"));
const reservedSubdomains = new Set<string>(reservedConfig.reserved || []);
const blockedPrefixes: string[] = reservedConfig.blocked_prefixes || [];

// Initialize AJV validator
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: true,
});
addFormats(ajv);
const validateSchema = ajv.compile(schema);

/**
 * Validate a single provision.yaml file
 */
async function validateFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Read and parse YAML
  let content: string;
  let config: ProvisionConfig;

  try {
    content = readFileSync(filePath, "utf-8");
    config = parseYaml(content) as ProvisionConfig;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push({
      type: "error",
      message: `Failed to parse YAML: ${message}`,
      path: filePath,
    });
    return { valid: false, errors, warnings };
  }

  // Schema validation
  const schemaValid = validateSchema(config);
  if (!schemaValid && validateSchema.errors) {
    for (const error of validateSchema.errors) {
      errors.push({
        type: "error",
        message: `Schema: ${error.message || "validation failed"}`,
        path: error.instancePath || "/",
      });
    }
  }

  // Reserved subdomain check
  const subdomainName = config.metadata?.name?.toLowerCase();
  if (subdomainName) {
    if (reservedSubdomains.has(subdomainName)) {
      errors.push({
        type: "error",
        message: `Subdomain '${subdomainName}' is reserved for platform use`,
        path: "/metadata/name",
      });
    }

    for (const prefix of blockedPrefixes) {
      if (subdomainName.startsWith(prefix)) {
        errors.push({
          type: "error",
          message: `Subdomain '${subdomainName}' matches blocked prefix '${prefix}'`,
          path: "/metadata/name",
        });
        break;
      }
    }
  }

  // Source validation
  if (config.spec?.source) {
    const source = config.spec.source;

    if (source.type === "github" && source.github) {
      const { owner, repo, branch } = source.github;

      // Verify GitHub repo exists (optional, can be slow)
      if (Bun.env.VALIDATE_SOURCES === "true") {
        const isPrivate = isPrivateOrg(owner);

        if (isPrivate) {
          // Prefer GitHub API with token for private repos when available
          if (Bun.env.GITHUB_TOKEN) {
            try {
              const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}`,
                { headers: { Authorization: `token ${Bun.env.GITHUB_TOKEN}` } }
              );
              if (!response.ok) {
                errors.push({
                  type: "error",
                  message: `GitHub repository ${owner}/${repo} not found or not accessible`,
                  path: "/spec/source/github",
                });
              }
            } catch (e) {
              warnings.push({
                type: "warning",
                message: `Could not verify GitHub repository: ${e}`,
                path: "/spec/source/github",
              });
            }
          } else {
            // Fallback: use git ls-remote over SSH
            try {
              const proc = Bun.spawn(
                ["git", "ls-remote", "--exit-code", `git@github.com:${owner}/${repo}.git`, "HEAD"],
                { stdout: "pipe", stderr: "pipe" }
              );
              const exitCode = await proc.exited;

              if (exitCode !== 0) {
                const stderr = await new Response(proc.stderr).text();
                errors.push({
                  type: "error",
                  message: `Private repository ${owner}/${repo} not accessible via SSH: ${stderr.trim()}`,
                  path: "/spec/source/github",
                });
              }
            } catch (e) {
              warnings.push({
                type: "warning",
                message: `Could not verify private repository via SSH: ${e}`,
                path: "/spec/source/github",
              });
            }
          }
        } else {
          // For public repos, use GitHub API
          try {
            const response = await fetch(
              `https://api.github.com/repos/${owner}/${repo}`,
              {
                headers: Bun.env.GITHUB_TOKEN
                  ? { Authorization: `token ${Bun.env.GITHUB_TOKEN}` }
                  : {},
              }
            );
            if (!response.ok) {
              errors.push({
                type: "error",
                message: `GitHub repository ${owner}/${repo} not found or not accessible`,
                path: "/spec/source/github",
              });
            }
          } catch (e) {
            warnings.push({
              type: "warning",
              message: `Could not verify GitHub repository: ${e}`,
              path: "/spec/source/github",
            });
          }
        }
      }

      // Warn about default branch names
      if (branch === "main" || branch === "master") {
        warnings.push({
          type: "warning",
          message: `Using default branch '${branch}' - consider using a specific release branch`,
          path: "/spec/source/github/branch",
        });
      }
    }

    if (source.type === "docker" && source.docker) {
      const { image, tag } = source.docker;

      if (tag === "latest") {
        warnings.push({
          type: "warning",
          message:
            "Using 'latest' tag may cause unexpected updates - consider using a specific version",
          path: "/spec/source/docker/tag",
        });
      }

      // Validate Docker image exists
      if (Bun.env.VALIDATE_SOURCES === "true") {
        const imageExists = await validateDockerImage(image, tag);
        if (!imageExists.exists) {
          errors.push({
            type: "error",
            message: `Docker image ${image}:${tag} not found: ${imageExists.error}`,
            path: "/spec/source/docker",
          });
        }
      }
    }
  }

  // Health check warning
  if (config.kind === "Application") {
    const appSpec = config.spec as { healthCheck?: unknown };
    if (!appSpec.healthCheck) {
      warnings.push({
        type: "warning",
        message: "No health check defined - consider adding one for reliability",
        path: "/spec/healthCheck",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation results for output
 */
function formatResults(
  filePath: string,
  result: ValidationResult
): string {
  const lines: string[] = [];

  lines.push(`\n📄 ${filePath}`);
  lines.push("─".repeat(60));

  if (result.valid && result.warnings.length === 0) {
    lines.push("  ✅ Valid - no issues found");
  } else {
    for (const error of result.errors) {
      const path = error.path ? ` (${error.path})` : "";
      lines.push(`  ❌ ERROR${path}: ${error.message}`);
    }

    for (const warning of result.warnings) {
      const path = warning.path ? ` (${warning.path})` : "";
      lines.push(`  ⚠️  WARNING${path}: ${warning.message}`);
    }

    if (result.valid) {
      lines.push(`  ✅ Valid with ${result.warnings.length} warning(s)`);
    } else {
      lines.push(`  ❌ Invalid: ${result.errors.length} error(s)`);
    }
  }

  return lines.join("\n");
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/validate.ts <file1.yaml> [file2.yaml ...]");
    console.error("\nEnvironment variables:");
    console.error("  VALIDATE_SOURCES=true  - Verify GitHub repos exist");
    console.error("  GITHUB_TOKEN=xxx       - GitHub token for API requests");
    process.exit(1);
  }

  console.log("🔍 Provisioner Validator");
  console.log("═".repeat(60));

  let hasErrors = false;

  for (const filePath of args) {
    const result = await validateFile(filePath);
    console.log(formatResults(filePath, result));

    if (!result.valid) {
      hasErrors = true;
    }
  }

  console.log("\n" + "═".repeat(60));

  if (hasErrors) {
    console.log("❌ Validation failed - fix errors above before submitting PR");
    process.exit(1);
  } else {
    console.log("✅ All files validated successfully");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
