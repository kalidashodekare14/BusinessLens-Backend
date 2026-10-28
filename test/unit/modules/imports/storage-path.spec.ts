import path from 'node:path';
import { resolveUploadPath } from '../../../../src/modules/imports/csv/storage-path';

describe('resolveUploadPath', () => {
  const uploadDir = path.resolve('uploads');

  it('accepts a file directly inside the upload directory', () => {
    const stored = path.join(uploadDir, 'job.csv');

    expect(resolveUploadPath(uploadDir, stored)).toBe(stored);
  });

  it.each([
    ['a parent traversal', path.join(uploadDir, '..', 'secret.csv')],
    ['an absolute sibling', path.join(path.dirname(uploadDir), 'secret.csv')],
    ['the upload directory itself', uploadDir],
  ])('rejects %s', (_case, stored) => {
    expect(resolveUploadPath(uploadDir, stored)).toBeNull();
  });

  it('resolves relative paths before checking them', () => {
    expect(resolveUploadPath('uploads', path.join('uploads', 'job.csv'))).toBe(
      path.join(uploadDir, 'job.csv'),
    );
  });
});
