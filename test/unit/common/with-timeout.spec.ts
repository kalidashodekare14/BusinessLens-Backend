import { withTimeout } from '../../../src/common/utils/with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('propagates the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with a timeout error when the promise never settles', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 100, 'check timed out');
    const assertion = expect(pending).rejects.toThrow('check timed out');
    await jest.advanceTimersByTimeAsync(101);
    await assertion;
  });
});
