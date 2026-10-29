import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Request, Response} from 'express';
import {addNextQuery} from '../../src/backend/middleware/referrerUpdater';
import settings from '../../src/backend/modules/settings';

afterEach(() => vi.restoreAllMocks());

/** Isolate return selection; no Session, HTTP application or identity operation is constructed. */
function navigate(referrer?: string, query: Record<string, unknown> = {}, originalUrl = '/users/login',
    rootUrl = 'https://surveyor.example') {
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl});
    const request = {query, originalUrl, get: (name: string) => name === 'referer' ? referrer : undefined} as unknown as Request;
    const redirect = vi.fn();
    const next = vi.fn();
    addNextQuery('/users/login', '/users')(request, {redirect} as unknown as Response, next);
    return {redirect, next, request};
}

describe('identity entry referrer preservation', () => {
    it('keeps valid internal path, query and fragment with current presentation parameters', () => {
        const destination = '/packing/list?q=camp&view=all#item';
        const result = navigate(`https://surveyor.example${destination}`, {locale: 'de'}, '/users/login?locale=de');
        expect(result.redirect).toHaveBeenCalledWith(`/users/login?locale=de&next=${encodeURIComponent(destination)}`);
        expect(result.next).not.toHaveBeenCalled();
        expect('session' in result.request).toBe(false);
    });

    it.each(['/event/chosen', 'https://external.example/', ['/packing/first', '/drivers/second']])(
        'leaves an explicit next entirely with the existing entry sanitizer: %s', explicit => {
            const result = navigate('https://surveyor.example/packing/source', {next: explicit});
            expect(result.redirect).not.toHaveBeenCalled();
            expect(result.next).toHaveBeenCalledOnce();
            expect(result.request.query.next).toEqual(explicit);
        });

    it.each([undefined, 'invalid URL', 'https://external.example/packing/source',
        'https://surveyor.example.external.example/packing/source', 'http://surveyor.example/packing/source',
        'https://surveyor.example/', 'https://surveyor.example/users/profile',
        'https://surveyor.example/api/v1/packing-lists', 'https://surveyor.example/frontend-assets/private'])
        ('keeps the existing entry/provider default for an ineligible referrer: %s', referrer => {
            const result = navigate(referrer);
            expect(result.redirect).not.toHaveBeenCalled();
            expect(result.next).toHaveBeenCalledOnce();
        });

    it('fills an empty next and respects a configured application path boundary', () => {
        const result = navigate('https://surveyor.example/application/event/source', {next: ''},
            '/users/login?next=&locale=en', 'https://surveyor.example/application/');
        expect(result.redirect).toHaveBeenCalledWith('/users/login?next=%2Fevent%2Fsource&locale=en');
        expect(result.next).not.toHaveBeenCalled();
    });

    it('rejects another application whose path merely starts with the configured root', () => {
        const result = navigate('https://surveyor.example/application-other/packing/source', {},
            '/users/login', 'https://surveyor.example/application/');
        expect(result.redirect).not.toHaveBeenCalled();
        expect(result.next).toHaveBeenCalledOnce();
    });
});
