import {initEntityArchive} from './modules/entity-archive';

// The page owns one binding, even when the same entity appears in several cards and a detail notice.
// Keep its disposer so navigation or a repeated initialization cannot leave duplicate click handlers.
let dispose: (() => void) | undefined;

/** Replace the page's previous binding after all server-rendered controls exist. */
function start(): void {
    dispose?.();
    dispose = initEntityArchive();
}

/** Release DOM listeners when navigating away, including when the browser caches this document. */
function stop(): void {
    dispose?.();
    dispose = undefined;
}

function refreshRestoredPage(event: PageTransitionEvent): void {
    // A cached page can contain stale capabilities or disabled controls from a completed request.
    // Only a back/forward-cache restoration needs this reload; an ordinary initial pageshow does not.
    if (event.persisted) {
        window.location.reload();
    }
}

// This entry point is loaded once by the archival mixin on feature and overview pages only.
// The ready-state branch also supports a module loaded after DOMContentLoaded has already fired.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
} else {
    start();
}

window.addEventListener('pagehide', stop);
// On cache restoration, reload the server projection instead of rebinding potentially stale controls.
window.addEventListener('pageshow', refreshRestoredPage);
