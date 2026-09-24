import { afterEach, describe, expect, it, vi } from 'vitest';
import { PollingCoordinator } from '../../shared/src/polling-coordinator';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PollingCoordinator request timeout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aborts a stalled request and retries with backoff', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let calls = 0;
    const connections: boolean[] = [];
    const coordinator = new PollingCoordinator<string>({
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) return new Promise<string>(() => {});
        return 'recovered';
      },
      onData: () => {},
      onConnectionChange: (connected) => connections.push(connected),
      requestTimeoutMs: 15,
      intervalMs: 10,
      maxBackoffMs: 20,
      isHidden: () => false
    });

    coordinator.start('timeout');
    await wait(100);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(connections).toContain(false);
    expect(connections).toContain(true);
    coordinator.destroy();
  });

  it('ignores a late result from a timed out request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let resolveFirst: ((value: string) => void) | undefined;
    let calls = 0;
    const delivered: string[] = [];
    const coordinator = new PollingCoordinator<string>({
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) return new Promise<string>((resolve) => { resolveFirst = resolve; });
        return 'retry-result';
      },
      onData: (data) => delivered.push(data),
      onConnectionChange: () => {},
      requestTimeoutMs: 15,
      intervalMs: 1000,
      maxBackoffMs: 20,
      isHidden: () => false
    });

    coordinator.start('late-result');
    await wait(60);
    resolveFirst?.('stale-result');
    await wait(10);

    expect(delivered).toEqual(['retry-result']);
    coordinator.destroy();
  });

  it('stop aborts the request and clears timeout and scheduled poll timers', async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    const coordinator = new PollingCoordinator<string>({
      fetchFn: async (_identifier, requestSignal) => {
        calls += 1;
        signal = requestSignal;
        if (calls === 1) return new Promise<string>(() => {});
        return 'ok';
      },
      onData: () => {},
      onConnectionChange: () => {},
      requestTimeoutMs: 200,
      intervalMs: 1000,
      isHidden: () => false
    });

    coordinator.start('stop');
    await wait(5);
    coordinator.stop();
    await wait(20);

    expect(signal?.aborted).toBe(true);
    expect(coordinator.isPollingBusy).toBe(false);
    expect(coordinator.hasScheduledTimer).toBe(false);
    expect(calls).toBe(1);
    coordinator.destroy();
  });

  it('switching identifiers cancels a stalled request without blocking the new identifier', async () => {
    let resolveOld: ((value: string) => void) | undefined;
    const delivered: string[] = [];
    const coordinator = new PollingCoordinator<string>({
      fetchFn: async (identifier) => {
        if (identifier === 'old') return new Promise<string>((resolve) => { resolveOld = resolve; });
        return 'new-result';
      },
      onData: (data) => delivered.push(data),
      onConnectionChange: () => {},
      requestTimeoutMs: 500,
      intervalMs: 1000,
      isHidden: () => false
    });

    coordinator.start('old');
    await wait(5);
    coordinator.start('new');
    await wait(10);
    resolveOld?.('old-result');
    await wait(10);

    expect(delivered).toEqual(['new-result']);
    expect(coordinator.activeIdentifier).toBe('new');
    coordinator.destroy();
  });
});
