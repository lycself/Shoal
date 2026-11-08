// The project's Python lives in <repo>/.venv (created with `python -m venv .venv`, see README).
// `node scripts/venv.mjs <script.py> [args…]` runs a script with it, e.g. `pnpm kernel` → kernel/build.py.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function venvPython() {
  const candidates = [
    process.env.SHOAL_PYTHON,
    join(root, ".venv", "bin", "python"),
    join(root, ".venv", "Scripts", "python.exe"),
  ].filter(Boolean);
  const python = candidates.find((p) => existsSync(p));
  if (!python) {
    console.error("找不到项目的 .venv。请先用 Python 3.11 运行：python -m venv .venv ，再安装依赖（见 README）");
    process.exit(1);
  }
  return python;
}

// UTF-8 mode: on Windows Python otherwise reads and writes text files in the locale code page (e.g. GBK).
export const pythonEnv = { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [script, ...args] = process.argv.slice(2);
  const child = spawn(venvPython(), [join(root, script), ...args], { cwd: root, stdio: "inherit", env: pythonEnv });
  child.on("exit", (code) => process.exit(code ?? 1));
}
