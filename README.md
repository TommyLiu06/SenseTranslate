# Sense Translate

Sense Translate is a Chrome and Firefox extension that translates selected webpage text using its surrounding context and your preferred LLM provider.

## 🤖 AI-Generated Notice

This repository contains code and documentation generated with AI assistance.

## ✨ Features

- Stream translations and explanations into a draggable in-page window.
- Include configurable context before and after selected text.
- Configure DeepSeek, GLM, GLM Coding, Qwen, or an OpenAI-compatible endpoint, including custom model IDs.
- Keep a separate API key for each provider and optionally use recent conversation history.
- Reuse translations on the current page, retry requests, and follow light, dark, or system themes.
- Cancel active requests when the translation window closes.

## 📦 Install a release

Download files from [GitHub Releases](https://github.com/TommyLiu06/SenseTranslate/releases).

### Chrome / Chromium

For development or personal installation, download `sense-translate-VERSION-chrome.zip`, extract it, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the extracted directory containing `manifest.json`. Chrome 120 or later is required.

A CRX3 package is also provided. Chrome restricts installation of self-hosted CRX files: Windows and macOS generally require enterprise policies; Linux supports self-hosted packed extensions. The ZIP is the practical option for personal installation across platforms. See [Chrome's distribution documentation](https://developer.chrome.com/docs/extensions/how-to/distribute).

### Firefox

Firefox 140 or later is required. This release supplies an **unsigned** XPI for development and testing:

1. Download `sense-translate-VERSION-firefox-unsigned.xpi`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select the XPI (or extract it and select `manifest.json`).

Firefox removes temporary add-ons when it restarts. Normal persistent installation in Firefox Release/Beta requires Mozilla signing. Developer Edition, Nightly, and ESR can allow unsigned persistent installation with the relevant configuration. See [Mozilla's temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) and [signing requirements](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Use `SHA256SUMS` from the same release to check downloaded files, for example `sha256sum --check SHA256SUMS` after downloading all assets.

## 🚀 Usage

1. Open the extension's toolbar popup and configure your provider, endpoint, model, API key, context length, target language, and theme. Changes save automatically.
2. Select text on a webpage, right-click, and choose **Sense Translate**.
3. Read the streamed translation. Use **explain** for meaning and context, **retry** to translate again, or **close** to dismiss the window. Drag its header to move it.

Browser-internal pages, browser extension stores, and other protected pages do not allow content scripts. Reload existing webpages after installing or updating the extension.

## 🔒 Data and credentials

Selected text, configured surrounding context, and optional recent conversation history are sent directly to the API endpoint you configure when you request translation or explanation. The configured API key authenticates these requests. No project-operated relay or analytics service is used.

Preferences use browser sync storage. API keys use AES-GCM in local extension storage and are never synced. The encryption material is stored locally alongside the encrypted values; this protects against accidentally exposing plaintext settings, but does not protect against someone with access to your browser profile. Existing settings and API keys migrate automatically. In-memory conversation history lasts for the lifetime of the background context and is cleared when a tab navigates or closes.

## 🛠️ Develop and verify

Use Node.js 22 or later (Node.js 24 LTS is recommended) and npm:

```sh
npm ci
npm run check
```

Load `dist/chrome` in Chrome or `dist/firefox` temporarily in Firefox after building. The root `manifest.json` is the build template; load the generated directory.

Browser regression tests use a separate temporary browser profile, local mock API responses, and no real provider credentials:

```sh
npm run browser:install
npm run test:browser
```

Alternatively, set `CHROME_BIN` to an installed Chrome executable when running `npm run test:browser`. This uses Chrome’s DevTools extension-installation API in the isolated test profile and avoids downloading Chromium.

Source layout:

| Directory | Responsibility |
| --- | --- |
| `src/shared` | Provider catalog, settings normalization, browser API selection, themes |
| `src/background` | Settings and credential persistence, prompts, streaming API requests, messaging |
| `src/content` | Selection context, translation window, cache, stream lifecycle |
| `src/popup` | Provider/model configuration and automatic saving |
| `scripts` | Browser-specific builds and release packages |
| `tests`, `e2e` | Unit, package integrity, and browser regression coverage |

The build uses esbuild to produce local, readable bundles. No remote JavaScript or runtime dependencies are loaded.

## 🚢 Package and release

```sh
npm run check
npm run test:browser
npm run package
```

Packaging produces a Chrome ZIP, Chrome CRX3, unsigned Firefox XPI, and `SHA256SUMS` in `artifacts/`. It uses the Chrome executable available on your system; see `scripts/package.mjs` for executable configuration. The first CRX packaging run creates a private CRX signing key under `.keys/`. Keep that key private and back it up: reusing it preserves the packed extension's identity in later releases. You can supply an existing key through `CRX_PRIVATE_KEY_PATH`. Private keys and browser profiles are excluded from Git and release archives.

To package ZIP/XPI without Chrome or a CRX key, run `npm run package -- --skip-crx`.

Version numbers in `package.json` and `manifest.json` must match. After committing and validating a version, publish with Git and GitHub CLI:

```sh
git tag -a vVERSION -m "Sense Translate vVERSION"
git push origin main
git push origin vVERSION
gh release create vVERSION artifacts/* --verify-tag --title "Sense Translate vVERSION" --notes-file RELEASE_NOTES.md
```

GitHub Releases hosts the files; it does not submit the extension to either browser's store or sign the Firefox package.

## 📄 License

[GNU General Public License v3.0](./LICENSE).
