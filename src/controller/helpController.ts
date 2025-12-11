import {Request, Response} from 'express';
import {marked} from 'marked';
import path from 'path';
import fs from 'fs';

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
    // In development, go up from src/controller to project root, then to docs/user-guide
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
        
        return { content: html, title };
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
            
            return { name: file, title, path: docPath };
        });
    } catch (error) {
        console.error('Error listing documentation files:', error);
        return [];
    }
}

/**
 * GET /help
 * Display help index
 */
export async function getHelpIndex(req: Request, res: Response): Promise<void> {
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
    
    res.render('help', {
        title,
        content,
        docsList,
        currentDoc: 'readme',
    });
}

/**
 * GET /help/:docName
 * Display specific help document
 */
export async function getHelpDoc(req: Request, res: Response): Promise<void> {
    const docName = req.params.docName;
    const docsList = getDocsList();
    
    // Convert URL path back to filename (e.g., 'getting_started' -> 'GETTING_STARTED.md')
    const fileName = `${docName.toUpperCase()}.md`;
    const filePath = resolveDocPath(fileName);
    
    if (!filePath) {
        res.status(404).render('error', {
            message: 'Documentation not found',
            error: { status: 404, stack: '' },
        });
        return;
    }
    
    const parsed = readMarkdownFile(filePath);
    if (!parsed) {
        res.status(500).render('error', {
            message: 'Error loading documentation',
            error: { status: 500, stack: '' },
        });
        return;
    }
    
    res.render('help', {
        title: parsed.title,
        content: parsed.content,
        docsList,
        currentDoc: docName.toLowerCase(),
    });
}
