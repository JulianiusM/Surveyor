import type {StructuredEmailContent} from '../../src/modules/email';

export function createStructuredEmailContent(
    overrides: Partial<StructuredEmailContent> = {},
): StructuredEmailContent {
    return {
        eyebrow: 'Event update',
        heading: 'Your event details are ready',
        preheader: 'A concise summary of your event update.',
        greeting: 'Hello Taylor,',
        paragraphs: ['Everything is ready for your upcoming event.'],
        details: [
            {label: 'Event', value: 'Summer retreat'},
            {label: 'Status', value: 'Confirmed'},
        ],
        sections: [{title: 'Next steps', items: ['Review your details', 'Contact the organizer with questions']}],
        action: {label: 'View event', url: 'https://surveyor.example/event/event-1'},
        notice: 'Keep your personal access links private.',
        ...overrides,
    };
}
