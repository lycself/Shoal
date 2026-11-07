// Start the FastAPI backend with the conda environment's Python (auto-reload on backend changes).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.SHOAL_PYTHON,
  process.env.COASTAL_ENV && join(process.env.COASTAL_ENV, "bin", "python"),
  join(homedir(), "opt", "anaconda3", "envs", "coastal", "bin", "python"),
  join(homedir(), "miniconda3", "envs", "coastal", "bin", "python"),
  join(homedir(), "anaconda3", "envs", "coastal", "bin", "python"),
  join(homedir(), "mamba", "envs", "coastal", "bin", "python"),
  join(homedir(), "micromamba", "envs", "coastal", "bin", "python"),
].filter(Boolean);
const python = candidates.find((p) => existsSync(p));
if (!python) {
  console.error("[api] 找不到 coastal 环境的 Python。请先运行 `pnpm setup:env`，或设置环境变量 SHOAL_PYTHON 指向 Python。");
  process.exit(1);
}
const port = process.env.SHOAL_API_PORT || "8765";
console.log(`[api] ${python}  →  http://127.0.0.1:${port}`);
const child = spawn(
  python,
  ["-m", "uvicorn", "shoal.server:app", "--host", "127.0.0.1", "--port", port, "--reload", "--reload-dir", "shoal", "--timeout-graceful-shutdown", "2"],
  { cwd: join(root, "backend"), stdio: "inherit", env: { ...process.env, PYTHONUNBUFFERED: "1" } },
);
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
