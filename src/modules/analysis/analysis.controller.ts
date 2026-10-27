import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type {
  AuthenticatedUser,
  CurrentOrganization,
} from '../../common/types/authenticated-request';
import {
  AnalysisService,
  type AnalysisRunCreatedView,
  type AnalysisRunDetailView,
  type AnalysisRunPage,
} from './analysis.service';
import { AnalysisRunIdParamDto } from './dto/analysis-run-id-param.dto';
import { ListAnalysisRunsQueryDto } from './dto/list-analysis-runs-query.dto';

@Controller('organizations/:organizationId/analysis-runs')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post()
  @HttpCode(202)
  create(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AnalysisRunCreatedView> {
    return this.analysis.create(organization.id, user.userId);
  }

  @Get()
  list(
    @CurrentOrg() organization: CurrentOrganization,
    @Query() query: ListAnalysisRunsQueryDto,
  ): Promise<AnalysisRunPage> {
    return this.analysis.list(organization.id, query.page, query.pageSize);
  }

  @Get(':analysisRunId')
  get(
    @CurrentOrg() organization: CurrentOrganization,
    @Param() params: AnalysisRunIdParamDto,
  ): Promise<AnalysisRunDetailView> {
    return this.analysis.get(organization.id, params.analysisRunId);
  }
}
