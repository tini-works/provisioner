import { basename, dirname } from "path";

/**
 * Extract subdomain from file path
 * Supports both formats:
 * - apps/hello.yaml → hello
 * - apps/hello/provision.yaml → hello
 */
export function getSubdomainFromPath(filePath: string): string {
  const filename = basename(filePath);
  if (filename === "provision.yaml") {
    return basename(dirname(filePath));
  }
  return filename.replace(/\.yaml$/, "");
}
