import { describe, expect, it } from "vitest";
import { renderServices, servicesCommand } from "../src/commands/services.js";
import { AxiError } from "../src/errors.js";
import type { RailwayService } from "../src/scope.js";

// Shape captured from `railway service list --json` (railway 5.30.3), ids scrubbed.
const fixture: RailwayService[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "web",
    isLinked: false,
    source: { repo: null, image: "ghcr.io/acme/web:1.2.3" },
    status: "SUCCESS",
    latestDeployment: {
      id: "22222222-2222-2222-2222-222222222222",
      status: "SUCCESS",
      createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
    },
    url: "https://web-production-1234.up.railway.app",
    volumes: [{ name: "web-volume" }],
    regions: [{ name: "asia-southeast1" }],
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "worker",
    source: { repo: "acme/worker", image: null },
    status: "FAILED",
    latestDeployment: null,
    url: null,
  },
];

describe("renderServices", () => {
  it("renders one row per service with status, age, source, url", () => {
    const out = renderServices(fixture, { environment: "production" });
    expect(out).toContain("count: 2 services in production");
    expect(out).toContain(
      "services[2]{name,status,deployed,source,url,volumes}:",
    );
    expect(out).toContain(
      'web,SUCCESS,3d ago,"ghcr.io/acme/web:1.2.3","https://web-production-1234.up.railway.app",1',
    );
    expect(out).toContain("worker,FAILED,unknown,acme/worker,none,0");
    expect(out).toContain("railway-axi deployments --service <name>");
  });

  it("names the linked environment when none was given", () => {
    expect(renderServices(fixture, {})).toContain("in the linked environment");
  });

  it("renders an explicit empty state", () => {
    const out = renderServices([], { environment: "staging" });
    expect(out).toContain("services: 0 services in staging");
    expect(out).toContain("railway-axi status");
  });
});

describe("servicesCommand", () => {
  it("rejects --service by name before calling railway, pointing at deployments/logs", async () => {
    for (const args of [["--service", "web"], ["--service=web"]]) {
      const err = await servicesCommand(args).then(
        () => undefined,
        (e: unknown) => e as AxiError,
      );
      expect(err).toBeInstanceOf(AxiError);
      expect(err?.code).toBe("VALIDATION_ERROR");
      expect(err?.message).toContain("--service");
      expect(err?.suggestions.join(" ")).toContain("deployments --service");
    }
  });
});
