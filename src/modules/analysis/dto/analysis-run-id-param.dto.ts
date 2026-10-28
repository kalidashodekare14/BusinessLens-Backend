import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AnalysisRunIdParamDto {
  /** Present because the global pipe validates the whole params object. */
  @ApiProperty({ format: 'uuid', example: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d' })
  @IsUUID('4')
  organizationId!: string;

  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  @IsUUID('4')
  analysisRunId!: string;
}
