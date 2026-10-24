import { type ChildProcess, spawn } from "node:child_process";

/**
 * Reads `+pid` and `-pid` lines until Eleven's end of the pipe closes, which happens however Eleven ends,
 * force quit included. Then it stops every program still listed and everything those programs started.
 */
const SCRIPT = `
trap '' INT HUP
pids=" "
while IFS= read -r line; do
  id="\${line#?}"
  case "$line" in
    +*) pids="$pids$id " ;;
    -*) case "$pids" in *" $id "*) pids="\${pids%% $id *} \${pids#* $id }" ;; esac ;;
  esac
done
all=""
tree() { for c in $(pgrep -P "$1" 2>/dev/null); do tree "$c"; done; all="$all $1"; }
for p in $pids; do tree "$p"; done
[ -n "$all" ] || exit 0
kill -TERM $all 2>/dev/null
sleep 2
kill -KILL $all 2>/dev/null
exit 0
`;

let reaper: ChildProcess | null = null;

function started(): ChildProcess | null {
  if (reaper) return reaper;
  if (process.platform === "win32") return null;
  const child = spawn("/bin/sh", ["-c", SCRIPT], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
  child.on("error", () => undefined);
  child.on("exit", () => {
    if (reaper === child) reaper = null;
  });
  child.unref();
  const stdin = child.stdin;
  stdin?.on("error", () => undefined);
  if (stdin && "unref" in stdin && typeof stdin.unref === "function") stdin.unref();
  reaper = child;
  return child;
}

/** Ties a program to this Eleven process: when Eleven ends, however it ends, the program and its own children end too. */
export function tie(pid: number | undefined): () => void {
  if (pid === undefined) return () => undefined;
  const stdin = started()?.stdin;
  stdin?.write(`+${pid}\n`);
  let tied = true;
  return () => {
    if (!tied) return;
    tied = false;
    if (reaper?.stdin === stdin) stdin?.write(`-${pid}\n`);
  };
}

/** The same for a child Eleven started itself, untied once it exits on its own. */
export function tieChild<T extends ChildProcess>(child: T): T {
  child.once("exit", tie(child.pid));
  return child;
}
