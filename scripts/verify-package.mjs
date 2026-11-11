import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { DISTRIBUTION_FILES, PROJECT_ROOT } from "./build.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function verifyArchive(bytes, { browser, version }) {
  const files = unzipSync(bytes);
  const names = Object.keys(files).sort();
  requireCondition(JSON.stringify(names) === JSON.stringify([...DISTRIBUTION_FILES].sort()), "Archive contains missing or unexpected files.");
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8"));
  requireCondition(manifest.version === version, "Archive version does not match release version.");
  requireCondition(manifest.manifest_version === 3, "Expected a Manifest V3 extension.");
  if (browser === "firefox") {
    requireCondition(!manifest.background.service_worker && manifest.background.scripts?.[0] === "background.js", "Firefox requires a background script.");
    requireCondition(Boolean(manifest.browser_specific_settings?.gecko?.id), "Firefox add-on ID is missing.");
  } else {
    requireCondition(manifest.background.service_worker === "background.js", "Chrome service worker is missing.");
  }
  return { manifest, files };
}

// CRX3 uses length-delimited protobuf fields for proofs and signed data.
// Schema: https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto
function protobufFields(bytes) {
  const fields = new Map();
  let offset = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    while (offset < bytes.length && shift <= 28) {
      const byte = bytes[offset++];
      result += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return result;
      shift += 7;
    }
    throw new Error("Invalid CRX3 protobuf integer.");
  };
  while (offset < bytes.length) {
    const tag = readVarint();
    requireCondition((tag & 7) === 2, "Unexpected CRX3 protobuf field type.");
    const length = readVarint();
    requireCondition(offset + length <= bytes.length, "Truncated CRX3 protobuf field.");
    const number = tag >>> 3;
    const values = fields.get(number) || [];
    values.push(bytes.subarray(offset, offset + length));
    fields.set(number, values);
    offset += length;
  }
  return fields;
}

export function verifyCrx3(input) {
  const bytes = Buffer.from(input);
  requireCondition(bytes.length >= 12 && bytes.subarray(0, 4).toString() === "Cr24", "Invalid CRX magic.");
  requireCondition(bytes.readUInt32LE(4) === 3, "Expected CRX3 format.");
  const headerLength = bytes.readUInt32LE(8);
  requireCondition(headerLength <= 1024 * 1024 && 12 + headerLength < bytes.length, "Invalid CRX3 header length.");
  const fields = protobufFields(bytes.subarray(12, 12 + headerLength));
  const signedHeader = fields.get(10000)?.[0];
  requireCondition(signedHeader, "Missing CRX3 signed header.");
  const crxId = protobufFields(signedHeader).get(1)?.[0];
  requireCondition(crxId?.length === 16, "Invalid CRX3 extension ID.");
  const archive = bytes.subarray(12 + headerLength);
  const signedLength = Buffer.alloc(4);
  signedLength.writeUInt32LE(signedHeader.length);
  const signedBytes = Buffer.concat([Buffer.from("CRX3 SignedData\0"), signedLength, signedHeader, archive]);
  let developerProofValid = false;
  for (const proof of fields.get(2) || []) {
    const values = protobufFields(proof);
    const publicKey = values.get(1)?.[0];
    const signature = values.get(2)?.[0];
    requireCondition(publicKey && signature, "Incomplete CRX3 RSA proof.");
    const key = createPublicKey({ key: publicKey, format: "der", type: "spki" });
    requireCondition(verify("sha256", signedBytes, key, signature), "CRX3 signature verification failed.");
    if (createHash("sha256").update(publicKey).digest().subarray(0, 16).equals(crxId)) {
      developerProofValid = true;
    }
  }
  requireCondition(developerProofValid, "No valid CRX3 developer proof matches its extension ID.");
  const extensionId = [...crxId].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
  return { archive, extensionId };
}

export async function verifyPackages({ artifactDirectory = resolve(PROJECT_ROOT, "artifacts"), requireCrx = true } = {}) {
  const { version } = JSON.parse(await readFile(resolve(PROJECT_ROOT, "manifest.json"), "utf8"));
  const prefix = `sense-translate-${version}`;
  const expected = [`${prefix}-chrome.zip`, `${prefix}-firefox-unsigned.xpi`];
  const names = await readdir(artifactDirectory);
  const crxName = `${prefix}-chrome.crx`;
  if (requireCrx || names.includes(crxName)) expected.push(crxName);
  const checksums = await readFile(resolve(artifactDirectory, "SHA256SUMS"), "utf8");
  const checksumLines = checksums.trim().split("\n");
  requireCondition(checksumLines.length === expected.length, "SHA256SUMS contains unexpected entries.");
  for (const name of expected) {
    const bytes = await readFile(resolve(artifactDirectory, name));
    const hash = createHash("sha256").update(bytes).digest("hex");
    requireCondition(checksumLines.includes(`${hash}  ${name}`), `Checksum mismatch: ${name}`);
    if (name.endsWith(".crx")) {
      const { archive, extensionId } = verifyCrx3(bytes);
      verifyArchive(archive, { browser: "chrome", version });
      console.log(`Verified ${name} (CRX3 signature; extension ID ${extensionId})`);
    } else {
      verifyArchive(bytes, { browser: name.endsWith(".xpi") ? "firefox" : "chrome", version });
      console.log(`Verified ${name}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPackages({ requireCrx: !process.argv.includes("--skip-crx") });
}
