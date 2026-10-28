/**
 * AI Service Placeholder
 *
 * This module is a reserved slot for future AI-powered features
 * (e.g., Gemini-based study plan generation). It is intentionally
 * disabled — no API keys are used, no requests are made.
 *
 * When the AI feature is ready to be implemented, add the actual
 * service logic here. The rest of the app is designed so that
 * enabling AI will not require restructuring.
 */

export interface AIStudyPlanRequest {
  tasks: Array<{ title: string; dueDate: string; priority: string }>;
  availableHours: number;
}

export interface AIStudyPlanResponse {
  plan: Array<{ day: string; tasks: string[] }>;
}

export const isAIEnabled = false;

export async function generateStudyPlan(
  _request: AIStudyPlanRequest
): Promise<AIStudyPlanResponse> {
  throw new Error('AI study planning is coming soon.');
}
