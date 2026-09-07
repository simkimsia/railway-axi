import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/railway.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/railway.js")>()),
  railwayJson: vi.fn(),
  railwayNdjson: vi.fn(),
}));

import { deploymentsCommand } from "../src/commands/deployments.js";
import { logsCommand } from "../src/commands/logs.js";
import { railwayJson, railwayNdjson } from "../src/railway.js";

const json = vi.mocked(railwayJson);
const ndjson = vi.mocked(railwayNdjson);

beforeEach(() => {
  json.mockReset();
  ndjson.mockReset();
});

describe("deploymentsCommand", () => {
  it("passes an explicit --service straight through without listing services", async () => {
    json.mockResolvedValue([]);
    const out = await deploymentsCommand(["--service", "web", "--limit", "5"]);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith([
      "deployment",
      "list",
      "--json",
      "--limit",
      "5",
      "--service=web",
    ]);
    expect(out).toContain("deployments: 0 deployments (service: web)");
  });

  it("lists services first when none was given, then names the one it picked", async () => {
    json
      .mockResolvedValueOnce([{ id: "s1", name: "api" }])
      .mockResolvedValueOnce([]);
    const out = await deploymentsCommand([]);
    expect(json).toHaveBeenNthCalledWith(1, ["service", "list", "--json"]);
    expect(json).toHaveBeenNthCalledWith(2, [
      "deployment",
      "list",
      "--json",
      "--limit",
      "20",
      "--service=api",
    ]);
    expect(out).toContain("(service: api)");
  });
});

describe("logsCommand", () => {
  it("skips the service lookup when --service is explicit", async () => {
    ndjson.mockResolvedValue({ rows: [], skipped: 0 });
    await logsCommand(["--service=web", "--lines", "3"]);
    expect(json).not.toHaveBeenCalled();
    expect(ndjson).toHaveBeenCalledWith([
      "logs",
      "--json",
      "--lines",
      "3",
      "--service=web",
    ]);
  });

  it("skips the service lookup when a deployment id is given", async () => {
    ndjson.mockResolvedValue({ rows: [], skipped: 0 });
    await logsCommand(["--build", "dep-1"]);
    expect(json).not.toHaveBeenCalled();
    expect(ndjson).toHaveBeenCalledWith([
      "logs",
      "--json",
      "--lines",
      "100",
      "--build",
      "dep-1",
    ]);
  });
});
