import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { FindingStatus } from '../../../generated/prisma/client';

export class UpdateFindingStatusDto {
  @ApiProperty({ enum: Object.values(FindingStatus), example: 'INVESTIGATING' })
  @IsEnum(FindingStatus)
  status!: FindingStatus;
}
