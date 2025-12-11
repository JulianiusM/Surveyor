import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';

export interface HelpTopic {
    slug: string;
    title: string;
    filename: string;
    description: string;
}

const topics: HelpTopic[] = [
    {
        slug: 'overview',
        title: 'Surveyor User Guide',
        filename: 'README.md',
        description: 'Overview of Surveyor features and quick navigation to each module.',
    },
    {
        slug: 'getting-started',
        title: 'Getting Started',
        filename: 'GETTING_STARTED.md',
        description: 'Account creation, login options, and how guest access works.',
    },
    {
        slug: 'dashboard',
        title: 'Dashboard',
        filename: 'DASHBOARD.md',
        description: 'Learn how to navigate your dashboard and manage your entities.',
    },
    {
        slug: 'surveys',
        title: 'Surveys',
        filename: 'SURVEYS.md',
        description: 'Create availability surveys and guide participants through voting.',
    },
    {
        slug: 'events',
        title: 'Events',
        filename: 'EVENTS.md',
        description: 'Create events, collect registrations, and link related resources.',
    },
    {
        slug: 'packing-lists',
        title: 'Packing Lists',
        filename: 'PACKING_LISTS.md',
        description: 'Coordinate shared packing lists and manage item assignments.',
    },
    {
        slug: 'activity-plans',
        title: 'Activity Plans',
        filename: 'ACTIVITY_PLANS.md',
        description: 'Schedule activities with slots, roles, and assignments.',
    },
    {
        slug: 'drivers-lists',
        title: 'Drivers Lists',
        filename: 'DRIVERS_LISTS.md',
        description: 'Organize transportation, drivers, and passengers.',
    },
    {
        slug: 'permissions',
        title: 'Permissions',
        filename: 'PERMISSIONS.md',
        description: 'Understand Surveyor permissions and how to configure them.',
    },
];

const docsCandidates = [
    path.resolve(__dirname, '../../docs/user-guide'),
    path.resolve(__dirname, '../../../docs/user-guide'),
];

const docsBasePath = docsCandidates.find(fs.existsSync) ?? docsCandidates[0];
const fileSlugMap = new Map<string, string>(topics.map(topic => [topic.filename.toLowerCase(), topic.slug]));
const contentCache = new Map<string, string>();
const markdown = new MarkdownIt({
    html: false,
    linkify: true,
});

function rewriteDocLinks(markdown: string): string {
    return markdown.replace(/\(([A-Za-z0-9_-]+\.md)(#[^)]+)?\)/g, (match, filename, anchor = '') => {
        const slug = fileSlugMap.get(filename.toLowerCase());
        if (!slug) {
            return match;
        }
        return `(/help/${slug}${anchor})`;
    });
}

function loadMarkdown(topic: HelpTopic): string {
    const cached = contentCache.get(topic.slug);
    if (cached) {
        return cached;
    }

    const filePath = path.join(docsBasePath, topic.filename);
    const markdownSource = fs.readFileSync(filePath, 'utf-8');
    const rewritten = rewriteDocLinks(markdownSource);
    const html = markdown.render(rewritten);
    contentCache.set(topic.slug, html);

    return html;
}

export function getHelpTopics(): HelpTopic[] {
    return topics;
}

export function getHelpContent(slug: string): {topic: HelpTopic; html: string} | null {
    const topic = topics.find(entry => entry.slug === slug);
    if (!topic) {
        return null;
    }

    return {
        topic,
        html: loadMarkdown(topic),
    };
}
