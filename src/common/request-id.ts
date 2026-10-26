import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const accessLogger = new Logger('Http');

/**
 * Accepts only a safe inbound X-Request-Id (echoed for correlation), otherwise
 * issues a fresh UUID. Never taken from request bodies or query strings.
 */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.header('x-request-id'));
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

/** One line per response: method, path, status, duration, request id. Never bodies or tokens. */
export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const requestId = typeof res.locals?.requestId === 'string' ? res.locals.requestId : '-';
    accessLogger.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms rid=${requestId}`,
    );
  });
  next();
}
