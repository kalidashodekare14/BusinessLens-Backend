import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { accessLogMiddleware, resolveRequestId } from '../../../src/common/request-id';

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

describe('accessLogMiddleware', () => {
  it('logs only method, path, status, duration and request id', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const emitter = new EventEmitter();
      const res = Object.assign(emitter, {
        locals: { requestId: 'rid-123' },
        statusCode: 418,
      }) as unknown as Response;
      const req = {
        method: 'POST',
        originalUrl: '/api/v1/auth/login',
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'bl_refresh=secret-cookie',
        },
        body: { password: 'secret-password' },
      } as unknown as Request;

      accessLogMiddleware(req, res, (() => undefined) as NextFunction);
      emitter.emit('finish');

      const line = String(logSpy.mock.calls[0]?.[0]);
      expect(line).toMatch(/^POST \/api\/v1\/auth\/login 418 \d+ms rid=rid-123$/);
      expect(line).not.toContain('secret');
      expect(line).not.toContain('authorization');
      expect(line).not.toContain('cookie');
    } finally {
      logSpy.mockRestore();
    }
  });
});
