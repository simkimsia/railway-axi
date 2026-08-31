import { execFile } from "node:child_process";
import {
  AxiError,
  mapRailwayError,
  railwayNotInstalledError,
} from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "railway",
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
          return;
        }
        const exitCode = error
          ? ((error as Error & { code?: string | number }).code ?? 1)
          : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof exitCode === "number" ? exitCode : 1,
        });
      },
    );
  });
}

/** Execute railway and return parsed JSON. */
export async function railwayJson<T = unknown>(args: string[]): Promise<T> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw railwayNotInstalledError();
  if (result.exitCode !== 0) {
    throw mapRailwayError(result.stderr || result.stdout, result.exitCode);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new AxiError(
      `Unexpected railway output: ${result.stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

/** Execute railway and return raw stdout. */
export async function railwayExec(args: string[]): Promise<string> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw railwayNotInstalledError();
  if (result.exitCode !== 0) {
    throw mapRailwayError(result.stderr || result.stdout, result.exitCode);
  }
  return result.stdout;
}
