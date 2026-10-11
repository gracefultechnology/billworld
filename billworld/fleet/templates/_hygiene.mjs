// Shared filters for text captured from real biller sites (leaf module, no imports).
// Hero headings must read as a welcome to bill payers: error-page phrasing and recruiting / partner / vendor
// calls-to-action captured from the real homepage are dropped (each template falls back to its own wording).
export const HERO_JUNK = /\b(?:this is embarrassing|uh.?oh|whoops|can.?t (?:be )?find|could not be found|doesn.?t exist|page (?:you|has)|partner (?:with|program)|become an? (?:partner|vendor|dealer|supplier|member of our team)|join (?:our|the) team|we.?re hiring|now hiring|careers?|job openings?|vendor (?:opportunities|registration)|investor relations|transient (?:food )?vendors?|request a quote)\b/i;

// Review-step note for a payment dated after the current bill's due date (scheduled-payment flows).
import { html, fmtDate } from '../kit.mjs';
export const payOnText = (vm, d, today = 'Today') => d?.payOn ? fmtDate(Date.parse(`${d.payOn}T17:00:00Z`)) : today;
export function lateNote(vm, d) {
  const on = d?.payOn ? Date.parse(`${d.payOn}T17:00:00Z`) : NaN, due = vm.invoice?.dueAt;
  if (!Number.isFinite(on) || !due || on <= due + 24 * 3600e3 || !(vm.balanceCents > 0)) return '';
  return html`<br><strong class="late-note" role="note">This date is after your due date (${fmtDate(due)}). A payment made after the due date may be considered late.</strong>`;
}
