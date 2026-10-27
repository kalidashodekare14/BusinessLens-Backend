import {
  Body,
  Controller,
  Param,
  Post,
  Put,
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
import { UpdateImportMappingDto } from './dto/update-import-mapping.dto';
import { ImportsService, type ImportMappingView, type ImportUploadView } from './imports.service';

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

  @Put(':importId/mapping')
  updateMapping(
    @CurrentOrg() organization: CurrentOrganization,
    @Param() params: ImportIdParamDto,
    @Body() dto: UpdateImportMappingDto,
  ): Promise<ImportMappingView> {
    return this.imports.updateMapping(organization.id, params.importId, dto.mapping);
  }
}
