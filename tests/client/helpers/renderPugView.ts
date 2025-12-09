/**
 * Helper to render Pug views into test DOM
 * Allows testing against real page structure instead of mocked DOM
 */

import path from "node:path";
import pug from "pug";

type Locals = Record<string, any>;

/**
 * Render a Pug view file and return the HTML
 * @param viewPath - Path to the Pug file relative to src/views (e.g., 'activity/activity-view.pug')
 * @param locals - Data to pass to the template
 * @param extractContent - If true, extract only the content block (skip layout)
 * @returns Rendered HTML string
 */
export function renderPugView(viewPath: string, locals: Locals = {}, extractContent = false): string {
    const viewsDir = path.resolve(__dirname, "../../../src/views");
    const fullPath = path.join(viewsDir, viewPath);

    // Default locals that are commonly used in views
    const defaultLocals = {
        permData: {
            entity: {
                has: () => false, // Default: no permissions
            }
        },
        data: {},
        user: null,
        ...locals
    };

    try {
        const html = pug.renderFile(fullPath, {
            filename: fullPath,
            basedir: viewsDir,
            ...defaultLocals
        });
        
        // If extractContent is true, try to extract just the main content
        if (extractContent) {
            const contentMatch = html.match(/<main[^>]*>([\s\S]*)<\/main>/);
            if (contentMatch) {
                return contentMatch[1];
            }
        }
        
        return html;
    } catch (error) {
        console.error(`Failed to render Pug view: ${viewPath}`, error);
        throw error;
    }
}

/**
 * Load a Pug view into the test DOM
 * @param viewPath - Path to the Pug file relative to src/views
 * @param locals - Data to pass to the template
 */
export function loadPugViewIntoDOM(viewPath: string, locals: Locals = {}): void {
    const html = renderPugView(viewPath, locals);
    document.body.innerHTML = html;
}

/**
 * Render just the content block of a view (without layout)
 * Useful for testing specific page sections
 */
export function renderPugViewContent(viewPath: string, locals: Locals = {}): string {
    // For views that extend layout, we might want to extract just the content
    // For now, just render the full view
    return renderPugView(viewPath, locals);
}
