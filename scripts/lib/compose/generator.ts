import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ComposeFile, ComposeService } from "./types";
import type { ApplicationConfig } from "../types";
import { getOrgConfig } from "../github-orgs";

export interface GeneratorOptions {
  appsRoot: string;
  domainSuffix: string;
  uiHost: string;
  traefikImage?: string;
}

export interface SecretBinding {
  envKey: string;
  secretName: string;
}

export interface GeneratorResult {
  compose: ComposeFile;
  yaml: string;
  appNames: string[];
  secretBindings: SecretBinding[];
}

const RESOURCE_LIMITS: Record<string, { cpus: string; memory: string }> = {
  S: { cpus: "0.5", memory: "512M" },
  M: { cpus: "1", memory: "1G" },
  L: { cpus: "2", memory: "2G" },
};

/**
 * Load all Application configs from the apps directory
 */
function loadApps(appsRoot: string): ApplicationConfig[] {
  const apps: ApplicationConfig[] = [];

  if (!existsSync(appsRoot)) {
    return apps;
  }

  const entries = readdirSync(appsRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const provisionPath = join(appsRoot, entry.name, "provision.yaml");
    if (!existsSync(provisionPath)) continue;

    const content = readFileSync(provisionPath, "utf-8");
    const config = parseYaml(content) as ApplicationConfig;

    if (config.kind === "Application") {
      apps.push(config);
    }
  }

  // Sort apps by name for deterministic output
  return apps.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}

/**
 * Build a single app service with Traefik labels
 */
function buildAppService(
  app: ApplicationConfig,
  domainSuffix: string,
  _uiHost: string
): ComposeService {
  const name = app.metadata.name;
  const spec = app.spec;
  const networkName = `app-${name}`;

  // Determine hostname(s)
  const hostnames = spec.routing?.hostnames ?? [`${name}-p.${domainSuffix}`];

  // Build Traefik labels
  const labels: string[] = [
    "traefik.enable=true",
    `traefik.http.routers.${name}.rule=${hostnames.map((h) => `Host(\`${h}\`)`).join(" || ")}`,
    `traefik.http.routers.${name}.entrypoints=websecure`,
    `traefik.http.routers.${name}.tls.certresolver=letsencrypt`,
    `traefik.http.services.${name}.loadbalancer.server.port=${spec.ports?.[0]?.containerPort ?? 8080}`,
  ];

  // Add healthcheck labels if configured
  if (spec.healthCheck) {
    labels.push(
      `traefik.http.services.${name}.loadbalancer.healthcheck.path=${spec.healthCheck.path}`,
      `traefik.http.services.${name}.loadbalancer.healthcheck.port=${spec.healthCheck.port}`,
      `traefik.http.services.${name}.loadbalancer.healthcheck.interval=${spec.healthCheck.intervalSeconds ?? 10}s`
    );
  }

  // Sort labels alphabetically for determinism
  labels.sort();

  const service: ComposeService = {
    networks: [networkName],
    labels,
    restart: "unless-stopped",
  };

  // Configure build based on source type
  if (spec.source.type === "github" && spec.source.github) {
    const gh = spec.source.github;
    const repoUrl = `https://github.com/${gh.owner}/${gh.repo}.git#${gh.branch}`;
    const context = gh.path ? `${repoUrl}:${gh.path}` : repoUrl;

    service.build = {
      context,
      dockerfile: spec.build?.dockerfile ?? "Dockerfile",
    };

    if (spec.build?.args) {
      service.build.args = Object.fromEntries(
        Object.entries(spec.build.args).sort(([a], [b]) => a.localeCompare(b))
      );
    }

    // Add SSH for private repos
    const orgConfig = getOrgConfig(gh.owner);
    if (orgConfig?.sshKeyId) {
      service.build.ssh = ["default"];
    }
  } else if (spec.source.type === "docker" && spec.source.docker) {
    service.image = `${spec.source.docker.image}:${spec.source.docker.tag}`;
  }

  // Add resource limits
  const limits = RESOURCE_LIMITS[spec.resources.size] ?? RESOURCE_LIMITS.S;
  service.deploy = {
    resources: {
      limits: {
        cpus: limits.cpus,
        memory: limits.memory,
      },
    },
  };

  // Add environment variables (excluding secretRefs)
  if (spec.env) {
    const envVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(spec.env)) {
      if (key !== "secretRefs" && typeof value === "string") {
        envVars[key] = value;
      }
    }
    if (Object.keys(envVars).length > 0) {
      service.environment = Object.fromEntries(
        Object.entries(envVars).sort(([a], [b]) => a.localeCompare(b))
      );
    }
  }

  return service;
}

/**
 * Build the Traefik service configuration
 */
function buildTraefikService(
  appNetworks: string[],
  traefikImage: string
): ComposeService {
  // Traefik connects to all app networks plus public
  const networks = [...appNetworks, "public"].sort();

  return {
    image: traefikImage,
    networks,
    ports: ["80:80", "443:443"],
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock:ro",
      "./traefik:/etc/traefik:ro",
      "letsencrypt:/letsencrypt",
    ],
    labels: [
      "traefik.enable=false",
    ],
    restart: "unless-stopped",
  };
}

/**
 * Build the complete compose structure
 */
function buildCompose(
  apps: ApplicationConfig[],
  options: GeneratorOptions
): ComposeFile {
  const { domainSuffix, uiHost, traefikImage = "traefik:v2.11" } = options;

  const services: Record<string, ComposeService> = {};
  const networks: Record<string, { internal?: boolean }> = {};
  const appNetworks: string[] = [];

  // Build services for each app
  for (const app of apps) {
    const name = app.metadata.name;
    const networkName = `app-${name}`;

    services[name] = buildAppService(app, domainSuffix, uiHost);
    networks[networkName] = { internal: true };
    appNetworks.push(networkName);
  }

  // Add Traefik service
  services["traefik"] = buildTraefikService(appNetworks, traefikImage);

  // Add public network
  networks["public"] = {};

  // Sort services and networks for determinism
  const sortedServices = Object.fromEntries(
    Object.entries(services).sort(([a], [b]) => a.localeCompare(b))
  );
  const sortedNetworks = Object.fromEntries(
    Object.entries(networks).sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    services: sortedServices,
    networks: sortedNetworks,
    volumes: {
      letsencrypt: {},
    },
  };
}

/**
 * Convert compose object to deterministic YAML string
 */
function stringifyCompose(compose: ComposeFile): string {
  return stringifyYaml(compose, {
    sortMapEntries: true,
    lineWidth: 0,
  });
}

/**
 * Collect secret bindings from all apps
 */
function collectSecretBindings(apps: ApplicationConfig[]): SecretBinding[] {
  const bindings: SecretBinding[] = [];

  for (const app of apps) {
    const secretRefs = app.spec.env?.secretRefs;
    if (secretRefs) {
      for (const ref of secretRefs) {
        bindings.push({
          envKey: ref.name,
          secretName: ref.secret,
        });
      }
    }
  }

  // Sort for determinism and deduplicate
  const seen = new Set<string>();
  return bindings
    .sort((a, b) => a.envKey.localeCompare(b.envKey))
    .filter((b) => {
      const key = `${b.envKey}:${b.secretName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Main entry point - generates compose bundle from apps directory
 */
export function generateComposeBundle(options: GeneratorOptions): GeneratorResult {
  const apps = loadApps(options.appsRoot);
  const compose = buildCompose(apps, options);
  const yaml = stringifyCompose(compose);
  const appNames = apps.map((a) => a.metadata.name).sort();
  const secretBindings = collectSecretBindings(apps);

  return { compose, yaml, appNames, secretBindings };
}
