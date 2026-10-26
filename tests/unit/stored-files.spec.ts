import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {resolveStoredFile} from '../../src/backend/modules/lib/storedFiles';

describe('stored-file lexical confinement compatibility', () => {
    it('resolves relative and absolute stored references through the same configured root', () => {
        const root = path.resolve('uploads/headers');
        const expected = path.join(root, 'header.png');
        expect(resolveStoredFile('uploads/headers', 'uploads/headers/header.png')).toBe(expected);
        expect(resolveStoredFile(root, expected)).toBe(expected);
        expect(resolveStoredFile(root, path.join(root, 'nested', '..', 'header.png'))).toBe(expected);
    });

    it('retains parent/sibling rejection including the established double-dot filename prefix rule', () => {
        const root = path.resolve('uploads/headers');
        expect(resolveStoredFile(root, path.join(root, '..', 'private.png'))).toBeNull();
        expect(resolveStoredFile(root, root + '-sibling/header.png')).toBeNull();
        expect(resolveStoredFile(root, path.join(root, '..header.png'))).toBeNull();
    });

    it('does not invent filesystem existence or file-kind decisions', () => {
        const root = path.resolve('uploads/headers');
        expect(resolveStoredFile(root, root)).toBe(root);
        expect(resolveStoredFile(root, path.join(root, 'absent.png'))).toBe(path.join(root, 'absent.png'));
    });
});
