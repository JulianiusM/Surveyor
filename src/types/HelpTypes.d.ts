import type {components} from './api/v1';

/** The existing fixed-source renderer and v1 client consume the same authored help shapes. */
export type HelpDocumentSummary = components['schemas']['HelpDocumentSummary'];
export type HelpNavigationGroup = components['schemas']['HelpNavigationGroup'];
export type HelpTocEntry = components['schemas']['HelpTocEntry'];
export type HelpSearchResult = components['schemas']['HelpSearchResult'];
export type HelpPageData = components['schemas']['HelpPageData'];
