import { describe, expect, it } from "vitest";
import {
  DEPLOYMENTS_LIMIT_MAX,
  renderDeployments,
  type RailwayDeployment,
} from "../src/commands/deployments.js";

// Shape captured from `railway deployment list --json` (railway 5.30.3), ids scrubbed.
const image: RailwayDeployment = {
  id: "f5a425d0-b73b-4535-9b77-33a58038686b",
  status: "SUCCESS",
  createdAt: new Date(Date.now() - 4 * 86400_000).toISOString(),
  meta: { image: "ghcr.io/acme/web:1.2.3", reason: "deploy" },
};
const commit: RailwayDeployment = {
  id: "0a0a0a0a-0000-0000-0000-000000000000",
  status: "FAILED",
  createdAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
  meta: { reason: "push", branch: "main", commitHash: "abcdef1234567" },
};

describe("renderDeployments", () => {
  it("renders id, status, age, reason and origin with the service in the header", () => {
    const out = renderDeployments([image, commit], {
      service: "web",
      environment: "production",
    });
    expect(out).toContain(
      "count: 2 deployments (service: web, env: production)",
    );
    expect(out).toContain("deployments[2]{id,status,created,reason,origin}:");
    expect(out).toContain(
      `${image.id},SUCCESS,4d ago,deploy,"ghcr.io/acme/web:1.2.3"`,
    );
    expect(out).toContain(`${commit.id},FAILED,5h ago,push,main@abcdef1`);
    expect(out).toContain("railway-axi logs <deployment-id>");
  });

  it("falls back to unknown when meta is missing", () => {
    const out = renderDeployments(
      [{ id: "x", status: "REMOVED", createdAt: null }],
      { service: "web" },
    );
    expect(out).toContain("x,REMOVED,unknown,unknown,unknown");
  });

  it("renders an explicit empty state", () => {
    const out = renderDeployments([], { service: "web" });
    expect(out).toContain("deployments: 0 deployments (service: web)");
  });

  it("caps the page size for agents", () => {
    expect(DEPLOYMENTS_LIMIT_MAX).toBe(100);
  });
});
