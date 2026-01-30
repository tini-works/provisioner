/**
 * GitHub organization configuration for private repo access
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";

interface OrgConfig {
  sshKeyId: string;
  description?: string;
}

interface GitHubOrgsConfig {
  orgs: Record<string, OrgConfig>;
}

let cachedConfig: GitHubOrgsConfig | null = null;

/**
 * Load and cache the github-orgs.yaml config
 */
function loadConfig(): GitHubOrgsConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = new URL("../../config/github-orgs.yaml", import.meta.url);

  if (!existsSync(configPath)) {
    cachedConfig = { orgs: {} };
    return cachedConfig;
  }

  const content = readFileSync(configPath, "utf-8");
  cachedConfig = parseYaml(content) as GitHubOrgsConfig;
  return cachedConfig;
}

/**
 * Get SSH key config for a GitHub owner (org or user)
 * Returns null if owner is not configured for SSH access
 *
 * @param owner - GitHub org or username (case-insensitive)
 */
export function getOrgConfig(owner: string): OrgConfig | null {
  const config = loadConfig();
  const normalizedOwner = owner.toLowerCase();

  // Check all configured orgs with case-insensitive matching
  for (const [orgName, orgConfig] of Object.entries(config.orgs)) {
    if (orgName.toLowerCase() === normalizedOwner) {
      return orgConfig;
    }
  }

  return null;
}

/**
 * Check if an owner is configured for SSH access
 */
export function isPrivateOrg(owner: string): boolean {
  return getOrgConfig(owner) !== null;
}
