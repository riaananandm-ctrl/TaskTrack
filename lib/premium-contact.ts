/**
 * Premium is bought by UPI for now: the student pays the TaskTrack UPI number, enters
 * the UPI transaction ID (UTR) in the app, and sends a ready-made WhatsApp message so
 * the TaskTrack team knows to check the payment and switch Premium on.
 */
export const PREMIUM_WHATSAPP_NUMBER = '919676643800';
/** Where students send the money. Change this when the UPI account changes. */
export const PREMIUM_UPI_NUMBER = '9676643800';
/** What each paid plan costs for 3 months, in rupees. */
export const PLAN_PRICE_INR = { pro: 499, max: 999 } as const;
export type PaidPlanId = keyof typeof PLAN_PRICE_INR;
export const PAID_PLAN_NAME: Record<PaidPlanId, string> = { pro: 'Premium', max: 'Max' };
/** Premium's price (kept for older imports). */
export const PREMIUM_PRICE_INR = PLAN_PRICE_INR.pro;

const GREETING = 'Hi! I want TaskTrack Premium.';

export function premiumWhatsAppUrl(text: string = GREETING): string {
  return `https://wa.me/${PREMIUM_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/** The message a student sends after paying, so the team can find the payment. */
export function premiumPaidMessage(utr: string, email: string | null | undefined, plan: PaidPlanId = 'pro'): string {
  const name = PAID_PLAN_NAME[plan];
  return [
    `Hi! I paid ₹${PLAN_PRICE_INR[plan]} for TaskTrack ${name} by UPI.`,
    `UTR: ${utr}`,
    email ? `TaskTrack account: ${email}` : '',
    `Please check the payment and switch ${name} on.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function openPremiumWhatsApp(text?: string): void {
  const url = premiumWhatsAppUrl(text);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  // Pop-up blocked (or in-app browser): go there in this tab instead.
  if (!win) window.location.href = url;
}
