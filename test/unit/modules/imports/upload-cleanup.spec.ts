import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ORPHANED_UPLOAD_MAX_AGE_MS,
  removeOrphanedUploads,
} from '../../../../src/modules/imports/csv/upload-cleanup';

describe('removeOrphanedUploads', () => {
  let uploadDir: string;
  const now = new Date('2026-10-27T12:00:00.000Z');

  beforeEach(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bl-uploads-'));
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  async function writeAgedFile(name: string, ageMs: number): Promise<string> {
    const filePath = path.join(uploadDir, name);
    await writeFile(filePath, 'a,b\n1,2\n');
    const at = new Date(now.getTime() - ageMs);
    await utimes(filePath, at, at);
    return filePath;
  }

  it('removes csv files older than the cutoff and keeps fresh ones', async () => {
    await writeAgedFile('old.csv', ORPHANED_UPLOAD_MAX_AGE_MS + 60_000);
    await writeAgedFile('fresh.csv', ORPHANED_UPLOAD_MAX_AGE_MS - 60_000);

    await expect(removeOrphanedUploads(uploadDir, ORPHANED_UPLOAD_MAX_AGE_MS, now)).resolves.toBe(
      1,
    );
    await expect(readdir(uploadDir)).resolves.toEqual(['fresh.csv']);
  });

  it('removes a file exactly at the age limit only when it is older', async () => {
    await writeAgedFile('boundary.csv', ORPHANED_UPLOAD_MAX_AGE_MS);

    await expect(removeOrphanedUploads(uploadDir, ORPHANED_UPLOAD_MAX_AGE_MS, now)).resolves.toBe(
      0,
    );
    await expect(readdir(uploadDir)).resolves.toEqual(['boundary.csv']);
  });

  it('ignores non-csv files and nested directories', async () => {
    await writeAgedFile('old.csv', 48 * 60 * 60 * 1000);
    await writeAgedFile('notes.txt', 48 * 60 * 60 * 1000);
    await mkdir(path.join(uploadDir, 'nested.csv'));

    await expect(removeOrphanedUploads(uploadDir, ORPHANED_UPLOAD_MAX_AGE_MS, now)).resolves.toBe(
      1,
    );
    const remaining = await readdir(uploadDir);
    expect(remaining.sort()).toEqual(['nested.csv', 'notes.txt']);
  });

  it('returns zero when the upload directory does not exist', async () => {
    await expect(
      removeOrphanedUploads(path.join(uploadDir, 'missing'), ORPHANED_UPLOAD_MAX_AGE_MS, now),
    ).resolves.toBe(0);
  });
});
