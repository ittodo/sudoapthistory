import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(repoRoot, "js/generated/typescript/nodostream_binary_refs.ts");
const outDir = resolve(repoRoot, "js/generated/browser");
const outFile = resolve(outDir, "nodostream_binary_refs.js");

function findEsbuild() {
  if (process.env.ESBUILD_BIN && existsSync(process.env.ESBUILD_BIN)) return process.env.ESBUILD_BIN;
  const candidates = [
    resolve(repoRoot, "node_modules/.bin/esbuild.cmd"),
    resolve(repoRoot, "node_modules/.bin/esbuild"),
    resolve("D:/Rust/polygen/tests/runners/typescript/node_modules/.bin/esbuild.cmd"),
    resolve("D:/Rust/polygen/tests/runners/typescript/node_modules/.bin/esbuild"),
  ];
  return candidates.find(existsSync);
}

if (!existsSync(entry)) {
  throw new Error(`Missing generated TypeScript entry: ${entry}`);
}

const esbuild = findEsbuild();
if (!esbuild) {
  throw new Error("esbuild not found. Set ESBUILD_BIN or install the PolyGen TypeScript runner dependencies.");
}

mkdirSync(outDir, { recursive: true });

const args = [
  entry,
  "--bundle",
  "--format=esm",
  "--platform=browser",
  "--target=es2020",
  "--legal-comments=none",
  `--outfile=${outFile}`,
];

if (process.platform === "win32" && esbuild.toLowerCase().endsWith(".cmd")) {
  execFileSync("cmd.exe", ["/c", esbuild, ...args], { cwd: repoRoot, stdio: "inherit" });
} else {
  execFileSync(esbuild, args, { cwd: repoRoot, stdio: "inherit" });
}

console.log(`[polygen] wrote browser bundle ${outFile}`);
