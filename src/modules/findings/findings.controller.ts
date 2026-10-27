import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type { CurrentOrganization } from '../../common/types/authenticated-request';
import { FindingIdParamDto } from './dto/finding-id-param.dto';
import { ListFindingsQueryDto } from './dto/list-findings-query.dto';
import { FindingsService, type FindingDetailView, type FindingPage } from './findings.service';

@Controller('organizations/:organizationId/findings')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get()
  list(
    @CurrentOrg() organization: CurrentOrganization,
    @Query() query: ListFindingsQueryDto,
  ): Promise<FindingPage> {
    return this.findings.list(organization.id, query);
  }

  @Get(':findingId')
  get(
    @CurrentOrg() organization: CurrentOrganization,
    @Param() params: FindingIdParamDto,
  ): Promise<FindingDetailView> {
    return this.findings.get(organization.id, params.findingId);
  }
}
