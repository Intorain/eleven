import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reaToolFamilies } from "../src/agents/session";

const FIXTURES = join(import.meta.dir, "fixtures");

test("a native binary or Mac app gets REA's native families and none of the Android or browser ones", () => {
  const families = reaToolFamilies(join(FIXTURES, "PhotoFilter.app", "Contents", "MacOS", "PhotoFilter")).split(",");
  expect(families).toContain("direct");
  expect(families).toContain("enhanced");
  expect(families).toContain("session");
  expect(families).not.toContain("android");
  expect(families).not.toContain("adb");
  expect(families).not.toContain("browser");
  expect(families).not.toContain("electron");
});

test("an Android app adds the Android families on top of the native ones", () => {
  const families = reaToolFamilies(join(FIXTURES, "android", "hello.apk")).split(",");
  expect(families).toContain("direct");
  expect(families).toContain("android");
  expect(families).toContain("apktool");
  expect(families).toContain("adb");
  expect(families).not.toContain("browser");
});

test("an Electron app adds the Electron and browser families", () => {
  const app = join(mkdtempSync(join(tmpdir(), "eleven-electron-")), "Notes.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents", "Frameworks", "Electron Framework.framework"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "Notes"), "");
  const families = reaToolFamilies(join(app, "Contents", "MacOS", "Notes")).split(",");
  expect(families).toContain("electron");
  expect(families).toContain("browser");
  expect(families).toContain("javascript-runtime");
  expect(families).not.toContain("android");
});

test("a chat with no file yet keeps the families any first file could need", () => {
  const families = reaToolFamilies(null).split(",");
  expect(families).toContain("android");
  expect(families).toContain("electron");
  expect(families).not.toContain("adb");
});
