import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/railway.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/railway.js")>()),
  railwayJson: vi.fn(),
  railwayExec: vi.fn(),
}));

import { variablesCommand } from "../src/commands/variables.js";
import { railwayExec, railwayJson } from "../src/railway.js";

const json = vi.mocked(railwayJson);
const exec = vi.mocked(railwayExec);

const VARS = { ZED: "z-secret", API_KEY: "sk-secret", PORT: "8080" };

beforeEach(() => {
  json.mockReset();
  exec.mockReset();
});

describe("variables list", () => {
  it("prints sorted names and never a value", async () => {
    json.mockResolvedValue(VARS);
    const out = await variablesCommand(["list", "--service", "web"]);
    expect(json).toHaveBeenCalledWith(
      ["variable", "list", "--json", "--service=web"],
      { secret: true },
    );
    expect(out).toContain("count: 3 variables (service: web), values hidden");
    expect(out).toContain("variables[3]: API_KEY,PORT,ZED");
    for (const value of Object.values(VARS)) expect(out).not.toContain(value);
  });

  it("is the default when no subcommand is given", async () => {
    json.mockResolvedValue({});
    const out = await variablesCommand(["--service=web"]);
    expect(out).toContain("variables: 0 variables (service: web)");
  });

  it("resolves the service first when none was given", async () => {
    json
      .mockResolvedValueOnce([{ id: "s1", name: "api" }])
      .mockResolvedValueOnce(VARS);
    const out = await variablesCommand(["list"]);
    expect(json).toHaveBeenNthCalledWith(1, ["service", "list", "--json"]);
    expect(json).toHaveBeenNthCalledWith(
      2,
      ["variable", "list", "--json", "--service=api"],
      { secret: true },
    );
    expect(out).toContain("(service: api)");
  });

  it("forwards an explicit project, environment and service", async () => {
    // A uuid skips the `railway list` name lookup.
    const id = "0a0a0a0a-0000-4000-8000-000000000000";
    json.mockResolvedValueOnce({});
    await variablesCommand([
      "list",
      "--project",
      id,
      "--environment",
      "production",
      "--service",
      "web",
    ]);
    expect(json).toHaveBeenCalledWith(
      [
        "variable",
        "list",
        "--json",
        `--project=${id}`,
        "--environment=production",
        "--service=web",
      ],
      { secret: true },
    );
  });
});

describe("variables get", () => {
  it("prints the one value asked for and no other", async () => {
    json.mockResolvedValue(VARS);
    const out = await variablesCommand(["get", "PORT", "--service", "web"]);
    expect(out).toContain("name: PORT");
    expect(out).toContain('value: "8080"');
    expect(out).not.toContain("sk-secret");
    expect(out).not.toContain("z-secret");
  });

  it("fails NOT_FOUND for a missing name without leaking the others", async () => {
    json.mockResolvedValue(VARS);
    const error = await variablesCommand(["get", "NOPE", "--service", "web"])
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("requires a name", async () => {
    await expect(
      variablesCommand(["get", "--service", "web"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(json).not.toHaveBeenCalled();
  });
});

describe("variables set", () => {
  it("sets pairs, reports names only, and says a redeploy was triggered", async () => {
    exec.mockResolvedValue("ignored FLAG=true");
    const out = await variablesCommand([
      "set",
      "FLAG=true",
      "URL=https://x.test/?a=b",
      "--service",
      "web",
      "--environment",
      "production",
    ]);
    expect(exec).toHaveBeenCalledWith(
      [
        "variable",
        "set",
        "--environment=production",
        "--service=web",
        "--",
        "FLAG=true",
        "URL=https://x.test/?a=b",
      ],
      { secret: true, redact: ["true", "https://x.test/?a=b"] },
    );
    expect(out).toContain("set[2]: FLAG,URL");
    expect(out).toContain("service: web");
    expect(out).toContain("environment: production");
    expect(out).toContain("redeploy: triggered");
    expect(out).not.toContain("x.test");
  });

  it("passes --skip-deploys through and reports it", async () => {
    exec.mockResolvedValue("");
    const out = await variablesCommand([
      "set",
      "A=1",
      "--skip-deploys",
      "--service=web",
    ]);
    expect(exec).toHaveBeenCalledWith(
      ["variable", "set", "--skip-deploys", "--service=web", "--", "A=1"],
      { secret: true, redact: ["1"] },
    );
    expect(out).toContain("redeploy: skipped");
  });

  it("refuses to guess the service when the environment has several", async () => {
    json.mockResolvedValueOnce([
      { id: "s1", name: "web" },
      { id: "s2", name: "worker" },
    ]);
    await expect(variablesCommand(["set", "A=1"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      suggestions: expect.arrayContaining(["Services: web, worker"]),
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects a malformed pair before any railway call, naming only its position", async () => {
    await expect(
      variablesCommand(["set", "=secret", "--service", "web"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      variablesCommand(["set", "JUSTAKEY", "--service", "web"]),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^argument 1 of `variables set` is not/),
    });
    await expect(
      variablesCommand(["set", "--servce", "web", "--service", "web"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      variablesCommand(["set", "--service", "web"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("variables", () => {
  it("rejects an unknown subcommand and unknown flags", async () => {
    await expect(variablesCommand(["delete", "A"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      variablesCommand(["list", "--kv", "--service", "web"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(json).not.toHaveBeenCalled();
  });
});
