/**
 * Test data for activity-filters module
 */

import {deepCopy} from "../helpers/util";

const _initDatesTestData = [
    {
        description: 'formats dates in table headers',
        date: '2024-03-15',
        expectedWeekday: 'Fri',
        expectedDate: '3/15/2024',
    },
    {
        description: 'handles different months correctly',
        date: '2024-12-25',
        expectedWeekday: 'Wed',
        expectedDate: '12/25/2024',
    },
    {
        description: 'handles year boundary',
        date: '2025-01-01',
        expectedWeekday: 'Wed',
        expectedDate: '1/1/2025',
    },
];

export const initDatesTestData = () => deepCopy(_initDatesTestData) as typeof _initDatesTestData;

const _initSlotFiltersTestData = [
    {
        description: 'shows all slots in all mode',
        filterMode: 'all',
        slots: [
            {dataset: {my: '0', open: '0'}, expectedVisible: true},
            {dataset: {my: '1', open: '0'}, expectedVisible: true},
            {dataset: {my: '0', open: '1'}, expectedVisible: true},
            {dataset: {my: '1', open: '1'}, expectedVisible: true},
        ],
    },
    {
        description: 'shows only my slots in mine mode',
        filterMode: 'mine',
        slots: [
            {dataset: {my: '0', open: '0'}, expectedVisible: false},
            {dataset: {my: '1', open: '0'}, expectedVisible: true},
            {dataset: {my: '0', open: '1'}, expectedVisible: false},
            {dataset: {my: '1', open: '1'}, expectedVisible: true},
        ],
    },
    {
        description: 'shows only open slots in open mode',
        filterMode: 'open',
        slots: [
            {dataset: {my: '0', open: '0'}, expectedVisible: false},
            {dataset: {my: '1', open: '0'}, expectedVisible: false},
            {dataset: {my: '0', open: '1'}, expectedVisible: true},
            {dataset: {my: '1', open: '1'}, expectedVisible: true},
        ],
    },
];

export const initSlotFiltersTestData = () => deepCopy(_initSlotFiltersTestData) as typeof _initSlotFiltersTestData;
