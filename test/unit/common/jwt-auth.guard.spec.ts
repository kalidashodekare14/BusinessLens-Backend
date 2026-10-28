import { ExecutionContext, HttpException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../src/common/types/authenticated-request';

function createContext(headers: Record<string, string | undefined>) {
  const request = { headers } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function expectUnauthorized(error: unknown): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpError = error as HttpException;
  expect(httpError.getStatus()).toBe(401);
  expect(httpError.getResponse()).toMatchObject({
    code: 'UNAUTHORIZED',
    message: 'Authentication required.',
  });
}

describe('JwtAuthGuard', () => {
  let verifyAsync: jest.Mock;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    verifyAsync = jest.fn();
    guard = new JwtAuthGuard({ verifyAsync } as unknown as JwtService);
  });

  it.each([
    ['missing header', {}],
    ['wrong scheme', { authorization: 'Basic abc' }],
    ['empty bearer', { authorization: 'Bearer   ' }],
  ])('rejects a %s without calling JWT verification', async (_name, headers) => {
    const { context } = createContext(headers);
    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expectUnauthorized(error);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const { context } = createContext({ authorization: 'Bearer bad-token' });

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expectUnauthorized(error);
    expect(verifyAsync).toHaveBeenCalledWith('bad-token');
  });

  it.each([[{}], [{ sub: '' }], [{ sub: 123 }]])(
    'rejects a payload without a valid sub claim (%p)',
    async (payload) => {
      verifyAsync.mockResolvedValue(payload);
      const { context } = createContext({ authorization: 'Bearer token' });

      const error = await guard.canActivate(context).catch((e: unknown) => e);

      expectUnauthorized(error);
    },
  );

  it('attaches only the verified user id and allows the request', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-1', organizationId: 'ignored' });
    const { context, request } = createContext({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual({ userId: 'user-1' });
  });
});
