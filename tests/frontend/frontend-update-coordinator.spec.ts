import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createUpdateCoordinator} from '../../src/frontend/app/updateCoordinator';

const original = {buildId: 'original', apiCompatibility: 'v1'};
const replacement = {buildId: 'replacement', apiCompatibility: 'v1'};
beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {getItem: (key: string) => storage.get(key),
        setItem: (key: string, value: string) => storage.set(key, value)});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('installed release replacement', () => {
    it('preserves a mounted draft and lets a compatible save finish before one reload', async () => {
        const reload = vi.fn();
        const updates = createUpdateCoordinator(original, true, reload);
        let dirty = true;
        updates.registerGuard(() => !dirty);
        updates.observe(replacement);
        await Promise.resolve();
        expect(updates.available.value).toBe(true);
        expect(updates.incompatible.value).toBe(false);
        expect(reload).not.toHaveBeenCalled();
        const finish = updates.commandStarted();
        dirty = false;
        expect(updates.requestReload()).toBe(false);
        finish();
        await Promise.resolve();
        updates.observe(replacement);
        await Promise.resolve();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('defers an incompatible update or retired lazy chunk while an uncertain command remains', async () => {
        const reload = vi.fn();
        const updates = createUpdateCoordinator(original, true, reload);
        let uncertain = true;
        updates.registerGuard(() => !uncertain);
        updates.observe({...replacement, apiCompatibility: 'v2'});
        updates.chunkFailed();
        await Promise.resolve();
        expect(updates.incompatible.value).toBe(true);
        expect(reload).not.toHaveBeenCalled();
        uncertain = false; // The user acknowledged departure; no command was replayed.
        expect(updates.requestReload()).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('prevents repeated unchanged-build chunk failures from becoming a reload loop', async () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('sessionStorage', {getItem: (key: string) => storage.get(key),
            setItem: (key: string, value: string) => storage.set(key, value)});
        const reload = vi.fn();
        for (let document = 0; document < 2; document++) {
            const updates = createUpdateCoordinator(original, true, reload);
            updates.chunkFailed();
            await Promise.resolve();
            updates.dispose();
        }
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it.each(['getter', 'read', 'write'] as const)(
        'retains explicit recovery without automatic document retries after storage %s failure', async phase => {
            if (phase === 'getter') {
                Object.defineProperty(globalThis, 'sessionStorage', {configurable: true,
                    get() { throw new Error('Storage unavailable'); }});
            } else {
                vi.stubGlobal('sessionStorage', {
                    getItem() { if (phase === 'read') throw new Error('Storage read failed'); return null; },
                    setItem() { throw new Error('Storage write failed'); },
                });
            }
            const reload = vi.fn();
            for (let document = 0; document < 2; document++) {
                const updates = createUpdateCoordinator(original, true, reload);
                updates.chunkFailed();
                await Promise.resolve();
                expect(updates.available.value).toBe(true);
                expect(updates.requestReload()).toBe(false);
                updates.dispose();
            }
            expect(reload).not.toHaveBeenCalled();

            const deliberate = createUpdateCoordinator(original, true, reload);
            expect(deliberate.requestRecoveryReload()).toBe(true);
            expect(deliberate.requestRecoveryReload()).toBe(false);
            expect(reload).toHaveBeenCalledTimes(1);
            deliberate.dispose();
        },
    );

    it('lets a deliberate retry bypass an existing marker while retaining draft and command guards', async () => {
        sessionStorage.setItem('surveyor:reload:original:original', '1');
        const reload = vi.fn();
        const updates = createUpdateCoordinator(original, true, reload);
        let clean = false;
        updates.registerGuard(() => clean);
        updates.chunkFailed();
        await Promise.resolve();
        expect(updates.requestReload()).toBe(false);
        expect(updates.requestRecoveryReload()).toBe(false);

        clean = true;
        const finish = updates.commandStarted();
        expect(updates.requestRecoveryReload()).toBe(false);
        finish();
        await Promise.resolve();
        expect(reload).not.toHaveBeenCalled();
        expect(updates.requestRecoveryReload()).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        updates.dispose();
    });

    it('allows restoring a fallback copy and never reloads from server rendering', async () => {
        const reload = vi.fn();
        const restored = createUpdateCoordinator(replacement, true, reload);
        restored.observe(original);
        const server = createUpdateCoordinator(original, false, reload);
        server.observe(replacement);
        await Promise.resolve();
        expect(reload).toHaveBeenCalledTimes(1);
        server.dispose(); restored.dispose();
    });
});
