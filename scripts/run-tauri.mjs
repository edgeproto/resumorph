/**
 * Run the Tauri CLI with ~/.cargo/bin on PATH (fixes "cargo: program not found"
 * in Git Bash / terminals where Rust wasn't added to PATH).
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const cargoBin = join(homedir(), ".cargo", "bin");
const sep = process.platform === "win32" ? ";" : ":";
const pathKey = process.platform === "win32" ? "Path" : "PATH";
const env = { ...process.env };
env[pathKey] = `${cargoBin}${sep}${env[pathKey] ?? ""}`;

const args = process.argv.slice(2);
const child = spawn("tauri", args, {
  stdio: "inherit",
  shell: true,
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
