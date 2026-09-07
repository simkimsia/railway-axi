import { describe, expect, it } from "vitest";
import { LOGS_MESSAGE_MAX, renderLogs } from "../src/commands/logs.js";
import { parseNdjson } from "../src/railway.js";

// Captured from `railway logs --json --lines 3` (railway 5.30.3); key order
// varies per line in the real output, which is why this goes through NDJSON.
const raw = [
  '{"message":"HTTP Request: GET https://example.test/rest/v1/jobs \\"HTTP/1.1 200 OK\\"","name":"httpx","level":"info","timestamp":"2026-09-07 01:09:06,427"}',
  '{"timestamp":"2026-09-07 01:09:11,490","name":"httpx","level":"warn","message":"retrying"}',
  "",
].join("\n");

describe("renderLogs", () => {
  it("renders time, level and message with the kind and service in the header", () => {
    const out = renderLogs(parseNdjson(raw), {
      kind: "deploy",
      lines: 100,
      scope: { service: "web", environment: "production" },
    });
    expect(out).toContain(
      "count: 2 lines (kind: deploy, service: web, env: production)",
    );
    expect(out).toContain("logs[2]{time,level,message}:");
    expect(out).toContain('"2026-09-07 01:09:11,490",warn,retrying');
    expect(out).not.toContain("Showing the newest");
  });

  it("says when the page is full so the agent knows there may be more", () => {
    const out = renderLogs(parseNdjson(raw), {
      kind: "deploy",
      lines: 2,
      scope: {},
    });
    expect(out).toContain("Showing the newest 2 of possibly more lines");
  });

  it("truncates long messages and flattens newlines", () => {
    const long = "x".repeat(LOGS_MESSAGE_MAX + 50);
    const out = renderLogs(
      {
        rows: [{ timestamp: "t", level: "info", message: `a\nb ${long}` }],
        skipped: 0,
      },
      { kind: "deploy", lines: 100, scope: {} },
    );
    expect(out).toContain("a ⏎ b ");
    expect(out).toContain("…");
    expect(out).not.toContain(long);
  });

  it("renders http records as method, path, status, duration", () => {
    // Shape captured from `railway logs --http --json` (railway 5.30.3).
    const http =
      '{"timestamp":"2026-09-07T01:13:37.625544211Z","method":"POST","path":"/github/app/webhook","httpStatus":200,"totalDuration":143,"srcIp":"10.0.0.1","requestId":"r1"}';
    const out = renderLogs(parseNdjson(http), {
      kind: "http",
      lines: 100,
      scope: { service: "web" },
    });
    expect(out).toContain("logs[1]{time,method,path,status,ms}:");
    expect(out).toContain(
      '"2026-09-07T01:13:37.625544211Z",POST,/github/app/webhook,200,143',
    );
    expect(out).not.toContain("srcIp");
  });

  it("reports skipped unparseable lines in the header", () => {
    const out = renderLogs(parseNdjson('{"message":"ok"}\ngarbage'), {
      kind: "http",
      lines: 100,
      scope: {},
    });
    expect(out).toContain("count: 1 lines (kind: http), 1 unparseable skipped");
  });

  it("explains an empty --build result for image deploys", () => {
    const out = renderLogs(
      { rows: [], skipped: 0 },
      { kind: "build", lines: 100, scope: {}, deploymentId: "dep-1" },
    );
    expect(out).toContain(
      "logs: 0 lines (kind: build, deployment: dep-1) (build logs are empty for image-based deploys)",
    );
    expect(out).toContain("Drop `--build`/`--http`");
  });

  it("uses a plain empty state for deploy logs", () => {
    const out = renderLogs(
      { rows: [], skipped: 0 },
      { kind: "deploy", lines: 100, scope: {} },
    );
    expect(out).toContain("logs: 0 lines (kind: deploy)");
    expect(out).not.toContain("image-based");
  });
});
