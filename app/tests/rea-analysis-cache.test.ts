import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { rea } from "../src/engine/rea";
import { adoptToolchain } from "../src/engine/toolchain";
import { currentSettings, saveSettings } from "../src/settings/store";

const FIXTURES = join(import.meta.dir, "fixtures");
const OBJC_APP = join(FIXTURES, "PhotoFilter.app", "Contents", "MacOS", "PhotoFilter");
const SWIFT_TOOL = join(FIXTURES, "swift", "HistoryStore");
const cache = mkdtempSync(join(tmpdir(), "eleven-analysis-"));

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  saveSettings({ ...currentSettings(), cacheDir: cache });
});

test("a file Ghidra analyzed once opens again from its saved analysis, with the same functions", async () => {
  const first = await rea.listProcedures(OBJC_APP);
  await rea.listProcedures(SWIFT_TOOL);
  const packs = readdirSync(join(cache, "ghidra-analysis")).filter((name) => name.endsWith(".gzf"));
  expect(packs.length).toBe(2);
  const started = Date.now();
  const again = await rea.listProcedures(OBJC_APP);
  const reopenMs = Date.now() - started;
  expect(again).toEqual(first);
  expect(readdirSync(join(cache, "ghidra-analysis")).filter((name) => name.endsWith(".gzf")).length).toBe(2);
  console.log(`reopened from saved analysis in ${reopenMs} ms`);
}, 600_000);
