import { IsObject } from 'class-validator';

export class UpdateImportMappingDto {
  /**
   * Canonical field name -> detected column header (or null). The service
   * validates the keys and values against the import type and detected headers.
   */
  @IsObject()
  mapping!: Record<string, unknown>;
}
