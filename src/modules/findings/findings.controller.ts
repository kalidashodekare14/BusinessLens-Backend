import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExplanationsService, type ExplanationQueuedView } from '../ai/explanations.service';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type {
  AuthenticatedUser,
  CurrentOrganization,
} from '../../common/types/authenticated-request';
import { FindingIdParamDto } from './dto/finding-id-param.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { ListFindingsQueryDto } from './dto/list-findings-query.dto';
import { NoteIdParamDto } from './dto/note-id-param.dto';
import { UpdateFindingStatusDto } from './dto/update-finding-status.dto';
import {
  FindingsService,
  type FindingDetailView,
  type FindingNoteView,
  type FindingPage,
  type FindingStatusView,
} from './findings.service';

@Controller('organizations/:organizationId/findings')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class FindingsController {
  constructor(
    private readonly findings: FindingsService,
    private readonly explanations: ExplanationsService,
  ) {}

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

  @Patch(':findingId/status')
  updateStatus(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FindingIdParamDto,
    @Body() body: UpdateFindingStatusDto,
  ): Promise<FindingStatusView> {
    return this.findings.updateStatus(organization.id, params.findingId, body.status, user.userId);
  }

  @Post(':findingId/notes')
  addNote(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FindingIdParamDto,
    @Body() body: CreateNoteDto,
  ): Promise<FindingNoteView> {
    return this.findings.addNote(organization.id, params.findingId, body.body, user.userId);
  }

  @Delete(':findingId/notes/:noteId')
  @HttpCode(204)
  deleteNote(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: NoteIdParamDto,
  ): Promise<void> {
    return this.findings.deleteNote(organization.id, params.findingId, params.noteId, user.userId);
  }

  @Post(':findingId/explanation')
  @HttpCode(202)
  regenerateExplanation(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FindingIdParamDto,
  ): Promise<ExplanationQueuedView> {
    return this.explanations.regenerate(organization.id, params.findingId, user.userId);
  }
}
