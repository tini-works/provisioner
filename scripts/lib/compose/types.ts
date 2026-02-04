export interface ComposeFile {
  services: Record<string, ComposeService>;
  networks?: Record<string, { internal?: boolean }>;
  volumes?: Record<string, unknown>;
}

export interface ComposeService {
  image?: string;
  build?: {
    context: string;
    dockerfile?: string;
    args?: Record<string, string>;
    ssh?: string[];
  };
  environment?: Record<string, string>;
  labels?: string[];
  networks?: string[];
  ports?: string[];
  volumes?: string[];
  deploy?: {
    resources?: {
      limits?: {
        cpus?: string;
        memory?: string;
      };
    };
  };
  restart?: "unless-stopped" | "always" | "no";
}
