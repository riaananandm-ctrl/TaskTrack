-- Free plan: 60 AI credits a month (was 100), to keep AI costs in check.
update plan_limits set monthly_ai_credits = 60, updated_at = now() where plan = 'free';
