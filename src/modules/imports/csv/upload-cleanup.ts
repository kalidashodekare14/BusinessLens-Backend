import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

/** §8: uploads that were never processed are removed after 24 hours. */
export const ORPHANED_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Deletes `.csv` files in `uploadDir` whose modification time is older than
 * `maxAgeMs`. Only files directly inside the directory are touched, so a
 * symlinked directory or an unrelated file can never be removed through here.
 * Returns the number of files deleted.
 */
export async function removeOrphanedUploads(
  uploadDir: string,
  maxAgeMs: number = ORPHANED_UPLOAD_MAX_AGE_MS,
  now: Date = new Date(),
): Promise<number> {
  let entries;
  try {
    entries = await readdir(uploadDir, { withFileTypes: true });
  } catch (error) {
    // A missing upload directory simply means there is nothing to clean up.
    if (hasErrnoCode(error, 'ENOENT')) {
      return 0;
    }
    throw error;
  }

  const cutoff = now.getTime() - maxAgeMs;
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.csv') {
      continue;
    }

    const filePath = path.join(uploadDir, entry.name);
    try {
      const info = await stat(filePath);
      if (info.mtimeMs >= cutoff) {
        continue;
      }
      await unlink(filePath);
      removed += 1;
    } catch (error) {
      // A file that disappeared between readdir and unlink is already clean.
      if (hasErrnoCode(error, 'ENOENT')) {
        continue;
      }
      throw error;
    }
  }

  return removed;
}
