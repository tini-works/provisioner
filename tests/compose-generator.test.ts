import { test, expect } from "bun:test";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateComposeBundle } from "../scripts/lib/compose/generator";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "apps"
);

const baseOptions = {
  appsRoot: fixturesRoot,
  domainSuffix: "apps.quickable.co",
  uiHost: "p.apps.quickable.co",
  traefikImage: "traefik:v2.11",
};

test("compose output is deterministic", () => {
  const first = generateComposeBundle(baseOptions).yaml;
  const second = generateComposeBundle(baseOptions).yaml;
  expect(first).toBe(second);
});

test("apps are isolated on internal networks", () => {
  const { compose } = generateComposeBundle(baseOptions);
  const networks = compose.networks || {};
  expect(networks["app-app-a"]).toEqual({ internal: true });
  expect(networks["app-app-b"]).toEqual({ internal: true });

  const appA = compose.services["app-a"];
  const appB = compose.services["app-b"];
  expect(appA.networks).toEqual(["app-app-a"]);
  expect(appB.networks).toEqual(["app-app-b"]);

  const traefik = compose.services["traefik"];
  expect(traefik.networks).toContain("app-app-a");
  expect(traefik.networks).toContain("app-app-b");
  expect(traefik.networks).toContain("public");
});

test("traefik labels include host routing and healthchecks", () => {
  const { compose } = generateComposeBundle(baseOptions);
  const appA = compose.services["app-a"];
  const labels = (appA.labels || []).join("\n");
  expect(labels).toContain("Host(`app-a-p.apps.quickable.co`)");
  expect(labels).toContain("loadbalancer.healthcheck.path=/healthz");
});

test("ui host override routes to p.apps.quickable.co", () => {
  const { compose } = generateComposeBundle(baseOptions);
  const ui = compose.services["provisioner-ui"];
  const labels = (ui.labels || []).join("\n");
  expect(labels).toContain("Host(`p.apps.quickable.co`)");
});
