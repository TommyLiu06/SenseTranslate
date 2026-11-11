import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { buildExtensions, DISTRIBUTION_FILES, PROJECT_ROOT } from "./build.mjs";
import { verifyPackages } from "./verify-package.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function createArchive(browser) {
  const entries = {};
  for (const name of DISTRIBUTION_FILES) {
    const bytes = await readFile(resolve(PROJECT_ROOT, "dist", browser, name));
    // fflate encodes local calendar fields in DOS timestamps. A local date keeps
    // the ZIP bytes identical when the build runs in another timezone.
    entries[name] = [bytes, { mtime: new Date(1980, 0, 1) }];
  }
  return zipSync(entries, { level: 9 });
}

async function privateKeyPath() {
  if (process.env.CRX_PRIVATE_KEY_PATH) {
    const path = resolve(PROJECT_ROOT, process.env.CRX_PRIVATE_KEY_PATH);
    await access(path);
    return path;
  }
  const path = resolve(PROJECT_ROOT, ".keys/chrome.pem");
  if (!(await exists(path))) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    await writeFile(path, privateKey, { mode: 0o600, flag: "wx" });
    console.log("Created .keys/chrome.pem; preserve this private file for future CRX updates.");
  }
  await chmod(path, 0o600);
  return path;
}

async function createCrx(destination) {
  const keyPath = await privateKeyPath();
  const sourceDirectory = resolve(PROJECT_ROOT, "dist/chrome");
  const generatedPath = `${sourceDirectory}.crx`;
  await rm(generatedPath, { force: true });
  const profile = resolve(PROJECT_ROOT, ".runtime/chrome-pack-profile");
  await mkdir(profile, { recursive: true });
  const command = process.env.CHROME_BIN || "google-chrome";
  const result = spawnSync(command, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--no-message-box", `--user-data-dir=${profile}`,
    `--pack-extension=${sourceDirectory}`, `--pack-extension-key=${keyPath}`
  ], { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 60_000 });
  if (result.error || result.status !== 0 || !(await exists(generatedPath))) {
    throw new Error(`Chrome packaging failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  await copyFile(generatedPath, destination);
  await rm(generatedPath, { force: true });
}

export async function packageExtensions({ skipCrx = false } = {}) {
  const version = await buildExtensions();
  const artifactDirectory = resolve(PROJECT_ROOT, "artifacts");
  await mkdir(artifactDirectory, { recursive: true });
  const prefix = `sense-translate-${version}`;
  const names = [`${prefix}-chrome.zip`, `${prefix}-firefox-unsigned.xpi`];
  const crxName = `${prefix}-chrome.crx`;
  // Only remove this release's outputs; never sweep unrelated artifacts.
  for (const name of [...names, crxName, "SHA256SUMS"]) {
    await rm(resolve(artifactDirectory, name), { force: true });
  }
  await writeFile(resolve(artifactDirectory, names[0]), await createArchive("chrome"));
  await writeFile(resolve(artifactDirectory, names[1]), await createArchive("firefox"));
  if (!skipCrx) {
    await createCrx(resolve(artifactDirectory, crxName));
    names.push(crxName);
  }
  const hashes = [];
  for (const name of names.sort()) {
    const bytes = await readFile(resolve(artifactDirectory, name));
    hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
  }
  await writeFile(resolve(artifactDirectory, "SHA256SUMS"), `${hashes.join("\n")}\n`);
  await verifyPackages({ artifactDirectory, requireCrx: !skipCrx });
  console.log(`Release artifacts are ready in artifacts/ (${version}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageExtensions({ skipCrx: process.argv.includes("--skip-crx") });
}
