import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class NoteIdParamDto {
  /** Present because the global pipe validates the whole params object. */
  @ApiProperty({ format: 'uuid', example: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d' })
  @IsUUID('4')
  organizationId!: string;

  @ApiProperty({ format: 'uuid', example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' })
  @IsUUID('4')
  findingId!: string;

  @ApiProperty({ format: 'uuid', example: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' })
  @IsUUID('4')
  noteId!: string;
}
