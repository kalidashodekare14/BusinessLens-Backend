import { Logger } from '@nestjs/common';
import { AuditAction } from '../../../src/modules/audit/audit.actions';
import { AuditService } from '../../../src/modules/audit/audit.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuditService', () => {
  let createMany: jest.Mock;
  let service: AuditService;

  beforeEach(() => {
    createMany = jest.fn().mockResolvedValue({ count: 1 });
    service = new AuditService({
      auditLog: { createMany },
    } as unknown as PrismaService);
  });

  it('writes the event without requiring the caller to await', async () => {
    service.record({
      action: AuditAction.ORGANIZATION_UPDATED,
      actorId: 'user-1',
      organizationId: 'org-1',
      entityType: 'Organization',
      entityId: 'org-1',
    });

    await flush();

    expect(createMany).toHaveBeenCalledWith({
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
  });

  it('passes safe metadata through', async () => {
    service.record({
      action: AuditAction.AUTH_LOGIN_FAILED,
      metadata: { reason: 'invalid_credentials' },
    });

    await flush();

    expect(createMany).toHaveBeenCalledWith({
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
    createMany.mockRejectedValue(new Error('permission denied'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      expect(() =>
        service.record({
          action: AuditAction.AUTH_REGISTER,
          actorId: 'user-1',
        }),
      ).not.toThrow();

      await expect(flush()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('Failed to write audit event auth.register');
    } finally {
      warn.mockRestore();
    }
  });
});
