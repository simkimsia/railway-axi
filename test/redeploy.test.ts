import { beforeEach, describe, expect, it, vi } from "vitest";

// Every railway call is mocked: no test here may reach a real redeploy.
vi.mock("../src/railway.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/railway.js")>()),
  railwayJson: vi.fn(),
  railwayExec: vi.fn(),
  railwayNdjson: vi.fn(),
  // Mocked too: the real one calls railway.ts's own railwayJson, which the
  // mock above cannot reach, and would spawn `railway list`.
  resolveProjectId: vi.fn(),
}));

import { redeployCommand, renderRedeploy } from "../src/commands/redeploy.js";
import { AxiError, mapRailwayError } from "../src/errors.js";
import { railwayJson, resolveProjectId } from "../src/railway.js";

const json = vi.mocked(railwayJson);
const resolveProject = vi.mocked(resolveProjectId);

const NEW_ID = "1b1b1b1b-0000-4000-8000-000000000000";
const PROJECT_ID = "0a0a0a0a-0000-4000-8000-000000000000";

beforeEach(() => {
  json.mockReset();
  resolveProject.mockReset();
});

describe("redeploy", () => {
  it("redeploys an explicit service non-interactively and reports the new deployment", async () => {
    json.mockResolvedValueOnce({ id: NEW_ID }).mockResolvedValueOnce([
      {
        id: NEW_ID,
        status: "BUILDING",
        createdAt: null,
        meta: { image: "ghcr.io/acme/web:1.2.3" },
      },
    ]);
    const out = await redeployCommand(["--service", "web"]);
    expect(json).toHaveBeenNthCalledWith(1, [
      "redeploy",
      "--yes",
      "--json",
      "--service=web",
    ]);
    expect(json).toHaveBeenNthCalledWith(2, [
      "deployment",
      "list",
      "--json",
      "--limit",
      "5",
      "--service=web",
    ]);
    expect(out).toContain("service: web");
    expect(out).toContain("mode: latest");
    expect(out).toContain(`deployment: ${NEW_ID}`);
    expect(out).toContain("status: BUILDING");
    expect(out).toContain('origin: "ghcr.io/acme/web:1.2.3"');
    expect(out).toContain("railway-axi deployments --service web --limit 1");
    expect(out).toContain(`railway-axi logs --build ${NEW_ID}`);
  });

  it("forwards --from-source and does not guess an id railway did not return", async () => {
    json.mockResolvedValueOnce({ success: true });
    const out = await redeployCommand([
      "--from-source",
      "--service=web",
      "--environment",
      "production",
    ]);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith([
      "redeploy",
      "--yes",
      "--json",
      "--from-source",
      "--environment=production",
      "--service=web",
    ]);
    expect(out).toContain("mode: from-source");
    expect(out).toContain("status: triggered");
    expect(out).not.toContain("deployment:");
    expect(out).toContain(
      "railway-axi deployments --service web --environment production --limit 1",
    );
  });

  it("resolves a project name to its id, which railway redeploy requires", async () => {
    resolveProject.mockResolvedValueOnce(PROJECT_ID);
    json.mockResolvedValueOnce({ id: NEW_ID }).mockResolvedValueOnce([]);
    await redeployCommand([
      "--project",
      "my-app",
      "--environment",
      "production",
      "--service",
      "web",
    ]);
    expect(resolveProject).toHaveBeenCalledWith("my-app");
    expect(json).toHaveBeenNthCalledWith(1, [
      "redeploy",
      "--yes",
      "--json",
      `--project=${PROJECT_ID}`,
      "--environment=production",
      "--service=web",
    ]);
  });

  it("picks the one service when none was given", async () => {
    json
      .mockResolvedValueOnce([{ id: "s1", name: "api" }])
      .mockResolvedValueOnce({ id: NEW_ID })
      .mockResolvedValueOnce([]);
    const out = await redeployCommand([]);
    expect(json).toHaveBeenNthCalledWith(1, ["service", "list", "--json"]);
    expect(json).toHaveBeenNthCalledWith(2, [
      "redeploy",
      "--yes",
      "--json",
      "--service=api",
    ]);
    expect(out).toContain("service: api");
  });

  it("refuses to guess the service when the environment has several", async () => {
    json.mockResolvedValueOnce([
      { id: "s1", name: "web" },
      { id: "s2", name: "worker" },
    ]);
    await expect(redeployCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      suggestions: expect.arrayContaining(["Services: web, worker"]),
    });
    expect(json).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown flag before any railway call", async () => {
    await expect(
      redeployCommand(["--service", "web", "--commit", "abc1234"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(json).not.toHaveBeenCalled();
  });

  it("requires --environment with --project before any railway call", async () => {
    await expect(
      redeployCommand(["--project", "my-app", "--service", "web"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(json).not.toHaveBeenCalled();
  });

  it("still reports success when the follow-up deployment read fails", async () => {
    json
      .mockResolvedValueOnce({ id: NEW_ID })
      .mockRejectedValueOnce(new AxiError("boom", "UNKNOWN"));
    const out = await redeployCommand(["--service=web"]);
    expect(out).toContain(`deployment: ${NEW_ID}`);
    expect(out).toContain("status: triggered");
  });

  it("adds a next step when the latest deployment cannot be redeployed", async () => {
    // Text from railway's redeploy.rs `bail!`, run through the real mapper.
    json.mockRejectedValueOnce(
      mapRailwayError(
        "The latest deployment for service web cannot be redeployed. This may be because it's currently building, deploying, or was removed.",
        1,
      ),
    );
    await expect(redeployCommand(["--service=web"])).rejects.toMatchObject({
      message: expect.stringContaining("cannot be redeployed"),
      suggestions: expect.arrayContaining([
        "Run `railway-axi deployments --service web --limit 1` to see its status, and retry once it has finished",
      ]),
    });
  });

  it("keeps the project and environment in every refusal hint", async () => {
    resolveProject.mockResolvedValueOnce(PROJECT_ID);
    json.mockRejectedValueOnce(
      mapRailwayError(
        "The latest deployment for service web cannot be redeployed. This may be because it's currently building, deploying, or was removed.",
        1,
      ),
    );
    await expect(
      redeployCommand([
        "--project",
        "my-app",
        "--environment",
        "staging",
        "--service",
        "web",
      ]),
    ).rejects.toMatchObject({
      suggestions: [
        `Run \`railway-axi deployments --service web --project ${PROJECT_ID} --environment staging --limit 1\` to see its status, and retry once it has finished`,
        `Or run \`railway-axi redeploy --service web --project ${PROJECT_ID} --environment staging --from-source\` to deploy from the source instead`,
      ],
    });
  });

  it("points a never-deployed service at --from-source", async () => {
    json.mockRejectedValueOnce(
      mapRailwayError("No deployment found for service", 1),
    );
    await expect(redeployCommand(["--service=web"])).rejects.toMatchObject({
      code: "NOT_FOUND",
      suggestions: [
        "The service has never deployed; run `railway-axi redeploy --service web --from-source` to deploy its source",
      ],
    });
  });
});

describe("renderRedeploy", () => {
  it("scopes the build-logs hint to the redeployed target", () => {
    const out = renderRedeploy(
      { id: NEW_ID },
      { service: "web", project: PROJECT_ID, environment: "staging" },
      false,
    );
    expect(out).toContain(
      `railway-axi logs --build ${NEW_ID} --service web --project ${PROJECT_ID} --environment staging`,
    );
  });

  it("falls back to triggered with no deployment row", () => {
    const out = renderRedeploy({ id: NEW_ID }, { service: "web" }, false);
    expect(out).toContain("status: triggered");
    expect(out).not.toContain("origin:");
  });
});
