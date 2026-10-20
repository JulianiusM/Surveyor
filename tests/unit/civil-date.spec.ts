import {describe, expect, it} from 'vitest';
import {civilDateWeeks, formatCivilDate} from '../../src/modules/lib/civilDate';
import {formatEventCivilDate, formatEventDate, formatEventTimestamp} from '../../src/frontend/features/event/presentation';

describe('shared civil calendar presentation', () => {
    it.each([
        {start: '2032-02-28', end: '2032-03-02', weeks: [
            {start: '2032-02-23', days: ['2032-02-28', '2032-02-29']},
            {start: '2032-03-01', days: ['2032-03-01', '2032-03-02']}]},
        {start: '2027-12-31', end: '2028-01-03', weeks: [
            {start: '2027-12-27', days: ['2027-12-31', '2028-01-01', '2028-01-02']},
            {start: '2028-01-03', days: ['2028-01-03']}]},
        {start: '0099-01-01', end: '0099-01-02', weeks: [
            {start: '0098-12-29', days: ['0099-01-01', '0099-01-02']}]},
        {start: '0000-01-01', end: '0000-01-02', weeks: [
            {start: '-000001-12-27', days: ['0000-01-01', '0000-01-02']}]},
        {start: '1000-01-01', end: '1000-01-02', weeks: [
            {start: '0999-12-30', days: ['1000-01-01', '1000-01-02']}]},
    ])('clips $start through $end to their actual Monday weeks', ({start, end, weeks}) => {
        expect(civilDateWeeks(start, end)).toEqual(weeks);
    });

    it.each(['', '2027-02-29', '2027-04-31', '2027-13-01', '2027-06-1', '2027-06-01T12:00:00Z'])
    ('rejects an invalid civil input without normalizing it: %s', value => {
        expect(formatCivilDate(value, 'en')).toBeNull();
        expect(civilDateWeeks(value, '2027-06-03')).toEqual([]);
        expect(civilDateWeeks('2027-06-01', value)).toEqual([]);
    });

    it('keeps an inverted range empty and does not mutate later calls or date inputs', () => {
        expect(civilDateWeeks('2027-06-03', '2027-06-01')).toEqual([]);
        const first = civilDateWeeks('2027-06-01', '2027-06-01');
        first[0].days.push('not a stored date');
        expect(civilDateWeeks('2027-06-01', '2027-06-01'))
            .toEqual([{start: '2027-05-31', days: ['2027-06-01']}]);
    });

    it('formats the stored weekday/day in the selected locale and keeps feature fallbacks', () => {
        expect(formatCivilDate('2030-06-01', 'en', {weekday: 'short', timeZone: 'America/Los_Angeles'})).toBe('Sat');
        expect(formatCivilDate('2030-06-01', 'en')).toBe('6/1/2030');
        expect(formatCivilDate('2030-06-01', 'de')).toBe('1.6.2030');
        expect(formatEventCivilDate('2030-06-01', 'en')).toBe('Saturday, June 1, 2030');
        expect(formatEventDate('2030-06-01', 'de')).toBe('1.6.2030');
        expect(formatEventCivilDate('invalid', 'en')).toBe('Invalid Date');
        expect(formatEventDate('invalid', 'en')).toBe('invalid');
        expect(formatEventDate(null, 'de')).toBe('—');
        expect(formatEventDate(undefined, 'en')).toBe('—');
        expect(formatEventTimestamp(null, 'de')).toBe('—');
        expect(formatEventTimestamp('invalid', 'en')).toBe('—');
    });
});
