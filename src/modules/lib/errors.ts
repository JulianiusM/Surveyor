// lib/errors.js
// Custom error types for centralized error handling in Express routes

/**
 * Represents a validation or business logic error that should render
 * a specific template with associated data.
 *
 * @property {string} template - The view/template to render on error.
 * @property {object} data - Contextual data to pass back to the template.
 */
export class ValidationError extends Error {
    data: any;
    template: any;

    /**
     * @param {string} template - Template name or identifier for rendering.
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     */
    constructor(template: any, message: any, data: object = {}) {
        super(message);
        this.name = 'ValidationError';
        this.template = template;
        this.data = data;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Represents a validation or business logic error that should return
 * some data as JSON
 *
 * @property {object} data - Contextual data to pass back to the client.
 * @property {number} status - HTTP status
 */
export class APIError extends Error {
    data: any;
    status: any;

    /**
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     * @param {number} status - HTTP status
     */
    constructor(message: any, data: object = {}, status: number = 500) {
        super(message);
        this.name = 'APIError';
        this.data = data;
        this.status = status;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Represents a validation or business logic error that should render
 * a non-critical error message
 *
 * @property {string} severity - Message severity (error - info - success)
 * @property {object} data - Contextual data to pass back to the client.
 * @property {number} status - HTTP status
 */
export class ExpectedError extends Error {
    data: any;
    severity: any;

    /**
     * @param {string} message - Error message to display.
     * @param {string} severity - Message severity (error - info - success)
     * @param {number} status - HTTP status
     * @param {object} data - Data to re-populate the form or context.
     */
    constructor(message: any, severity: string = 'error', status: number = 400, data: object = {}) {
        super(message);
        this.name = 'ExpectedError';
        this.severity = severity;
        this.data = data;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}