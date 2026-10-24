import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ReactElement } from "react";

import { adoptLoginShell } from "../src/agents/detect";
import { type Chat, useChat } from "../src/chat/useChat";
import { swiftTypes } from "../src/engine/swiftTypes";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { arrange, forgetArrangement } from "../src/workbench/arrange";
import { loadProgram } from "../src/workbench/program";
import { sourceFiles } from "../src/workbench/sources";
import { Screen } from "./harness";

const CALCULATOR = prepareTarget("/System/Applications/Calculator.app");
let screen: Screen;
let chat: Chat | null = null;

function Live(): ReactElement {
  chat = useChat(CALCULATOR, () => {});
  return <div>{`agent=${chat.agents.selected.name}`}</div>;
}

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  screen = new Screen().render(<Live />);
});

afterAll(() => screen.unmount());

test("Calculator arranges into folders: evidence places the code, the agent names the folders", async () => {
  await screen.until(() => chat !== null, 10_000);
  const live = chat;
  if (!live) throw new Error("no chat");
  const program = await loadProgram(CALCULATOR);
  const types = await swiftTypes(program.path, program.arch);
  const agent = live.agents.selected;
  await forgetArrangement(program.id);
  const started = Date.now();
  const steps: string[] = [];
  const result = await arrange({
    ask: { agent, native: live.agents.installed.get(agent.id)?.command ?? null, projectId: program.id, binary: { path: program.path } },
    binaryName: program.name,
    functions: program.functions,
    types,
    sources: sourceFiles(program.strings.map((row) => row.b), types),
    onStep: (next) => steps.push(next.map((s) => `${s.done ? "✓" : "…"} ${s.label}`).join(" | ")),
  });
  const folders = new Set(result.files.map((file) => file.path.split("/").slice(0, -1).join("/")));
  console.log({ ms: Date.now() - started, files: result.files.length, folders: [...folders].sort(), unplaced: result.unplaced.length });
  console.log(steps.at(-1));
  expect(result.files.length).toBeGreaterThan(50);
  expect(folders.size).toBeGreaterThan(2);
}, 400_000);
