import { IsUUID } from 'class-validator';

export class FindingIdParamDto {
  /** Present because the global pipe validates the whole params object. */
  @IsUUID('4')
  organizationId!: string;

  @IsUUID('4')
  findingId!: string;
}
