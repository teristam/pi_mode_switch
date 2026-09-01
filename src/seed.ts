import { access, copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

export async function ensureGlobalModesFile(agentDir: string, bundledPath: string): Promise<boolean> {
  const globalPath = join(agentDir, "modes.yaml");

  // Skip touching bundledPath entirely once the user already has a global file.
  try {
    await access(globalPath);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(agentDir, { recursive: true });
  try {
    // COPYFILE_EXCL guards the race between the access() check above and this copy.
    await copyFile(bundledPath, globalPath, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
