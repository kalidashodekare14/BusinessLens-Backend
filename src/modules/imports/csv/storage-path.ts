import path from 'node:path';

/**
 * Confines a stored upload path to UPLOAD_DIR. `storagePath` comes from the
 * database, but treating it as untrusted keeps a tampered row from reading
 * arbitrary files. Returns null instead of throwing so HTTP and worker callers
 * can choose their own safe response.
 */
export function resolveUploadPath(uploadDir: string, storagePath: string): string | null {
  const root = path.resolve(uploadDir);
  const resolved = path.resolve(storagePath);
  const relative = path.relative(root, resolved);

  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}
