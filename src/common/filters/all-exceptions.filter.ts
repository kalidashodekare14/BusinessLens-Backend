import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
  };
}

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details: ErrorDetail[];
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export function codeForStatus(status: number): string {
  if (STATUS_CODES[status]) {
    return STATUS_CODES[status];
  }
  return status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`;
}

/**
 * Turns any thrown value into the §12 error envelope. Never leaks stack traces,
 * internal messages or values to the client; unknown failures log server-side
 * with the request id and return a generic 500 (PROJECT_ARCHITECTURE.md §6.5, §12).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const normalized = this.normalize(exception);

    if (normalized.status >= 500) {
      const stack =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      const requestId = typeof res.locals?.requestId === 'string' ? res.locals.requestId : '-';
      this.logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} -> ${normalized.status} ${normalized.code}\n${stack}`,
        AllExceptionsFilter.name,
      );
    }

    res.status(normalized.status).json({
      error: { code: normalized.code, message: normalized.message, details: normalized.details },
    } satisfies ErrorEnvelope);
  }

  private normalize(exception: unknown): NormalizedError {
    if (!(exception instanceof HttpException)) {
      return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] };
    }

    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { status, code: codeForStatus(status), message: response, details: [] };
    }

    const body = response as Record<string, unknown>;
    const rawMessage = body.message;

    // ValidationPipe with errorFormat 'grouped': message is Record<field, messages[]>.
    if (
      status === 400 &&
      rawMessage !== undefined &&
      typeof rawMessage === 'object' &&
      !Array.isArray(rawMessage)
    ) {
      const details = Object.entries(rawMessage as Record<string, unknown>).flatMap(
        ([field, messages]) =>
          Array.isArray(messages)
            ? messages.map((m) => ({ field, message: String(m) }))
            : [{ field, message: String(messages) }],
      );
      return { status, code: 'VALIDATION_FAILED', message: 'Validation failed', details };
    }

    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage.map(String).join('; ')
          : exception.message;
    const code = typeof body.code === 'string' ? body.code : codeForStatus(status);
    const details = Array.isArray(body.details)
      ? (body.details as ErrorDetail[]).filter(
          (d) =>
            d !== null &&
            typeof d === 'object' &&
            typeof d.field === 'string' &&
            typeof d.message === 'string',
        )
      : [];

    return { status, code, message, details };
  }
}
