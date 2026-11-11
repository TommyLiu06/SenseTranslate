import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { manifestForBrowser, DISTRIBUTION_FILES } from "../scripts/build.mjs";
import { verifyArchive, verifyCrx3 } from "../scripts/verify-package.mjs";

const base = {
  manifest_version: 3, name: "Sense Translate", version: "0.2.0",
  permissions: ["storage", "contextMenus"], background: { service_worker: "background.js" }
};

test("browser manifests choose supported backgrounds without changing the source manifest", () => {
  const chrome = manifestForBrowser(base, "chrome");
  const firefox = manifestForBrowser(base, "firefox");
  assert.deepEqual(chrome.background, { service_worker: "background.js" });
  assert.deepEqual(firefox.background, { scripts: ["background.js"] });
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, "140.0");
  assert.equal(firefox.browser_specific_settings.gecko_android.strict_min_version, "142.0");
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.required, ["websiteContent", "authenticationInfo"]);
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.equal(base.minimum_chrome_version, undefined);
  assert.deepEqual(base.background, { service_worker: "background.js" });
});

function archiveFor(manifest, extra = {}) {
  const entries = Object.fromEntries(DISTRIBUTION_FILES.map((name) => [name, new Uint8Array()]));
  entries["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
  return zipSync({ ...entries, ...extra });
}

test("package validation refuses credentials, source files, and wrong versions", () => {
  const manifest = manifestForBrowser(base, "chrome");
  assert.equal(verifyArchive(archiveFor(manifest), { browser: "chrome", version: "0.2.0" }).manifest.version, "0.2.0");
  for (const name of [".keys/chrome.pem", ".env", "src/background/index.js"]) {
    assert.throws(() => verifyArchive(archiveFor(manifest, { [name]: new Uint8Array() }), { browser: "chrome", version: "0.2.0" }), /unexpected files/);
  }
  assert.throws(() => verifyArchive(archiveFor(manifest), { browser: "chrome", version: "0.3.0" }), /version/);
});

test("package validation refuses Firefox service workers", () => {
  assert.throws(() => verifyArchive(archiveFor(base), { browser: "firefox", version: "0.2.0" }), /background script/);
});

test("CRX verification rejects fake CRX files", () => {
  assert.throws(() => verifyCrx3(Buffer.from("a renamed zip file")), /magic/);
  const invalid = Buffer.alloc(20);
  invalid.write("Cr24");
  invalid.writeUInt32LE(3, 4);
  invalid.writeUInt32LE(1_048_577, 8);
  assert.throws(() => verifyCrx3(invalid), /header length/);
});
