// Start the FastAPI backend with the project's .venv Python (auto-reload on backend changes).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { root, venvPython, pythonEnv } from "./venv.mjs";

const python = venvPython();
const port = process.env.SHOAL_API_PORT || "8765";

// A backend left over from an earlier run (e.g. the terminal was killed) keeps the port; say how to free it
// instead of letting uvicorn fail with a bare "address already in use".
const free = await new Promise((ok) => {
  const srv = createServer().once("error", () => ok(false)).once("listening", () => srv.close(() => ok(true)));
  srv.listen(Number(port), "127.0.0.1");
});
if (!free) {
  const killHint = process.platform === "win32"
    ? `for /f "tokens=5" %p in ('netstat -ano ^| findstr LISTENING ^| findstr :${port}') do taskkill /F /T /PID %p`
    : `lsof -ti tcp:${port} | xargs kill`;
  console.error(`[api] 端口 ${port} 已被占用，多半是上次没关干净的后端。运行下面这行结束它，再重新 pnpm dev：\n      ${killHint}`);
  process.exit(1);
}
console.log(`[api] ${python}  →  http://127.0.0.1:${port}`);
const child = spawn(
  python,
  ["-m", "uvicorn", "shoal.server:app", "--host", "127.0.0.1", "--port", port, "--reload", "--reload-dir", "shoal", "--timeout-graceful-shutdown", "2"],
  // own process group (macOS/Linux), so the reloader and its worker can be stopped together
  { cwd: join(root, "backend"), stdio: "inherit", env: pythonEnv, detached: process.platform !== "win32" },
);
// Windows has no SIGTERM: kill the whole tree (uvicorn's reloader plus its worker), or the worker keeps the port.
// Elsewhere: SIGTERM to the group, then SIGKILL after 5 s. uvicorn's --reload supervisor can hang in waitpid on
// shutdown and ignore SIGTERM, which used to leave a backend holding the port after `pnpm dev` was closed.
let stopping = false;
const stop = () => {
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const signal = (sig) => { try { process.kill(-child.pid, sig); } catch { /* already gone */ } };
  if (!stopping) {
    stopping = true;
    signal("SIGTERM");
    setTimeout(() => signal("SIGKILL"), 5000).unref();
  }
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, stop);
// If whatever started us is killed outright we never get a signal; take the backend down with us rather than
// leaving it holding the port. (Checking that the parent still exists works on every OS; on Windows a dead
// parent's pid is not replaced by init's, so comparing process.ppid would not notice.)
const parent = process.ppid;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
setInterval(() => { if (!alive(parent)) stop(); }, 2000).unref();
child.on("exit", (code) => {
  if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already gone */ } }
  process.exit(code ?? 0);
});
