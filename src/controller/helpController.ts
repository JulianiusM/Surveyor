import fs from 'fs';
import {marked} from 'marked';
import path from 'path';
import {ExpectedError} from '../modules/lib/errors';

// Configure marked for safe HTML output
marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: false,
});

/**
 * Get the base directory for documentation files
 * In development, docs are in the project root
 * In production, docs are copied to dist/docs
 */
function getDocsBasePath(): string {
    if (process.env.NODE_ENV === 'production') {
        return path.join(__dirname, '..', 'docs', 'user-guide');
    }

    return path.join(__dirname, '..', '..', 'docs', 'user-guide');
}

/**
 * Security: Validate and resolve documentation file path
 * Prevents path traversal attacks
 */
function resolveDocPath(docName: string): string | null {
    const docsBasePath = getDocsBasePath();
    const requestedPath = path.join(docsBasePath, docName);
    const resolvedPath = path.resolve(requestedPath);
    const basePath = path.resolve(docsBasePath);

    // Ensure the resolved path is within the docs directory
    if (!resolvedPath.startsWith(basePath)) {
        return null;
    }

    // Ensure file exists and is a file (not directory)
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        return null;
    }

    return resolvedPath;
}

/**
 * Read and parse markdown file
 */
function readMarkdownFile(filePath: string): { content: string; title: string } | null {
    try {
        const markdown = fs.readFileSync(filePath, 'utf-8');
        const html = marked.parse(markdown) as string;

        // Extract title from first H1 heading
        const titleMatch = markdown.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : 'Help';

        return {content: html, title};
    } catch (error) {
        console.error('Error reading markdown file:', error);
        return null;
    }
}

/**
 * Get list of available documentation files
 */
function getDocsList(): Array<{ name: string; title: string; path: string }> {
    const docsBasePath = getDocsBasePath();

    try {
        const files = fs.readdirSync(docsBasePath)
            .filter(file => file.endsWith('.md'))
            .sort();

        return files.map(file => {
            const filePath = path.join(docsBasePath, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
            const docPath = file.replace('.md', '').toLowerCase();

            return {name: file, title, path: docPath};
        });
    } catch (error) {
        console.error('Error listing documentation files:', error);
        return [];
    }
}

/**
 * Fetch help index data
 */
export function fetchHelpIndex(): { title: string; content: string; docsList: any[]; currentDoc: string } {
    const docsList = getDocsList();

    // Default to README if available
    const readmePath = resolveDocPath('README.md');
    let content = '';
    let title = 'Help Center';

    if (readmePath) {
        const parsed = readMarkdownFile(readmePath);
        if (parsed) {
            content = parsed.content;
            title = parsed.title;
        }
    }

    return {
        title,
        content,
        docsList,
        currentDoc: 'readme',
    };
}

/**
 * Fetch specific help document data
 */
export function fetchHelpDoc(docName: string): { title: string; content: string; docsList: any[]; currentDoc: string } {
    const docsList = getDocsList();

    // Convert URL path back to filename (e.g., 'getting_started' -> 'GETTING_STARTED.md')
    const fileName = `${docName.toUpperCase()}.md`;
    const filePath = resolveDocPath(fileName);

    if (!filePath) {
        throw new ExpectedError('Documentation not found', 'error', 404);
    }

    const parsed = readMarkdownFile(filePath);
    if (!parsed) {
        throw new ExpectedError('Error loading documentation', 'error', 500);
    }

    return {
        title: parsed.title,
        content: parsed.content,
        docsList,
        currentDoc: docName.toLowerCase(),
    };
}
