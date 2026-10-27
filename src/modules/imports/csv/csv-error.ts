/** A safe, client-facing reason why an uploaded file cannot be treated as CSV. */
export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvValidationError';
  }
}
