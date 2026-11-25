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
/** Premium for a single month, for students who want to try it around exams. */
export const PRO_MONTH_PRICE_INR = 149;

/** The three ways to buy, as shown in checkout. `months` must match request_premium in the database. */
export interface CheckoutOption {
  id: 'pro_month' | 'pro' | 'max';
  plan: PaidPlanId;
  months: 1 | 3;
  price: number;
}
export const CHECKOUT_OPTIONS: CheckoutOption[] = [
  { id: 'pro_month', plan: 'pro', months: 1, price: PRO_MONTH_PRICE_INR },
  { id: 'pro', plan: 'pro', months: 3, price: PLAN_PRICE_INR.pro },
  { id: 'max', plan: 'max', months: 3, price: PLAN_PRICE_INR.max },
];

/** Price of a plan for a number of months. */
export function priceFor(plan: PaidPlanId, months: number = 3): number {
  return plan === 'pro' && months === 1 ? PRO_MONTH_PRICE_INR : PLAN_PRICE_INR[plan];
}

/** "1 month" / "3 months". */
export function monthsLabel(months: number): string {
  return months === 1 ? '1 month' : `${months} months`;
}

const GREETING = 'Hi! I want TaskTrack Premium.';

export function premiumWhatsAppUrl(text: string = GREETING): string {
  return `https://wa.me/${PREMIUM_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/** The message a student sends after paying, so the team can find the payment. */
export function premiumPaidMessage(
  utr: string,
  email: string | null | undefined,
  plan: PaidPlanId = 'pro',
  months: number = 3,
): string {
  const name = PAID_PLAN_NAME[plan];
  return [
    `Hi! I paid ₹${priceFor(plan, months)} for TaskTrack ${name} (${monthsLabel(months)}) by UPI.`,
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

/** Text a student sends a parent to ask for Premium. */
export function parentAskMessage(origin: string): string {
  return [
    'Hi! I use TaskTrack to plan my IB work and study with its AI tutor.',
    `Premium is ₹${PRO_MONTH_PRICE_INR} for a month or ₹${PLAN_PRICE_INR.pro} for 3 months (paid once by UPI, never renews by itself).`,
    'It gives me 500 AI credits a month for quizzes, study plans and explanations.',
    `Plans: ${origin}/#plans`,
  ].join('\n');
}
