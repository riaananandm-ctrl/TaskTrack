// Central plan + entitlement definitions for TaskTrack.
// Every plan check in the app goes through this module — do not hard-code
// plan logic in individual components.

export type PlanId = 'free' | 'pro';

export interface PlanEntitlements {
  id: PlanId;
  name: string;
  /** Price in whole Indian rupees. */
  priceInr: number;
  /** Billing period length in months. */
  periodMonths: number;
  /** AI credits per calendar month (UTC). Each AI action costs 1 to 5 credits. */
  monthlyAiCredits: number;
  /** Max length of a single user message. */
  maxMessageChars: number;
  /** Questions per generated quiz. */
  quizQuestions: number;
  /** Cards per generated flashcard set. */
  flashcards: number;
  // Feature flags
  unlimitedTasks: boolean;
  fullStudySessions: boolean;
  workedExamples: boolean;
  personalizedStudyPlans: boolean;
  studySlides: boolean;
  googleSlidesExport: boolean;
  advancedAnalytics: boolean;
  prioritySupport: boolean;
}

const FREE: PlanEntitlements = {
  id: 'free',
  name: 'Free',
  priceInr: 0,
  periodMonths: 0,
  monthlyAiCredits: 100,
  maxMessageChars: 2000,
  quizQuestions: 5,
  flashcards: 5,
  unlimitedTasks: false,
  fullStudySessions: false,
  workedExamples: false,
  personalizedStudyPlans: false,
  studySlides: false,
  googleSlidesExport: false,
  advancedAnalytics: false,
  prioritySupport: false,
};

const PRO: PlanEntitlements = {
  id: 'pro',
  name: 'Premium',
  priceInr: 699,
  periodMonths: 3,
  monthlyAiCredits: 2000,
  maxMessageChars: 2000,
  quizQuestions: 8,
  flashcards: 12,
  unlimitedTasks: true,
  fullStudySessions: true,
  workedExamples: true,
  personalizedStudyPlans: true,
  studySlides: true,
  googleSlidesExport: true,
  advancedAnalytics: true,
  prioritySupport: true,
};

export const PLANS: Record<PlanId, PlanEntitlements> = { free: FREE, pro: PRO };

export function formatPrice(plan: PlanEntitlements): string {
  if (plan.priceInr === 0) return '₹0';
  return `₹${plan.priceInr.toLocaleString('en-IN')}`;
}

export function formatBillingPeriod(plan: PlanEntitlements): string {
  if (plan.periodMonths === 0) return 'free forever';
  return `for ${plan.periodMonths} months`;
}

export function getEntitlements(plan: PlanId): PlanEntitlements {
  return PLANS[plan] ?? FREE;
}

interface PlanInput {
  plan?: string | null;
  plan_expires_at?: string | null;
}

/**
 * Resolve a user's effective plan. A Pro plan that has passed its expiry is
 * treated as Free. This is the single source of truth for plan checks in the UI;
 * the server independently enforces the same rules.
 */
export function resolvePlan(profile: PlanInput | null | undefined): PlanId {
  if (!profile || profile.plan !== 'pro') return 'free';
  if (profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() <= Date.now()) {
    return 'free';
  }
  return 'pro';
}

export function getProfileEntitlements(profile: PlanInput | null | undefined): PlanEntitlements {
  return getEntitlements(resolvePlan(profile));
}

export function getPlanLabel(plan: PlanEntitlements): string {
  return plan.id === 'pro' ? 'Premium' : 'Free';
}

/**
 * Exact price wording shown wherever a plan is displayed.
 * Free: "₹0". Premium: "₹699 for 3 months".
 */
export function planPriceLine(plan: PlanEntitlements): string {
  if (plan.priceInr === 0) return '₹0';
  return `${formatPrice(plan)} for ${plan.periodMonths} months`;
}
