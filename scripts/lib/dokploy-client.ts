/**
 * Typed Dokploy API client
 * Documentation: https://docs.dokploy.com/docs/api
 */

export interface DokployConfig {
  baseUrl: string;
  apiKey: string;
}

// Resource quotas mapped to Dokploy format
// Note: Dokploy uses parseInt() so we pass raw numeric strings:
// - memoryLimit: bytes as string
// - cpuLimit: nanocpus as string (1 CPU = 1e9 nanocpus)
export const QUOTAS = {
  S: { cpuLimit: "500000000", memoryLimit: "536870912" }, // 0.5 CPU, 512MB
  M: { cpuLimit: "1000000000", memoryLimit: "1073741824" }, // 1 CPU, 1GB
  L: { cpuLimit: "2000000000", memoryLimit: "2147483648" }, // 2 CPU, 2GB
} as const;

export type ResourceSize = keyof typeof QUOTAS;

// API Response types
export interface Project {
  projectId: string;
  name: string;
  description?: string;
}

export interface Application {
  applicationId: string;
  appName: string;
  name: string;
  projectId: string;
}

export interface Compose {
  composeId: string;
  appName: string;
  name: string;
  projectId: string;
}

export interface Domain {
  domainId: string;
  host: string;
  applicationId?: string;
  composeId?: string;
}

export interface Environment {
  environmentId: string;
  name: string;
}

// API Response wrappers (Dokploy returns nested structures)
export interface CreateProjectResponse {
  project: Project;
  environment: Environment;
}

// Request types
export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface CreateApplicationRequest {
  name: string;
  environmentId: string;
  description?: string;
}

export interface CreateComposeRequest {
  name: string;
  environmentId: string;
  description?: string;
  composeType?: "docker-compose" | "stack";
  composeFile?: string;
}

export interface GitHubProviderRequest {
  applicationId?: string;
  composeId?: string;
  repository: string;
  owner: string;
  branch: string;
  buildPath?: string;
  triggerType?: "push" | "manual";
}

export interface DockerProviderRequest {
  applicationId: string;
  dockerImage: string;
  username?: string;
  password?: string;
  registryId?: string;
}

export interface CustomGitProviderRequest {
  applicationId?: string;
  composeId?: string;
  customGitUrl: string;
  customGitBranch: string;
  customGitBuildPath?: string;
  customGitSSHKeyId?: string;
}

export interface UpdateApplicationRequest {
  applicationId: string;
  sourceType?: "git" | "github" | "docker" | "drop";
  [key: string]: unknown;
}

export interface BuildTypeRequest {
  applicationId: string;
  buildType: "dockerfile" | "heroku_buildpacks" | "paketo_buildpacks" | "nixpacks" | "static";
  dockerfile?: string;
  dockerContextPath?: string;
  dockerBuildStage?: string;
}

export interface EnvironmentRequest {
  applicationId?: string;
  composeId?: string;
  env?: string; // KEY=VALUE format, newline separated
  buildArgs?: string;
}

export interface CreateDomainRequest {
  applicationId?: string;
  composeId?: string;
  host: string;
  port?: number;
  https?: boolean;
  certificateType?: "letsencrypt" | "none" | "custom";
  serviceName?: string; // For compose
}

export interface DeployRequest {
  applicationId?: string;
  composeId?: string;
  title?: string;
  description?: string;
}

export class DokployClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: DokployConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": this.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Dokploy API error: ${response.status} ${response.statusText}\n${errorBody}`
      );
    }

    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // ==========================================================================
  // Project Management
  // ==========================================================================

  async createProject(params: CreateProjectRequest): Promise<CreateProjectResponse> {
    return this.request<CreateProjectResponse>("/project.create", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>(`/project.one?projectId=${projectId}`);
  }

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("/project.all");
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request("/project.remove", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
  }

  // ==========================================================================
  // Environment Management (projects have environments)
  // ==========================================================================

  async getDefaultEnvironment(projectId: string): Promise<Environment> {
    // Dokploy creates a default environment for each project
    // We need to fetch it from the project details
    return this.request<Environment>(
      `/environment.one?projectId=${projectId}`
    );
  }

  // ==========================================================================
  // Application Management
  // ==========================================================================

  async createApplication(
    params: CreateApplicationRequest
  ): Promise<Application> {
    return this.request<Application>("/application.create", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async getApplication(applicationId: string): Promise<Application> {
    return this.request<Application>(
      `/application.one?applicationId=${applicationId}`
    );
  }

  async deleteApplication(applicationId: string): Promise<void> {
    await this.request("/application.delete", {
      method: "POST",
      body: JSON.stringify({ applicationId }),
    });
  }

  async configureGitHubProvider(params: GitHubProviderRequest): Promise<void> {
    await this.request("/application.saveGithubProvider", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        triggerType: params.triggerType || "push",
      }),
    });
  }

  async configureDockerProvider(params: DockerProviderRequest): Promise<void> {
    await this.request("/application.saveDockerProvider", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async updateApplication(params: UpdateApplicationRequest): Promise<void> {
    await this.request("/application.update", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async configureCustomGitProvider(params: CustomGitProviderRequest): Promise<void> {
    await this.request("/application.saveGitProvider", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async configureBuildType(params: BuildTypeRequest): Promise<void> {
    await this.request("/application.saveBuildType", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async configureEnvironment(params: EnvironmentRequest): Promise<void> {
    await this.request("/application.saveEnvironment", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async setResourceLimits(
    applicationId: string,
    size: ResourceSize
  ): Promise<void> {
    const quota = QUOTAS[size];
    await this.request("/application.update", {
      method: "POST",
      body: JSON.stringify({
        applicationId,
        cpuLimit: quota.cpuLimit,
        memoryLimit: quota.memoryLimit,
      }),
    });
  }

  async deployApplication(params: DeployRequest): Promise<void> {
    await this.request("/application.deploy", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async redeployApplication(applicationId: string): Promise<void> {
    await this.request("/application.redeploy", {
      method: "POST",
      body: JSON.stringify({ applicationId }),
    });
  }

  // ==========================================================================
  // Compose Management
  // ==========================================================================

  async createCompose(params: CreateComposeRequest): Promise<Compose> {
    return this.request<Compose>("/compose.create", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        composeType: params.composeType || "docker-compose",
      }),
    });
  }

  async getCompose(composeId: string): Promise<Compose> {
    return this.request<Compose>(`/compose.one?composeId=${composeId}`);
  }

  async deleteCompose(
    composeId: string,
    deleteVolumes: boolean = false
  ): Promise<void> {
    await this.request("/compose.delete", {
      method: "POST",
      body: JSON.stringify({ composeId, deleteVolumes }),
    });
  }

  async configureComposeGitHubProvider(
    params: GitHubProviderRequest
  ): Promise<void> {
    await this.request("/compose.saveGithubProvider", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async configureComposeCustomGitProvider(
    params: CustomGitProviderRequest & { composeId: string }
  ): Promise<void> {
    await this.request("/compose.saveGitProvider", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async configureComposeEnvironment(params: EnvironmentRequest): Promise<void> {
    await this.request("/compose.saveEnvironment", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async deployCompose(params: DeployRequest): Promise<void> {
    await this.request("/compose.deploy", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async redeployCompose(composeId: string): Promise<void> {
    await this.request("/compose.redeploy", {
      method: "POST",
      body: JSON.stringify({ composeId }),
    });
  }

  // ==========================================================================
  // Domain Management
  // ==========================================================================

  async createDomain(params: CreateDomainRequest): Promise<Domain> {
    return this.request<Domain>("/domain.create", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        https: params.https ?? true,
        certificateType: params.certificateType || "letsencrypt",
      }),
    });
  }

  async getDomainsByApplication(applicationId: string): Promise<Domain[]> {
    return this.request<Domain[]>(
      `/domain.byApplicationId?applicationId=${applicationId}`
    );
  }

  async getDomainsByCompose(composeId: string): Promise<Domain[]> {
    return this.request<Domain[]>(`/domain.byComposeId?composeId=${composeId}`);
  }

  async deleteDomain(domainId: string): Promise<void> {
    await this.request("/domain.delete", {
      method: "POST",
      body: JSON.stringify({ domainId }),
    });
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  async healthCheck(): Promise<boolean> {
    try {
      await this.listProjects();
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function with environment variable defaults
export function createDokployClient(
  config?: Partial<DokployConfig>
): DokployClient {
  const baseUrl =
    config?.baseUrl || Bun.env.DOKPLOY_API_URL || "http://localhost:3000";
  const apiKey = config?.apiKey || Bun.env.DOKPLOY_API_KEY || "";

  if (!apiKey) {
    throw new Error(
      "Dokploy API key is required. Set DOKPLOY_API_KEY environment variable."
    );
  }

  return new DokployClient({ baseUrl, apiKey });
}
