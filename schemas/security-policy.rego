# Security policy for provisioner
# Evaluates docker-compose files and provision configs for dangerous options
package provisioner.security

import future.keywords.in
import future.keywords.if

# Dangerous Linux capabilities that should never be added
dangerous_capabilities := {
  "SYS_ADMIN",
  "SYS_PTRACE",
  "SYS_RAWIO",
  "SYS_MODULE",
  "DAC_READ_SEARCH",
  "NET_ADMIN",
  "NET_RAW",
  "MKNOD",
  "AUDIT_WRITE",
  "SETFCAP"
}

# Reserved subdomains that cannot be claimed
reserved_subdomains := {
  "www", "api", "admin", "dashboard", "console", "portal", "status",
  "mail", "smtp", "imap", "pop", "mx",
  "auth", "login", "oauth", "sso", "accounts", "signin", "signup",
  "docs", "help", "support", "billing", "payments",
  "dev", "staging", "test", "preview", "demo",
  "cdn", "static", "assets", "media", "images", "files",
  "git", "registry", "docker", "k8s", "kubernetes",
  "monitoring", "metrics", "logs", "grafana", "prometheus", "alertmanager",
  "traefik", "proxy", "lb", "ingress", "gateway",
  "internal", "private", "system", "root", "admin",
  "ns1", "ns2", "dns", "ntp", "ldap", "radius"
}

# =============================================================================
# DENY RULES - These block deployment
# =============================================================================

# Deny privileged containers
deny[msg] if {
  input.compose.services[service].privileged == true
  msg := sprintf("BLOCKED: Service '%s' uses privileged mode - this allows container escape", [service])
}

# Deny host networking
deny[msg] if {
  input.compose.services[service].network_mode == "host"
  msg := sprintf("BLOCKED: Service '%s' uses host network mode - this bypasses network isolation", [service])
}

# Deny host PID namespace
deny[msg] if {
  input.compose.services[service].pid == "host"
  msg := sprintf("BLOCKED: Service '%s' uses host PID namespace - this exposes host processes", [service])
}

# Deny host IPC namespace
deny[msg] if {
  input.compose.services[service].ipc == "host"
  msg := sprintf("BLOCKED: Service '%s' uses host IPC namespace - this allows host IPC access", [service])
}

# Deny dangerous capabilities
deny[msg] if {
  cap := input.compose.services[service].cap_add[_]
  upper(cap) in dangerous_capabilities
  msg := sprintf("BLOCKED: Service '%s' adds dangerous capability '%s'", [service, cap])
}

# Deny device mappings
deny[msg] if {
  count(input.compose.services[service].devices) > 0
  msg := sprintf("BLOCKED: Service '%s' mounts host devices - this exposes hardware", [service])
}

# Deny unconfined security options
deny[msg] if {
  opt := input.compose.services[service].security_opt[_]
  contains(opt, "unconfined")
  msg := sprintf("BLOCKED: Service '%s' uses unconfined security option '%s'", [service, opt])
}

# Deny sysctls modifications
deny[msg] if {
  count(input.compose.services[service].sysctls) > 0
  msg := sprintf("BLOCKED: Service '%s' modifies kernel sysctls - this affects host kernel", [service])
}

# Deny userns_mode: host
deny[msg] if {
  input.compose.services[service].userns_mode == "host"
  msg := sprintf("BLOCKED: Service '%s' uses host user namespace", [service])
}

# Deny cgroup_parent (can escape cgroup limits)
deny[msg] if {
  input.compose.services[service].cgroup_parent
  msg := sprintf("BLOCKED: Service '%s' sets cgroup_parent - this can bypass resource limits", [service])
}

# Deny reserved subdomains
deny[msg] if {
  lower(input.metadata.name) in reserved_subdomains
  msg := sprintf("BLOCKED: Subdomain '%s' is reserved for platform use", [input.metadata.name])
}

# Deny subdomains that look like reserved patterns
deny[msg] if {
  name := lower(input.metadata.name)
  startswith(name, "admin-")
  msg := sprintf("BLOCKED: Subdomain '%s' matches reserved pattern 'admin-*'", [name])
}

deny[msg] if {
  name := lower(input.metadata.name)
  startswith(name, "api-")
  msg := sprintf("BLOCKED: Subdomain '%s' matches reserved pattern 'api-*'", [name])
}

deny[msg] if {
  name := lower(input.metadata.name)
  startswith(name, "internal-")
  msg := sprintf("BLOCKED: Subdomain '%s' matches reserved pattern 'internal-*'", [name])
}

# =============================================================================
# WARN RULES - These generate warnings but don't block
# =============================================================================

# Warn about missing health checks
warn[msg] if {
  not input.spec.healthCheck
  input.kind == "Application"
  msg := "WARNING: No health check defined - consider adding one for reliability"
}

# Warn about using latest tag
warn[msg] if {
  input.spec.source.type == "docker"
  input.spec.source.docker.tag == "latest"
  msg := "WARNING: Using 'latest' tag - this may cause unexpected updates"
}

# Warn about large resource requests
warn[msg] if {
  input.spec.resources.size == "L"
  msg := "WARNING: Large resource size requested - ensure this is necessary"
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

# Check if any deny rules triggered
is_denied if {
  count(deny) > 0
}

# Get all violations (deny + warn)
violations := deny | warn
