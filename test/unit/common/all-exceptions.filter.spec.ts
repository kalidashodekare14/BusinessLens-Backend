import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { AllExceptionsFilter } from '../../../src/common/filters/all-exceptions.filter';

class ProbeDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;
}

function makeHost(): {
  res: { status: jest.Mock; json: jest.Mock; locals: { requestId: string } };
  host: ArgumentsHost;
} {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    locals: { requestId: 'test-rid' },
  };
  const req = { method: 'POST', originalUrl: '/api/v1/probe' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { res, host };
}

async function runValidationPipe(value: unknown): Promise<unknown> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorFormat: 'grouped',
  });
  try {
    await pipe.transform(value, { type: 'body', metatype: ProbeDto });
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('maps validation failures to 400 VALIDATION_FAILED with field details', async () => {
    const { res, host } = makeHost();
    const exception = await runValidationPipe({});
    expect(exception).toBeDefined();

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe('Validation failed');
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'name', message: 'name must be a string' },
        { field: 'email', message: 'email must be an email' },
      ]),
    );
    expect(body.error.details).toHaveLength(2);
    expect(body.error).not.toHaveProperty('stack');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('maps forbidden unknown properties to field details', async () => {
    const { res, host } = makeHost();
    const exception = await runValidationPipe({ name: 'x', email: 'a@b.co', extra: 1 });

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'extra' })]),
    );
  });

  it('maps NotFoundException to 404 NOT_FOUND', () => {
    const { res, host } = makeHost();
    filter.catch(new NotFoundException(), host);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual([]);
  });

  it('keeps a string message from BadRequestException', () => {
    const { res, host } = makeHost();
    filter.catch(new BadRequestException('boom'), host);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toEqual({
      error: { code: 'BAD_REQUEST', message: 'boom', details: [] },
    });
  });

  it('returns a generic 500 without leaking internals and logs server-side with the request id', () => {
    const { res, host } = makeHost();
    const secret = 'SELECT * FROM users WHERE password';
    filter.catch(new Error(`connect ECONNREFUSED: ${secret}`), host);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] },
    });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('at ');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('test-rid');
    expect(String(errorSpy.mock.calls[0][0])).toContain(secret);
  });
});
