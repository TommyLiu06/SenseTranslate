import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DISTRIBUTION_FILES = Object.freeze([
  "LICENSE", "background.js", "content.css", "content.js", "manifest.json",
  "popup.css", "popup.html", "popup.js"
]);

export function manifestForBrowser(base, browser) {
  if (!["chrome", "firefox"].includes(browser)) {
    throw new Error(`Unsupported browser: ${browser}`);
  }
  const manifest = structuredClone(base);
  if (browser === "firefox") {
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ["background.js"] };
    manifest.browser_specific_settings = {
      gecko: {
        id: "sense-translate@tommyliu06.github.io",
        strict_min_version: "140.0",
        data_collection_permissions: {
          required: ["websiteContent", "authenticationInfo"]
        }
      },
      gecko_android: { strict_min_version: "142.0" }
    };
  } else {
    delete manifest.browser_specific_settings;
    manifest.background = { service_worker: "background.js" };
    manifest.minimum_chrome_version = "120";
  }
  return manifest;
}

export async function buildExtensions() {
  const base = JSON.parse(await readFile(resolve(PROJECT_ROOT, "manifest.json"), "utf8"));
  const pkg = JSON.parse(await readFile(resolve(PROJECT_ROOT, "package.json"), "utf8"));
  if (base.version !== pkg.version) {
    throw new Error("package.json and manifest.json versions must match before building.");
  }
  for (const browser of ["chrome", "firefox"]) {
    const outdir = resolve(PROJECT_ROOT, "dist", browser);
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });
    await build({
      absWorkingDir: PROJECT_ROOT,
      entryPoints: {
        background: "src/background/index.js",
        content: "src/content/index.js",
        popup: "src/popup/index.js"
      },
      outdir,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: browser === "chrome" ? "chrome120" : "firefox140",
      charset: "utf8",
      legalComments: "inline",
      minify: false,
      sourcemap: false,
      logLevel: "warning"
    });
    for (const [source, destination] of [
      ["src/content/content.css", "content.css"],
      ["src/popup/popup.css", "popup.css"],
      ["src/popup/popup.html", "popup.html"],
      ["LICENSE", "LICENSE"]
    ]) {
      await copyFile(resolve(PROJECT_ROOT, source), resolve(outdir, destination));
    }
    await writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifestForBrowser(base, browser), null, 2)}\n`);
    console.log(`Built ${browser} ${base.version}: dist/${browser}`);
  }
  return base.version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildExtensions();
}
