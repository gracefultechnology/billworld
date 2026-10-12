// Shared stop-service "done" state for a withdrawn request.
// server.mjs redirects every cancel-flow POST without a `next` (including step=undo) to ?step=done, so the
// done renderer must not reuse the stop confirmation when the service is active again (no blank end date).
import { html } from '../kit.mjs';
export const withdrawn = vm => vm?.service?.status === 'active';
// What continues, by kind (callers may pass their own noun): memberships, rentals and policies are not "service".
const NOUN = { subscription: 'membership', rent: 'lease', insurance: 'policy', card: 'account', loan: 'account', tax: 'account', government: 'account', medical: 'account', invoice: 'account' };
export const withdrawnView = (vm, { noun, home = 'dashboard' } = {}) => {
  const what = noun || NOUN[vm?.biller?.kind] || 'service';
  const request = what === 'service' ? 'stop-service request' : 'cancellation request';
  return html`<h1>Request withdrawn</h1><section class="card ok"><p role="status">Your ${request} was withdrawn. Your ${what} will continue with no interruption and nothing else changes on your account.</p><p><a href="${vm.url(home)}">Return to your account</a></p></section>`;
};
