import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ensureGlobalModesFile } from "../src/seed.ts";

function tempRoot(name: string): string {
  return join(tmpdir(), `pi-mode-switch-${name}-${process.pid}-${Date.now()}-${Math.random()}`);
}

test("ensureGlobalModesFile creates the global file from the bundled template", async () => {
  const root = tempRoot("seed");
  const agentDir = join(root, "nested", "agent");
  const bundledPath = join(root, "modes.yaml");
  const bundled = "version: 1\ndefaultMode: plan\nmodes: {}\n";
  await mkdir(root, { recursive: true });
  await writeFile(bundledPath, bundled, "utf8");

  assert.equal(await ensureGlobalModesFile(agentDir, bundledPath), true);
  assert.equal(await readFile(join(agentDir, "modes.yaml"), "utf8"), bundled);
});

test("ensureGlobalModesFile preserves an existing global file", async () => {
  const root = tempRoot("existing");
  const agentDir = join(root, "agent");
  const bundledPath = join(root, "modes.yaml");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "modes.yaml"), "user config\n", "utf8");

  assert.equal(await ensureGlobalModesFile(agentDir, bundledPath), false);
  assert.equal(await readFile(join(agentDir, "modes.yaml"), "utf8"), "user config\n");
});

test("ensureGlobalModesFile reports a missing bundled template", async () => {
  const root = tempRoot("missing");
  await assert.rejects(
    () => ensureGlobalModesFile(join(root, "agent"), join(root, "missing-modes.yaml")),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
  );
  await assert.rejects(() => access(join(root, "agent", "modes.yaml")), { code: "ENOENT" });
});
