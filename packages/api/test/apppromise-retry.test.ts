import { describe, it, expect } from 'vitest';

/**
 * Tests for the serverless appPromise retry pattern.
 * Validates that a failed buildApp() resets appPromise so the next
 * invocation can retry, matching the deployment hardening fix in api/index.ts.
 */

describe('appPromise retry pattern', () => {
  it('resets appPromise on rejection so next call retries', async () => {
    let callCount = 0;
    let appPromise: Promise<any> | null = null;

    function buildApp() {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('cold start failed'));
      }
      return Promise.resolve({ ready: async () => {} });
    }

    // First call: should reject and reset appPromise
    appPromise = buildApp().catch((err: Error) => {
      appPromise = null;
      throw err;
    });

    await expect(appPromise).rejects.toThrow('cold start failed');

    // appPromise should have been reset to null
    expect(appPromise).toBeNull();

    // Second call: should succeed because appPromise was reset
    appPromise = buildApp().catch((err: Error) => {
      appPromise = null;
      throw err;
    });

    const app = await appPromise;
    expect(app).toBeDefined();
    expect(callCount).toBe(2);
  });

  it('does not reset appPromise on success', async () => {
    let appPromise: Promise<any> | null = null;

    function buildApp() {
      return Promise.resolve({ ready: async () => {} });
    }

    appPromise = buildApp().catch((err: Error) => {
      appPromise = null;
      throw err;
    });

    const app = await appPromise;
    expect(app).toBeDefined();
    expect(appPromise).not.toBeNull();
  });

  it('handles multiple sequential failures then success', async () => {
    let callCount = 0;
    let appPromise: Promise<any> | null = null;

    function buildApp() {
      callCount++;
      if (callCount <= 2) {
        return Promise.reject(new Error(`attempt ${callCount} failed`));
      }
      return Promise.resolve({ ready: async () => {} });
    }

    // First failure
    appPromise = buildApp().catch((err: Error) => {
      appPromise = null;
      throw err;
    });
    await expect(appPromise).rejects.toThrow('attempt 1 failed');
    expect(appPromise).toBeNull();

    // Second failure
    appPromise = buildApp().catch((err: Error) => {
      appPromise = null;
      throw err;
    });
    await expect(appPromise).rejects.toThrow('attempt 2 failed');
    expect(appPromise).toBeNull();

    // Third attempt succeeds
    appPromise = buildApp().catch((err: Error) => {
      appPromise = null;
      throw err;
    });
    const app = await appPromise;
    expect(app).toBeDefined();
    expect(callCount).toBe(3);
  });
});
