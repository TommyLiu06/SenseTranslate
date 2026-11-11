import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Real extension APIs and content scripts, with a local provider instead of paid API calls.
test('settings, streaming translation, explanation, retry and cancellation', async () => {
  const calls = [];
  let cancelled = false;
  let holdOpen = false;
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html><body><p>Before words. <span id="selection">Hello world</span> After words.</p></body></html>');
      return;
    }
    let data = '';
    for await (const chunk of request) data += chunk;
    const body = JSON.parse(data);
    calls.push({ body, authorization: request.headers.authorization });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '你好' } }] }) + '\r\n\r\n');
    if (holdOpen) {
      response.on('close', () => { cancelled = true; });
      return;
    }
    response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '，世界' } }] }) + '\r\n\r\ndata: [DONE]\r\n\r\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtime = path.resolve('.runtime');
  await mkdir(runtime, { recursive: true });
  const profile = await mkdtemp(path.join(runtime, 'chromium-test-'));
  let context;
  try {
    const extension = path.resolve('dist/chrome');
    const existingChrome = process.env.CHROME_BIN;
    context = await chromium.launchPersistentContext(profile, {
      channel: existingChrome ? undefined : 'chromium',
      executablePath: existingChrome || undefined,
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: existingChrome ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    if (existingChrome) {
      // Supported Chrome DevTools installation API for a fresh test profile.
      const devtools = await context.browser().newBrowserCDPSession();
      await devtools.send('Extensions.loadUnpacked', { path: extension });
      await devtools.detach();
    }
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#modelPreset')).toHaveValue('deepseek-v4-flash');

    // Change provider immediately after typing: the pending key belongs to DeepSeek.
    await popup.locator('#apiKey').fill('test-deepseek-key');
    await popup.locator('#provider').selectOption('qwen');
    await expect(popup.locator('#apiKey')).toHaveValue('');
    await popup.locator('#apiKey').fill('test-qwen-key');
    await popup.locator('#baseUrl').fill(`${base}/v1`);
    await expect.poll(async () => popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return result.settings?.baseUrl;
    })).toBe(`${base}/v1`);
    await expect.poll(async () => popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ type: 'GET_PROVIDER_API_KEY', provider: 'deepseek' });
      return result.apiKey;
    })).toBe('test-deepseek-key');

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const trigger = async () => {
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#selection'));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      });
      await worker.evaluate(async url => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(item => item.url === `${url}/`);
        await chrome.tabs.sendMessage(tab.id, { type: 'SENSE_TRANSLATE_TRIGGER', selectedText: 'Hello world' });
      }, base);
    };
    await trigger();
    const main = page.locator('[data-role="main"]');
    await expect(main).toHaveText('你好，世界');
    await expect(main).not.toHaveClass(/is-loading/);
    expect(calls[0].authorization).toBe('Bearer test-qwen-key');
    expect(calls[0].body.messages.at(-1).content).toContain('Hello world');
    expect(calls[0].body.messages.at(-1).content).toContain('Before words.');
    expect(calls[0].body.messages.at(-1).content).toContain('After words.');
    await page.locator('[data-role="explain"]').click();
    await expect(page.locator('[data-role="explain-content"]')).toHaveText('你好，世界');
    await expect(page.locator('[data-role="explain-content"]')).not.toHaveClass(/is-loading/);
    expect(calls[1].body.messages[0].content).toContain('EXPLAIN_SELECTED_TEXT');
    await page.locator('[data-role="retry"]').click();
    await expect.poll(() => calls.length).toBe(3);
    await expect(main).not.toHaveClass(/is-loading/);
    await page.locator('[data-role="close"]').click();
    await expect(page.locator('.sense-translate-popup')).toHaveCount(0);
    // Same selection and settings use the per-page cache.
    await trigger();
    await expect(main).toHaveText('你好，世界');
    expect(calls).toHaveLength(3);
    // A retry has a real outstanding HTTP stream; closing must abort it.
    holdOpen = true;
    await page.locator('[data-role="retry"]').click();
    await expect.poll(() => calls.length).toBe(4);
    await expect(main).toHaveText('你好');
    await page.locator('[data-role="close"]').click();
    await expect.poll(() => cancelled).toBe(true);
    // Keys stay local and are absent from synced preferences.
    const stored = await popup.evaluate(async () => {
      const sync = await chrome.storage.sync.get(null);
      const local = await chrome.storage.local.get(null);
      return { sync, local };
    });
    expect(JSON.stringify(stored.sync)).not.toContain('test-qwen-key');
    expect(JSON.stringify(stored.local)).not.toContain('test-qwen-key');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
