/** Shared native/reactive alert observation. Defaults retain native DOM renewal.
 * A reactive receipt owns its translated content and its started dismissal deadline. */
export interface AlertObservationPolicy {
    onDismiss?: (element: HTMLElement) => void;
    onVisible?: (element: HTMLElement) => void;
    renewContent?: boolean;
    preserveStartedLifetime?: boolean;
}
