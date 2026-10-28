import { Logger } from '@nestjs/common';
import { AuditAction } from '../../../src/modules/audit/audit.actions';
import { AuditService } from '../../../src/modules/audit/audit.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { TenantPrismaService } from '../../../src/prisma/tenant-prisma.service';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuditService', () => {
  let prismaCreateMany: jest.Mock;
  let txCreateMany: jest.Mock;
  let run: jest.Mock;
  let service: AuditService;

  beforeEach(() => {
    prismaCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    txCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    run = jest.fn(async (_organizationId: string, callback: (tx: unknown) => Promise<void>) =>
      callback({ auditLog: { createMany: txCreateMany } }),
    );
    service = new AuditService(
      { auditLog: { createMany: prismaCreateMany } } as unknown as PrismaService,
      { run } as unknown as TenantPrismaService,
    );
  });

  it('writes organization-scoped events through the tenant transaction', async () => {
    service.record({
      action: AuditAction.ORGANIZATION_UPDATED,
      actorId: 'user-1',
      organizationId: 'org-1',
      entityType: 'Organization',
      entityId: 'org-1',
    });

    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(txCreateMany).toHaveBeenCalledWith({
      data: [
        {
          action: 'organization.updated',
          actorId: 'user-1',
          organizationId: 'org-1',
          entityType: 'Organization',
          entityId: 'org-1',
        },
      ],
    });
    expect(prismaCreateMany).not.toHaveBeenCalled();
  });

  it('writes null-organization events without a tenant transaction', async () => {
    service.record({
      action: AuditAction.AUTH_LOGIN_FAILED,
      metadata: { reason: 'invalid_credentials' },
    });

    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(txCreateMany).not.toHaveBeenCalled();
    expect(prismaCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          action: 'auth.login_failed',
          actorId: null,
          metadata: { reason: 'invalid_credentials' },
        }),
      ],
    });
  });

  it('never throws or rejects when the write fails', async () => {
    txCreateMany.mockRejectedValue(new Error('permission denied'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      expect(() =>
        service.record({
          action: AuditAction.AUTH_REGISTER,
          actorId: 'user-1',
          organizationId: 'org-1',
        }),
      ).not.toThrow();

      await expect(flush()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('Failed to write audit event auth.register');
    } finally {
      warn.mockRestore();
    }
  });
});
