import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBaseUrl } from './apiClient.js';

const SITE = 'https://chitfund.vercel.app';
afterEach(() => vi.restoreAllMocks());

describe('resolveBaseUrl', () => {
  it('uses the configured value, or the local backend, in development', () => {
    expect(resolveBaseUrl('http://localhost:4000/api/v1', { prod: false, origin: 'http://localhost:5173' })).toBe('http://localhost:4000/api/v1');
    expect(resolveBaseUrl(undefined, { prod: false, origin: 'http://localhost:5173' })).toBe('http://localhost:4000/api/v1');
    expect(resolveBaseUrl('', { prod: false, origin: 'http://localhost:5173' })).toBe('http://localhost:4000/api/v1');
  });

  it('defaults to the same-origin proxy in production when nothing is configured', () => {
    expect(resolveBaseUrl(undefined, { prod: true, origin: SITE })).toBe('/api/v1');
    expect(resolveBaseUrl('', { prod: true, origin: SITE })).toBe('/api/v1');
    expect(resolveBaseUrl('   ', { prod: true, origin: SITE })).toBe('/api/v1');
  });

  it('accepts same-origin values in production', () => {
    expect(resolveBaseUrl('/api/v1', { prod: true, origin: SITE })).toBe('/api/v1');
    expect(resolveBaseUrl(`${SITE}/api/v1`, { prod: true, origin: SITE })).toBe(`${SITE}/api/v1`);
  });

  it('ignores a cross-origin value in production, which was the deployment mistake, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveBaseUrl('https://chitfund-lkj4.onrender.com', { prod: true, origin: SITE })).toBe('/api/v1');
    expect(resolveBaseUrl('https://chitfund-lkj4.onrender.com/api/v1', { prod: true, origin: SITE })).toBe('/api/v1');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('falls back safely on an unparseable value in production', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveBaseUrl('http://', { prod: true, origin: SITE })).toBe('/api/v1');
  });
});
