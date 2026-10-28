import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ImportType } from '../../../generated/prisma/client';

export class CreateImportDto {
  @ApiProperty({ enum: Object.values(ImportType), example: 'ORDERS', description: 'CSV upload type.' })
  @IsEnum(ImportType)
  type!: ImportType;
}
