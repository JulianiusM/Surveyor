import {initAlertDismissal} from './shared/alerts';

let dispose: (() => void) | undefined;

function start(): void {
    dispose?.();
    dispose = initAlertDismissal();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
else start();

window.addEventListener('pagehide', () => {
    dispose?.();
    dispose = undefined;
});
window.addEventListener('pageshow', event => {
    if (event.persisted) start();
});
