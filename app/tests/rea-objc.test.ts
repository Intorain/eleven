import { beforeAll, expect, mock, test } from "bun:test";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import * as binaryInfo from "../src/engine/binaryInfo";
import { adoptToolchain } from "../src/engine/toolchain";

mock.module("../src/engine/binaryInfo", () => ({ ...binaryInfo, hasObjcMessages: async (): Promise<boolean> => true }));

const { rea } = await import("../src/engine/rea");

const FIXTURES = join(import.meta.dir, "fixtures");

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
});

test("an objective-c app opens with ghidra's message analyzer skipped", async () => {
  const functions = await rea.listProcedures(join(FIXTURES, "PhotoFilter.app", "Contents", "MacOS", "PhotoFilter"));
  expect(functions.length).toBeGreaterThan(10);
}, 300_000);

test("a file wrongly taken for objective-c still opens, with the analyzer left on", async () => {
  const functions = await rea.listProcedures(join(FIXTURES, "swift", "HistoryStore"));
  expect(functions.length).toBeGreaterThan(10);
}, 300_000);
