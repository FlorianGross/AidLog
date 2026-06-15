import { describe, it, expect, beforeEach } from 'vitest';
import {
  getApiBase,
  setApiBase,
  validateServerUrl,
  hasStoredServerUrl,
  isServerConfigRequired,
} from './serverUrl';

describe('config/serverUrl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('validateServerUrl', () => {
    it('accepts absolute http(s) URLs and strips a trailing slash', () => {
      expect(validateServerUrl('https://aidlog.example.org/')).toBe('https://aidlog.example.org');
      expect(validateServerUrl('  https://a.test  ')).toBe('https://a.test');
      expect(validateServerUrl('http://localhost:3000')).toBe('http://localhost:3000');
      expect(validateServerUrl('https://a.test/api')).toBe('https://a.test/api');
    });

    it('rejects empty, relative, and non-http(s) values', () => {
      expect(validateServerUrl('')).toBeNull();
      expect(validateServerUrl('   ')).toBeNull();
      expect(validateServerUrl('/api')).toBeNull();
      expect(validateServerUrl('ftp://a.test')).toBeNull();
      expect(validateServerUrl('javascript:alert(1)')).toBeNull();
      expect(validateServerUrl('not a url')).toBeNull();
    });
  });

  describe('get/set', () => {
    it('falls back to same-origin ("") with nothing stored or built in', () => {
      // No VITE_API_BASE_URL is set in the test env.
      expect(getApiBase()).toBe('');
      expect(hasStoredServerUrl()).toBe(false);
    });

    it('persists and reads back a normalised runtime URL', () => {
      setApiBase('https://srv.example.org/');
      expect(getApiBase()).toBe('https://srv.example.org');
      expect(hasStoredServerUrl()).toBe(true);
    });

    it('clears the stored URL with null/empty', () => {
      setApiBase('https://srv.example.org');
      setApiBase(null);
      expect(getApiBase()).toBe('');
      expect(hasStoredServerUrl()).toBe(false);

      setApiBase('https://srv.example.org');
      setApiBase('   ');
      expect(hasStoredServerUrl()).toBe(false);
    });

    it('throws on an invalid URL rather than persisting garbage', () => {
      expect(() => setApiBase('not a url')).toThrow();
      expect(hasStoredServerUrl()).toBe(false);
    });

    it('ignores a corrupt stored value and falls back', () => {
      localStorage.setItem('aidlog.api-base-url', 'not a url');
      expect(getApiBase()).toBe('');
      expect(hasStoredServerUrl()).toBe(false);
    });
  });

  describe('isServerConfigRequired', () => {
    it('is false on a plain build (no runtime flag, not native)', () => {
      // Neither VITE_RUNTIME_API_CONFIG nor Capacitor present in the test env.
      expect(isServerConfigRequired()).toBe(false);
    });
  });
});
