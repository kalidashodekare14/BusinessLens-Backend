import { IsUUID } from 'class-validator';

export class NoteIdParamDto {
  /** Present because the global pipe validates the whole params object. */
  @IsUUID('4')
  organizationId!: string;

  @IsUUID('4')
  findingId!: string;

  @IsUUID('4')
  noteId!: string;
}
