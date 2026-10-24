import { run, start, startWith } from "../../src/lib/process";

start("/bin/sh", ["-c", "sleep 600 & wait"]);
startWith("/bin/sleep", ["601"], { stdio: "ignore" });
const left = startWith("/bin/sleep", ["602"], { detached: true, stdio: "ignore" });
run("/bin/sleep", ["603"]).catch(() => undefined);
const quick = start("/bin/sh", ["-c", "exit 0"]);
await new Promise((resolve) => quick.once("exit", resolve));

process.stdout.write(`${JSON.stringify({ left: left.pid })}\n`);
if (process.argv.includes("--exit")) process.exit(0);
setInterval(() => undefined, 1000);
