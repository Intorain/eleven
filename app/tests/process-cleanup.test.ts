import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, test } from "bun:test";

const OWNER = join(import.meta.dir, "fixtures", "processOwner.ts");
const GONE_WITHIN_MS = 6000;

type Started = { readonly owner: number; readonly tied: readonly number[]; readonly left: number };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function descendants(pid: number): readonly number[] {
  const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  return children.flatMap((child) => [child, ...descendants(child)]);
}

async function startOwner(args: readonly string[]): Promise<Started> {
  const owner = spawn(process.execPath, [OWNER, ...args], { stdio: ["ignore", "pipe", "inherit"] });
  for await (const line of createInterface({ input: owner.stdout })) {
    const { left }: { left: number } = JSON.parse(line);
    const pid = owner.pid ?? 0;
    return { owner: pid, tied: descendants(pid).filter((child) => child !== left), left };
  }
  throw new Error("The owner process printed nothing.");
}

async function allGone(pids: readonly number[]): Promise<boolean> {
  const until = Date.now() + GONE_WITHIN_MS;
  while (Date.now() < until) {
    if (pids.every((pid) => !alive(pid))) return true;
    await Bun.sleep(100);
  }
  return false;
}

test.skipIf(process.platform === "win32")("a force quit stops every program Eleven started, and their children", async () => {
  const started = await startOwner([]);
  expect(started.tied.length).toBe(5);
  expect(started.tied.every(alive)).toBe(true);
  process.kill(started.owner, "SIGKILL");
  expect(await allGone(started.tied)).toBe(true);
  expect(alive(started.left)).toBe(true);
  process.kill(started.left, "SIGKILL");
}, 15000);

test.skipIf(process.platform === "win32")("a normal quit stops them too", async () => {
  const started = await startOwner(["--exit"]);
  expect(await allGone([started.owner, ...started.tied])).toBe(true);
  expect(alive(started.left)).toBe(true);
  process.kill(started.left, "SIGKILL");
}, 15000);

test.skipIf(process.platform === "win32")("a script whose programs finished still exits on its own", () => {
  const script = `import { start } from ${JSON.stringify(join(import.meta.dir, "..", "src", "lib", "process"))}; start("/bin/sh", ["-c", "exit 0"]);`;
  const ran = spawnSync(process.execPath, ["-e", script], { timeout: 10000 });
  expect(ran.signal).toBeNull();
  expect(ran.status).toBe(0);
}, 15000);
