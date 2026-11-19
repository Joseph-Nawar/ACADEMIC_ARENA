import { cp, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(new RegExp(sep + "scripts$"), "");
const args = process.argv.slice(2);
function option(name, fallback) {
  const equal = args.find((arg) => arg.startsWith(name + "="));
  if (equal) return equal.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const mode = option("--mode", "production");
const outDir = resolve(root, option("--out-dir", join(root, "dist")));
if (!["demo", "production"].includes(mode)) {
  throw new Error("Build mode must be demo or production.");
}
if (mode === "demo" && process.env.CF_PAGES) {
  throw new Error("Demo builds are disabled on Cloudflare Pages.");
}
if (mode === "demo" && !args.includes("--allow-demo-output")) {
  throw new Error("Demo output requires an explicit local demo opt-in.");
}
if (outDir === root || outDir.startsWith(root + sep) === false) {
  throw new Error("Build output must be a child of the project root.");
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await copyFile(join(root, "index.html"), join(outDir, "index.html"));
await copyFile(join(root, "public", "_headers"), join(outDir, "_headers"));

const sourceAssets = join(root, "assets");
const targetAssets = join(outDir, "assets");
const packagedRootAssets = new Set(["app.css", "app.js", "data-access.js", "display-names.js", "character-suggestions.js", "staff.js"]);
await mkdir(targetAssets, { recursive: true });
await cp(sourceAssets, targetAssets, {
  recursive: true,
  filter(source) {
    const relative = source.slice(sourceAssets.length + 1).split(sep).join("/");
    return !relative || relative === "characters" || relative.startsWith("characters/") ||
      relative === "competitors" || relative.startsWith("competitors/") ||
      packagedRootAssets.has(relative);
  },
});
await writeFile(
  join(targetAssets, "runtime-config.js"),
  "window.ARENA_CONFIG = Object.freeze(" +
    JSON.stringify({ mode, apiBase: "/api" }) +
    ");\n",
  "utf8",
);

if (mode === "demo") {
  const fixtureSource = join(root, "fixtures", "demo");
  try {
    await readdir(fixtureSource);
    await cp(fixtureSource, join(outDir, "fixtures", "demo"), { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

console.log("Built " + mode + " mode at " + outDir);
