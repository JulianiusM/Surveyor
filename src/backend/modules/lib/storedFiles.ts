import path from 'node:path';

/** Resolve the existing application-relative stored-file confinement policy.
 * This lexical check performs no I/O and grants no authority. Callers retain
 * their authorization, status, streaming/read and best-effort deletion behavior. */
export function resolveStoredFile(directory: string, storedPath: string): string | null {
    // Resolve both values in the same working-directory context. Preserve the
    // established '..' prefix rule, including its treatment of sibling names;
    // realpath/symlink policy is a separate recorded decision, not this reuse.
    const root = path.resolve(process.cwd(), directory);
    const file = path.resolve(process.cwd(), storedPath);
    const relative = path.relative(root, file);
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : file;
}
