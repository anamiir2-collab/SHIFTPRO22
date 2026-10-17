import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "www");

const excluded = new Set([
  ".git",
  ".github",
  "node_modules",
  "www",
  "android",
  "coverage",
  "tests",
  "scripts",
]);

const excludedFiles = new Set([
  "package.json",
  "package-lock.json",
  "capacitor.config.json",
  "0001-release-prepare-ShiftPro-for-Google-Play-prod.patch",
  "shiftpro-release-play-production.bundle",
]);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (excluded.has(entry.name) || excludedFiles.has(entry.name)) continue;
  if (entry.name.endsWith(".md") || entry.name.endsWith(".patch") || entry.name.endsWith(".bundle")) continue;

  await cp(
    path.join(root, entry.name),
    path.join(destination, entry.name),
    { recursive: true, force: true }
  );
}

console.log("Prepared static ShiftPro web assets in ./www");
