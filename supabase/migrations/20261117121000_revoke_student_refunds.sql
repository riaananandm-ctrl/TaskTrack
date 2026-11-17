/*
  Students can no longer refund their own AI credits or tool uses. The server functions
  now refund through the service-role-only *_for functions.
*/

-- Students can no longer refund themselves.
REVOKE EXECUTE ON FUNCTION public.refund_ai_credits(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_ai_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_tool_use(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_polish_use() FROM PUBLIC, anon, authenticated;
