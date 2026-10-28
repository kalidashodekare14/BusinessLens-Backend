import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ImportIdParamDto {
  /** Present because the global pipe validates the whole params object. */
  @ApiProperty({ format: 'uuid', example: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d' })
  @IsUUID('4')
  organizationId!: string;

  @ApiProperty({ format: 'uuid', example: 'f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b' })
  @IsUUID('4')
  importId!: string;
}
