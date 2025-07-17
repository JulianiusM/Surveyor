// lib/errors.js
// Custom error types for centralized error handling in Express routes

/**
 * Represents a validation or business logic error that should render
 * a specific template with associated data.
 *
 * @property {string} template - The view/template to render on error.
 * @property {object} data - Contextual data to pass back to the template.
 */
class ValidationError extends Error {
    /**
     * @param {string} template - Template name or identifier for rendering.
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     */
    constructor(template, message, data = {}) {
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
 * @property {int} status - HTTP status
 */
class APIError extends Error {
    /**
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     * @param {int} status - HTTP status
     */
    constructor(message, data = {}, status = 500) {
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
 * @property {int} status - HTTP status
 */
class ExpectedError extends Error {
    /**
     * @param {string} message - Error message to display.
     * @param {string} severity - Message severity (error - info - success)
     * @param {int} status - HTTP status
     * @param {object} data - Data to re-populate the form or context.
     */
    constructor(message, severity = 'error', status = 400, data = {}) {
        super(message);
        this.name = 'ExpectedError';
        this.severity = severity;
        this.data = data;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

module.exports = {
    ValidationError,
    APIError,
    ExpectedError,
};