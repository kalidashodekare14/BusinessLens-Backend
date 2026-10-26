import { resolveRequestId } from '../../../src/common/request-id';

describe('resolveRequestId', () => {
  it('keeps a safe inbound request id', () => {
    expect(resolveRequestId('e2e-abc_123')).toBe('e2e-abc_123');
  });

  it('issues a UUID when no id is provided', () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('rejects unsafe inbound values', () => {
    expect(resolveRequestId('x'.repeat(65))).not.toBe('x'.repeat(65));
    expect(resolveRequestId('has spaces')).not.toBe('has spaces');
    expect(resolveRequestId('drop;table')).not.toBe('drop;table');
    expect(resolveRequestId(42)).not.toBe('42');
  });
});
