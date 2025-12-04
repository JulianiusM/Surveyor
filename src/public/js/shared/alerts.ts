/**
 * Shared alert/notification system
 * Provides consistent in-page alerts across the application
 */

/**
 * Show an inline alert message
 * @param status Alert type (success, info, error)
 * @param message Message to display
 */
export function showInlineAlert(status: 'success' | 'info' | 'error', message: string): void {
    const alertBox = document.getElementById('liveAlerts');
    if (!alertBox) return;

    const cls = {
        success: 'alert-success',
        info: 'alert-info',
        error: 'alert-danger',
    }[status] || 'alert-info';

    alertBox.innerHTML = `
      <div class="alert ${cls} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
}
