import { IsUUID } from 'class-validator';

export class ImportIdParamDto {
  /** Present because the global pipe validates the whole params object. */
  @IsUUID('4')
  organizationId!: string;

  @IsUUID('4')
  importId!: string;
}
