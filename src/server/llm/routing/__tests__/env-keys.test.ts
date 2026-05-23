import { describe, expect, it } from 'vitest';

import {
  collectProviderApiKeys,
  collectProviderKeyStrings,
  hasAnyProviderKey,
} from '../env-keys';

describe('collectProviderApiKeys', () => {
  it('short-circuits on READABLE_LIVE_<PROV>_KEY and ignores other env', () => {
    const env = {
      READABLE_LIVE_OPENAI_KEY: 'live-key',
      OPENAI_API_KEY: 'primary-key',
      OPENAI_API_KEYS: 'list-a, list-b',
      OPENAI_API_KEY_1: 'numbered-1',
    };
    const result = collectProviderApiKeys('openai', { env });
    expect(result).toEqual([{ key: 'live-key', source: 'live' }]);
  });

  it('merges list + primary + numbered + fallback in deterministic order', () => {
    const env = {
      OPENAI_API_KEYS: 'list-a; list-b',
      OPENAI_API_KEY: 'primary',
      OPENAI_API_KEY_2: 'numbered-2',
      OPENAI_API_KEY_1: 'numbered-1',
    };
    const result = collectProviderKeyStrings('openai', { env });
    // Order: list (in source order), then primary, then numbered (sorted by name)
    expect(result).toEqual(['list-a', 'list-b', 'primary', 'numbered-1', 'numbered-2']);
  });

  it('honours provider-specific fallback vars (GEMINI -> GOOGLE_API_KEY)', () => {
    const env = { GOOGLE_API_KEY: 'g-fallback' };
    expect(collectProviderKeyStrings('gemini', { env })).toEqual(['g-fallback']);
    // Vertex shares the fallback.
    expect(collectProviderKeyStrings('google-vertex', { env })).toEqual(['g-fallback']);
  });

  it('deduplicates keys that appear in multiple slots', () => {
    const env = {
      OPENAI_API_KEYS: 'shared-key,unique-list',
      OPENAI_API_KEY: 'shared-key',
      OPENAI_API_KEY_1: 'shared-key',
    };
    const result = collectProviderKeyStrings('openai', { env });
    expect(result).toEqual(['shared-key', 'unique-list']);
  });

  it('returns [] when no env is set for the provider', () => {
    expect(collectProviderApiKeys('openai', { env: {} })).toEqual([]);
    expect(hasAnyProviderKey('openai', { env: {} })).toBe(false);
  });

  it('skips empty-string keys silently', () => {
    const env = {
      OPENAI_API_KEY: '   ',
      OPENAI_API_KEYS: '',
      OPENAI_API_KEY_1: 'real-key',
    };
    expect(collectProviderKeyStrings('openai', { env })).toEqual(['real-key']);
  });

  it('parses semicolon, comma, and whitespace separators in list form', () => {
    const env = { ANTHROPIC_API_KEYS: 'a;b , c\nd' };
    expect(collectProviderKeyStrings('anthropic', { env })).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('hasAnyProviderKey early-exits on any positive signal', () => {
    expect(hasAnyProviderKey('openai', { env: { OPENAI_API_KEY: 'k' } })).toBe(true);
    expect(hasAnyProviderKey('openai', { env: { OPENAI_API_KEY_5: 'k' } })).toBe(true);
    expect(hasAnyProviderKey('openrouter', { env: { OPENROUTER_API_KEYS: 'k' } })).toBe(true);
    expect(hasAnyProviderKey('gemini', { env: { GOOGLE_API_KEY: 'k' } })).toBe(true);
  });

  it('uses each provider\'s correct env-var prefix', () => {
    const env = {
      ANTHROPIC_API_KEY: 'anth',
      OPENROUTER_API_KEY: 'or',
      OPENAI_CODEX_API_KEY: 'codex',
    };
    expect(collectProviderKeyStrings('anthropic', { env })).toEqual(['anth']);
    expect(collectProviderKeyStrings('openrouter', { env })).toEqual(['or']);
    expect(collectProviderKeyStrings('openai-codex', { env })).toEqual(['codex']);
    // openai prefix is OPENAI, which would also match OPENAI_CODEX_API_KEY's
    // numbered chain only if name strictly matched. It must not bleed.
    expect(collectProviderKeyStrings('openai', { env })).toEqual([]);
  });
});
