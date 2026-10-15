import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createUpdateCoordinator} from '../../src/frontend/app/updateCoordinator';

const original = {buildId: 'original', apiCompatibility: 'v1'};
const replacement = {buildId: 'replacement', apiCompatibility: 'v1'};

function allowsAutomaticReload(): boolean { return true; }

beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {getItem: (key: string) => storage.get(key),
        setItem: (key: string, value: string) => storage.set(key, value)});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('installed release replacement', () => {
    it('keeps a static document through release and chunk failures without blocking guarded deliberate recovery', async () => {
        const reload = vi.fn();
        const updates = createUpdateCoordinator(original, true, () => false, reload);
        let clean = false;
        updates.registerGuard(() => clean);
        updates.observe(replacement);
        updates.chunkFailed();
        await Promise.resolve();
        expect(updates.available.value).toBe(true);
        expect(updates.requestReload()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('surveyor:reload:original:replacement')).toBeUndefined();
        expect(updates.requestRecoveryReload()).toBe(false);

        // Static-route policy never substitutes for draft or admitted-command
        // protection. Deliberate recovery still waits for both owners to release.
        clean = true;
        const finish = updates.commandStarted();
        expect(updates.requestRecoveryReload()).toBe(false);
        finish();
        await Promise.resolve();
        expect(reload).not.toHaveBeenCalled();
        expect(updates.requestRecoveryReload()).toBe(true);
        expect(reload).toHaveBeenCalledOnce();
        updates.dispose();
    });

    it('consults live route policy when a delayed command releases an automatic replacement', async () => {
        const reload = vi.fn();
        let dynamic = true;
        const updates = createUpdateCoordinator(original, true, () => dynamic, reload);
        const finish = updates.commandStarted();
        updates.observe(replacement);
        await Promise.resolve();

        // A newly committed static visit must not inherit the source list's
        // reload permission when an older asynchronous command finally settles.
        dynamic = false;
        finish();
        await Promise.resolve();
        expect(reload).not.toHaveBeenCalled();
        expect(updates.requestReload()).toBe(false);

        dynamic = true;
        expect(updates.requestReload()).toBe(true);
        expect(reload).toHaveBeenCalledOnce();
        updates.dispose();
    });

    it('preserves a mounted draft and lets a compatible save finish before one reload', async () => {
        const reload = vi.fn();
        const updates = createUpdateCoordinator(original, true, allowsAutomaticReload, reload);
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
        const updates = createUpdateCoordinator(original, true, allowsAutomaticReload, reload);
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
            const updates = createUpdateCoordinator(original, true, allowsAutomaticReload, reload);
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
                const updates = createUpdateCoordinator(original, true, allowsAutomaticReload, reload);
                updates.chunkFailed();
                await Promise.resolve();
                expect(updates.available.value).toBe(true);
                expect(updates.requestReload()).toBe(false);
                updates.dispose();
            }
            expect(reload).not.toHaveBeenCalled();

            const deliberate = createUpdateCoordinator(original, true, allowsAutomaticReload, reload);
            expect(deliberate.requestRecoveryReload()).toBe(true);
            expect(deliberate.requestRecoveryReload()).toBe(false);
            expect(reload).toHaveBeenCalledTimes(1);
            deliberate.dispose();
        },
    );

    it('lets a deliberate retry bypass an existing marker while retaining draft and command guards', async () => {
        sessionStorage.setItem('surveyor:reload:original:original', '1');
        const reload = vi.fn();
        const updates = createUpdateCoordinator(original, true, allowsAutomaticReload, reload);
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
        const restored = createUpdateCoordinator(replacement, true, allowsAutomaticReload, reload);
        restored.observe(original);
        const server = createUpdateCoordinator(original, false, allowsAutomaticReload, reload);
        server.observe(replacement);
        await Promise.resolve();
        expect(reload).toHaveBeenCalledTimes(1);
        server.dispose(); restored.dispose();
    });
});
