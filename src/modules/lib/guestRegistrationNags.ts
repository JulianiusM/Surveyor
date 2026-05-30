export type GuestRegistrationNags = {
    accountRecommendationTitle?: string;
    accountRecommendation?: string;
    linkWarning: string;
    emailRecommendation: string;
    submitConfirmation?: string;
};

export function getGuestRegistrationNags(entityType: string): GuestRegistrationNags {
    if (entityType === 'event') {
        return {
            accountRecommendationTitle: 'Best for events',
            accountRecommendation: 'A full user account is the safest way to keep access to your registration and all linked planning data.',
            linkWarning: 'If you continue as a guest, you must save your personal link. Losing it means you can lose access to your event registration and linked packing lists or activity plans.',
            emailRecommendation: 'Please add an email address so we can send your personal link to your inbox and reduce the risk of losing it.',
            submitConfirmation: 'You are about to continue as a guest. You will need to save your personal link to access your event registration later. Continue?',
        };
    }

    return {
        linkWarning: 'Use the personal link you’ll receive to edit your submission later. Keep it safe.',
        emailRecommendation: 'We’ll send your private edit link here. If you skip this, make sure to save the link after submitting.',
    };
}
