import { IsEnum } from 'class-validator';
import { ImportType } from '../../../generated/prisma/client';

export class CreateImportDto {
  @IsEnum(ImportType)
  type!: ImportType;
}
