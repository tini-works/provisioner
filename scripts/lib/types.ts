/**
 * Type definitions for provision.yaml configuration
 */

export interface ProvisionConfig {
  apiVersion: "provisioner.quickable.co/v1";
  kind: "Application" | "ComposeStack";
  metadata: Metadata;
  spec: ApplicationSpec | ComposeSpec;
}

export interface Metadata {
  name: string;
  description?: string;
  maintainer: string;
}

export interface GitHubSource {
  owner: string;
  repo: string;
  branch: string;
  path?: string;
  composePath?: string;
}

export interface DockerSource {
  image: string;
  tag: string;
}

export interface Source {
  type: "github" | "docker";
  github?: GitHubSource;
  docker?: DockerSource;
}

export interface Build {
  type: "dockerfile" | "nixpacks" | "static";
  dockerfile?: string;
  context?: string;
  args?: Record<string, string>;
}

export interface Resources {
  size: "S" | "M" | "L";
}

export interface SecretRef {
  name: string;
  secret: string;
}

export interface Env {
  secretRefs?: SecretRef[];
  [key: string]: string | SecretRef[] | undefined;
}

export interface Port {
  containerPort: number;
  protocol?: "tcp" | "udp";
}

export interface HealthCheck {
  path: string;
  port: number;
  intervalSeconds?: number;
}

export interface Routing {
  hostnames?: string[];
}

export interface Ingress {
  service: string;
  port: number;
}

export interface ApplicationSpec {
  source: Source;
  build?: Build;
  resources: Resources;
  env?: Env;
  ports?: Port[];
  healthCheck?: HealthCheck;
  routing?: Routing;
  autoDeploy?: boolean;
}

export interface ComposeSpec {
  source: Source;
  resources: Resources;
  env?: Env;
  ingress: Ingress;
  autoDeploy?: boolean;
}

export interface ApplicationConfig extends ProvisionConfig {
  kind: "Application";
  spec: ApplicationSpec;
}

export interface ComposeConfig extends ProvisionConfig {
  kind: "ComposeStack";
  spec: ComposeSpec;
}

// Validation result types
export interface ValidationError {
  type: "error";
  message: string;
  path?: string;
}

export interface ValidationWarning {
  type: "warning";
  message: string;
  path?: string;
}

export type ValidationIssue = ValidationError | ValidationWarning;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// Type guards
export function isApplicationConfig(
  config: ProvisionConfig
): config is ApplicationConfig {
  return config.kind === "Application";
}

export function isComposeConfig(
  config: ProvisionConfig
): config is ComposeConfig {
  return config.kind === "ComposeStack";
}
