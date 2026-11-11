import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, resolveProvider } from '../src/shared/settings.js';

test('missing and malformed settings use the same defaults', () => {
  for (const value of [undefined, null, [], 'invalid', {}]) {
    assert.deepEqual(normalizeSettings(value), DEFAULT_SETTINGS);
  }
});

test('normalization bounds context and languages and removes secret fields', () => {
  const settings = normalizeSettings({
    provider: 'qwen', baseUrl: ' https://example.com/v1/// ', model: ' custom-model ',
    contextBeforeWords: '-20', contextAfterWords: '2000', targetLanguage: 'x'.repeat(90),
    theme: 'invalid', multiTurn: false, apiKey: 'never-sync-this'
  });
  assert.equal(settings.baseUrl, 'https://example.com/v1');
  assert.equal(settings.model, 'custom-model');
  assert.equal(settings.contextBeforeWords, 0);
  assert.equal(settings.contextAfterWords, 1000);
  assert.equal(settings.targetLanguage.length, 64);
  assert.equal(settings.multiTurn, false);
  assert.equal(settings.theme, 'system');
  assert.equal(Object.hasOwn(settings, 'apiKey'), false);
});

test('provider lookup rejects inherited object properties', () => {
  for (const value of ['__proto__', 'constructor', 'toString', '', null]) {
    assert.equal(resolveProvider(value), DEFAULT_SETTINGS.provider);
    assert.deepEqual(normalizeSettings({ provider: value }), DEFAULT_SETTINGS);
  }
});

test('custom models, endpoints and saved provider defaults survive normalization', () => {
  const settings = normalizeSettings({ provider: 'glm', baseUrl: '', model: '' });
  assert.equal(settings.baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(settings.model, 'glm-4.5-air');
  assert.deepEqual(normalizeSettings({ ...settings, apiKey: 'legacy-key' }), settings);
});
