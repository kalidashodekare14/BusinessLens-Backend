import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import type {
  AuthenticatedUser,
  CurrentOrganization,
} from '../../common/types/authenticated-request';
import { MAX_CSV_BYTES } from './csv/csv-content';
import { CreateImportDto } from './dto/create-import.dto';
import { ImportIdParamDto } from './dto/import-id-param.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';
import { UpdateImportMappingDto } from './dto/update-import-mapping.dto';
import {
  ImportsService,
  type ImportConfirmView,
  type ImportDetailView,
  type ImportErrorsPage,
  type ImportMappingView,
  type ImportPage,
  type ImportUploadView,
} from './imports.service';

@Controller('organizations/:organizationId/imports')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * The file stays in memory only until the header is validated, then is written
   * under UPLOAD_DIR. That avoids orphaned temp files when validation fails.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CSV_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImportDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ImportUploadView> {
    return this.imports.upload(organization.id, user.userId, dto.type, file);
  }

  @Get()
  list(
    @CurrentOrg() organization: CurrentOrganization,
    @Query() query: ListImportsQueryDto,
  ): Promise<ImportPage> {
    return this.imports.list(organization.id, query.page, query.pageSize);
  }

  @Get(':importId')
  get(
    @CurrentOrg() organization: CurrentOrganization,
    @Param() params: ImportIdParamDto,
  ): Promise<ImportDetailView> {
    return this.imports.get(organization.id, params.importId);
  }

  @Get(':importId/errors')
  errors(
    @CurrentOrg() organization: CurrentOrganization,
    @Param() params: ImportIdParamDto,
    @Query() query: ListImportsQueryDto,
  ): Promise<ImportErrorsPage> {
    return this.imports.errors(organization.id, params.importId, query.page, query.pageSize);
  }

  @Put(':importId/mapping')
  updateMapping(
    @CurrentOrg() organization: CurrentOrganization,
    @Param() params: ImportIdParamDto,
    @Body() dto: UpdateImportMappingDto,
  ): Promise<ImportMappingView> {
    return this.imports.updateMapping(organization.id, params.importId, dto.mapping);
  }

  @Post(':importId/confirm')
  @HttpCode(202)
  confirm(
    @CurrentOrg() organization: CurrentOrganization,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ImportIdParamDto,
  ): Promise<ImportConfirmView> {
    return this.imports.confirm(organization.id, user.userId, params.importId);
  }
}
