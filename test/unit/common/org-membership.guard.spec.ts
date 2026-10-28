import { ExecutionContext, HttpException } from '@nestjs/common';
import { OrgMembershipGuard } from '../../../src/common/guards/org-membership.guard';
import type { AuthenticatedRequest } from '../../../src/common/types/authenticated-request';
import type { PrismaService } from '../../../src/prisma/prisma.service';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

function createContext(params: Record<string, string>, user?: { userId: string }) {
  const request = { params, user } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('expected the guard to reject');
}

describe('OrgMembershipGuard', () => {
  let findUnique: jest.Mock;
  let guard: OrgMembershipGuard;

  beforeEach(() => {
    findUnique = jest.fn();
    guard = new OrgMembershipGuard({
      membership: { findUnique },
    } as unknown as PrismaService);
  });

  it('rejects a request with no authenticated user', async () => {
    const { context } = createContext({ organizationId: ORGANIZATION_ID });

    const error = await rejection(guard.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a malformed organization id with a validation error', async () => {
    const { context } = createContext({ organizationId: 'not-a-uuid' }, { userId: 'user-1' });

    const error = await rejection(guard.canActivate(context));

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'organizationId', message: 'organizationId must be a UUID' }],
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller has no membership', async () => {
    findUnique.mockResolvedValue(null);
    const { context } = createContext({ organizationId: ORGANIZATION_ID }, { userId: 'user-1' });

    const error = await rejection(guard.canActivate(context));

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Organization not found.',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: 'user-1', organizationId: ORGANIZATION_ID },
      },
      select: expect.any(Object),
    });
  });

  it('attaches the caller organization and role', async () => {
    const organization = {
      id: ORGANIZATION_ID,
      name: 'Acme',
      currency: 'USD',
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    findUnique.mockResolvedValue({ role: 'MEMBER', organization });
    const { context, request } = createContext(
      { organizationId: ORGANIZATION_ID },
      { userId: 'user-1' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.organization).toEqual({ ...organization, role: 'MEMBER' });
  });
});
