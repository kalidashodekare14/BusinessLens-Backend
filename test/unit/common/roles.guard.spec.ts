import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../src/common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../../src/common/types/authenticated-request';

function createContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function rejection(run: () => unknown): HttpException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('expected the guard to reject');
}

describe('RolesGuard', () => {
  let getAllAndOverride: jest.Mock;
  let guard: RolesGuard;

  beforeEach(() => {
    getAllAndOverride = jest.fn();
    guard = new RolesGuard({ getAllAndOverride } as unknown as Reflector);
  });

  it('allows routes without @Roles metadata', () => {
    getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext({}))).toBe(true);
  });

  it('allows a caller whose organization role matches', () => {
    getAllAndOverride.mockReturnValue(['OWNER']);

    expect(guard.canActivate(createContext({ organization: { role: 'OWNER' } as never }))).toBe(
      true,
    );
  });

  it('rejects a caller with a different membership role', () => {
    getAllAndOverride.mockReturnValue(['OWNER']);

    const error = rejection(() =>
      guard.canActivate(createContext({ organization: { role: 'MEMBER' } as never })),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects when no organization context is attached', () => {
    getAllAndOverride.mockReturnValue(['OWNER']);

    const error = rejection(() => guard.canActivate(createContext({})));

    expect(error.getStatus()).toBe(403);
  });
});
