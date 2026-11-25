-- ManageBac imports arrive with category 'other', so the exam-week boost also
-- recognises tests by title (test, exam, summative, quiz, mock, assessment, SA1/SA2).
create or replace function public.exam_boost_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_task record;
begin
  if v_user is null then return jsonb_build_object('eligible', false); end if;
  if exists (select 1 from exam_boost_claims where user_id = v_user and usage_month = v_month) then
    return jsonb_build_object('eligible', false, 'claimed', true);
  end if;
  select t.id, t.title, t.due_date into v_task from tasks t
    where t.user_id = v_user
      and not t.is_archived
      and t.status <> 'completed'
      and (t.category in ('test', 'quiz', 'summative_assessment', 'final_exam', 'mock_exam')
           or t.title ~* '(test|exam|summative|quiz|mock|assessment|\mSA ?[0-9])')
      and t.due_date >= (now() at time zone 'Asia/Kolkata')::date
      and t.due_date <= (now() at time zone 'Asia/Kolkata')::date + 7
    order by t.due_date
    limit 1;
  if not found then
    return jsonb_build_object('eligible', false);
  end if;
  return jsonb_build_object('eligible', true, 'task_title', v_task.title, 'due_date', v_task.due_date, 'credits', 20);
end;
$$;
revoke execute on function public.exam_boost_status() from public, anon;
grant execute on function public.exam_boost_status() to authenticated;
