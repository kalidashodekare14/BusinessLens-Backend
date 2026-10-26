import { HttpException } from '@nestjs/common';
import { TenantContextService } from '../../../src/prisma/tenant-context.service';
import { TenantPrismaService } from '../../../src/prisma/tenant-prisma.service';

describe('TenantContextService', () => {
  let run: jest.Mock;
  let tenantPrisma: TenantPrismaService;

  beforeEach(() => {
    run = jest.fn().mockResolvedValue('ok');
    tenantPrisma = { run } as unknown as TenantPrismaService;
  });

  it('uses the guard-verified organization, not the body or query', async () => {
    const service = new TenantContextService(
      {
        organization: { id: 'verified-org' },
        body: { organizationId: 'body-org' },
        query: { organizationId: 'query-org' },
      } as never,
      tenantPrisma,
    );

    await expect(service.run(async () => 'ok')).resolves.toBe('ok');

    expect(run).toHaveBeenCalledWith('verified-org', expect.any(Function));
  });

  it('rejects when the guard did not attach an organization', () => {
    const service = new TenantContextService({} as never, tenantPrisma);

    expect(() => service.organizationId).toThrow(HttpException);
    expect(run).not.toHaveBeenCalled();
  });
});
