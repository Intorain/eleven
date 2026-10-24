import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { EMPTY_PROJECT, loadProject, updateProject } from "../src/engine/project";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { loadProgram } from "../src/workbench/program";
import { patchBytes } from "../src/workbench/patch";
import { rea } from "../src/engine/rea";

function ghidraBinary(os: string, match: (name: string) => boolean): string {
  const dir = join(process.env.GHIDRA_INSTALL_DIR ?? "", "GPL", "DemanglerGnu", "os", os);
  const file = existsSync(dir) ? readdirSync(dir).find(match) : undefined;
  if (!file) throw new Error(`no binary found in ${dir} to test with`);
  return join(dir, file);
}

async function fileOffset(path: string, address: string): Promise<number> {
  const reply = await rea.tool(path, "address_to_file_offset", { address });
  return (reply as { file_offset: number }).file_offset;
}

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  process.env.ELEVEN_EXPORT_DIR = mkdtempSync(join(tmpdir(), "eleven-patch-"));
});

test("M8: patches are recorded, accumulate, and the copy applies every one without touching the original", async () => {
  const target = prepareTarget(ghidraBinary("linux_x86_64", (name) => !name.includes(".")));
  const program = await loadProgram(target);
  updateProject(program.id, () => EMPTY_PROJECT, null);

  const fns = program.functions.slice(0, 2);
  if (fns.length < 2) throw new Error("need two functions");
  const [a, b] = fns as [typeof fns[0], typeof fns[0]];
  const before = readFileSync(program.path);
  const offA = await fileOffset(program.path, a.addr);
  const offB = await fileOffset(program.path, b.addr);
  const swapA = ((before[offA] ?? 0) ^ 0xff) & 0xff;

  const first = await patchBytes(program, [{ addr: a.addr, bytes: swapA.toString(16).padStart(2, "0") }]);
  expect(loadProject(program.id).patches.length).toBe(1);
  expect(readFileSync(first)[offA]).toBe(swapA);

  const out = await patchBytes(program, [{ addr: b.addr, bytes: "cc" }]);
  const patched = readFileSync(out);
  expect(loadProject(program.id).patches.length).toBe(2);
  expect(patched.length).toBe(before.length);
  expect(patched[offA]).toBe(swapA);
  expect(patched[offB]).toBe(0xcc);
  expect(readFileSync(program.path)[offA]).toBe(before[offA]);
}, 300_000);

test("M8: re-patching an address replaces it, and bad hex is refused in plain words", async () => {
  const target = prepareTarget(ghidraBinary("linux_x86_64", (name) => !name.includes(".")));
  const program = await loadProgram(target);
  updateProject(program.id, () => EMPTY_PROJECT, null);
  const addr = (program.functions[0] ?? { addr: "0x0" }).addr;

  await patchBytes(program, [{ addr, bytes: "90" }]);
  const out = await patchBytes(program, [{ addr, bytes: "cc" }]);
  const saved = loadProject(program.id).patches;
  expect(saved.length).toBe(1);
  expect(saved[0]?.bytes).toBe("cc");
  const off = await fileOffset(program.path, addr);
  expect(readFileSync(out)[off]).toBe(0xcc);

  await expect(patchBytes(program, [{ addr, bytes: "zz" }])).rejects.toThrow(/hex bytes/);
}, 300_000);
