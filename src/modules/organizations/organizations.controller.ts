import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type {
  AuthenticatedUser,
  CurrentOrganization,
} from '../../common/types/authenticated-request';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsQueryDto } from './dto/list-organizations-query.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import {
  OrganizationsService,
  type OrganizationPage,
  type OrganizationView,
} from './organizations.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationView> {
    return this.organizations.create(user.userId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<OrganizationPage> {
    return this.organizations.listForUser(user.userId, query.page, query.pageSize);
  }

  @Get(':organizationId')
  @UseGuards(OrgMembershipGuard)
  get(@CurrentOrg() organization: CurrentOrganization): OrganizationView {
    return organization;
  }

  @Patch(':organizationId')
  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles('OWNER')
  async update(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationView> {
    const updated = await this.organizations.update(organization.id, dto, user.userId);
    return { ...updated, role: organization.role };
  }
}
