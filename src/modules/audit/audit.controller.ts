import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { CurrentOrganization } from '../../common/types/authenticated-request';
import { AuditLogPage, AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@Controller('organizations/:organizationId/audit-logs')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** OWNER only (§12). Returns this organization's audit trail, newest first. */
  @Get()
  @Roles('OWNER')
  list(
    @CurrentOrg() organization: CurrentOrganization,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<AuditLogPage> {
    return this.audit.list(organization.id, query.page, query.pageSize);
  }
}
