// One GPU test at a time on this machine: parallel headless Chromes on an
// integrated GPU lose their WebGL context and every number becomes garbage.
// mkdir is atomic, so the lock directory is the mutex; a lock older than five
// minutes is treated as abandoned.
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK = join(tmpdir(), "quest-gpu-test.lock");
const STALE_MS = 5 * 60_000;

export async function takeGpuLock() {
  for (;;) {
    try {
      mkdirSync(LOCK);
      process.on("exit", () => rmSync(LOCK, { recursive: true, force: true }));
      for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
      return;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmSync(LOCK, { recursive: true, force: true });
      } catch {
        // released between the two calls: try again
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
