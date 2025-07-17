// lib/errors.js
// Custom error types for centralized error handling in Express routes

/**
 * Represents a validation or business logic error that should render
 * a specific template with associated data.
 *
 * @property {string} template - The view/template to render on error.
 * @property {object} data - Contextual data to pass back to the template.
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Validation... Remove this comment to see the full error message
class ValidationError extends Error {
    data: any;
    template: any;
    /**
     * @param {string} template - Template name or identifier for rendering.
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     */
    constructor(template: any, message: any, data = {}) {
        super(message);
        this.name = 'ValidationError';
        this.template = template;
        this.data = data;
        // @ts-expect-error TS(2339): Property 'captureStackTrace' does not exist on typ... Remove this comment to see the full error message
        if (Error.captureStackTrace) {
            // @ts-expect-error TS(2339): Property 'captureStackTrace' does not exist on typ... Remove this comment to see the full error message
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
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'APIError'.
class APIError extends Error {
    data: any;
    status: any;
    /**
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     * @param {int} status - HTTP status
     */
    constructor(message: any, data = {}, status = 500) {
        super(message);
        this.name = 'APIError';
        this.data = data;
        this.status = status;
        // @ts-expect-error TS(2339): Property 'captureStackTrace' does not exist on typ... Remove this comment to see the full error message
        if (Error.captureStackTrace) {
            // @ts-expect-error TS(2339): Property 'captureStackTrace' does not exist on typ... Remove this comment to see the full error message
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
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'ExpectedEr... Remove this comment to see the full error message
class ExpectedError extends Error {
    data: any;
    severity: any;
    /**
     * @param {string} message - Error message to display.
     * @param {string} severity - Message severity (error - info - success)
     * @param {int} status - HTTP status
     * @param {object} data - Data to re-populate the form or context.
     */
    constructor(message: any, severity = 'error', status = 400, data = {}) {
        super(message);
        this.name = 'ExpectedError';
        this.severity = severity;
        this.data = data;
        // @ts-expect-error TS(2339): Property 'captureStackTrace' does not exist on typ... Remove this comment to see the full error message
        if (Error.captureStackTrace) {
            // @ts-expect-error TS(2339): Property 'captureStackTrace' does not exist on typ... Remove this comment to see the full error message
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {
    ValidationError,
    APIError,
    ExpectedError,
};