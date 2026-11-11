# Sense Translate v0.2.0

Sense Translate now builds for Chrome and Firefox from shared, modular source. Existing preferences and provider API keys remain compatible with earlier versions.

Changes:

- Share provider configuration, settings normalization, and theme handling across the extension.
- Split background, settings UI, content UI, credential storage, prompts, and streaming into focused modules.
- Fix API keys being saved against the wrong provider during rapid provider switches, and avoid save responses overwriting newer input.
- Cancel provider requests when the translation window closes or retries; isolate history by tab, frame, provider, endpoint, model, and language.
- Handle split Unicode/SSE events, provider errors, timeouts, and end-of-stream markers reliably.
- Bound the per-page cache, prevent duplicate explanation requests, and build displayed results with DOM text APIs.
- Add browser-specific manifests, reproducible ZIP/XPI packaging, CRX3 signature verification, checksum generation, and CI validation.

Downloads:

- `sense-translate-0.2.0-chrome.zip`: extract and load through Chrome's Developer mode. Recommended for personal installation on Windows, macOS, and Linux.
- `sense-translate-0.2.0-chrome.crx`: locally packed CRX3. Chrome restricts self-hosted CRX installation on Windows/macOS; enterprise policies may be required.
- `sense-translate-0.2.0-firefox-unsigned.xpi`: **unsigned**, intended for temporary installation through Firefox's `about:debugging`. It must be reloaded after restarting Firefox. This release has not been submitted to Mozilla for signing or to either browser's extension store.
- `SHA256SUMS`: SHA-256 checksums for the three extension packages.

Requirements: Chrome 120+ or Firefox Desktop 140+ (Firefox Android manifest minimum: 142; Android interaction has not been tested). Building from source requires Node.js 22+.

Validation:

- 37 Node unit and package tests passed.
- The real Chrome 151 extension passed a browser regression covering provider switching, credential storage, translation, explanation, retry, cache reuse, and request cancellation against a local mock API.
- Firefox `web-ext lint` reported zero errors, notices, and warnings.
- All archive contents, SHA-256 checksums, and the CRX3 RSA signature verified successfully.

See the [README](https://github.com/TommyLiu06/SenseTranslate#readme) for installation, development, and packaging instructions.
