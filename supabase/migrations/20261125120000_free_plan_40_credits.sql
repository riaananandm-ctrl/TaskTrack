-- Free plan: 40 AI credits a month (was 50). Quizzes, speed rounds, study plans and
-- slide decks now cost 8 credits each (set in the study-session-chat function).
update plan_limits set monthly_ai_credits = 40, updated_at = now() where plan = 'free';
