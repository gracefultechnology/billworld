// Shared stop-service "done" state for a withdrawn request.
// server.mjs redirects every cancel-flow POST without a `next` (including step=undo) to ?step=done, so the
// done renderer must not reuse the stop confirmation when the service is active again (no blank end date).
import { html } from '../kit.mjs';
export const withdrawn = vm => vm?.service?.status === 'active';
export const withdrawnView = (vm, { noun = 'service', home = 'dashboard' } = {}) => html`<h1>Request withdrawn</h1><section class="card ok"><p role="status">Your stop-service request was withdrawn. Your ${noun} will continue with no interruption and nothing else changes on your account.</p><p><a href="${vm.url(home)}">Return to your account</a></p></section>`;
