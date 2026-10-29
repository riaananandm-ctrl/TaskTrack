# Patch D — Auth signup message correction (small, isolated)

Status: PROPOSED — not applied. Kept deliberately separate from all security patches
and from the SMTP repair.

## Problem

Your instruction: do not require the frontend to detect duplicate-account signup via
`identities.length` (which would reveal account existence) and use a privacy-safe
message compatible with actual Auth behavior.

Current code review (no live behavior tests run):

- `app/signup/page.tsx:105–116`: when `signUp` returns an **error**, it calls
  `classifySignupError(error)` (`lib/auth-email.ts:27–49`), which classifies only from
  Supabase's structured error `code` (`user_already_exists` / `email_exists`) with a
  message-text fallback. **The frontend never reads `identities.length`** — that claim
  in my earlier audit was wrong and is retracted.
- `app/signup/page.tsx:122`: when signUp returns a **session**, the code confirms the
  session's email matches the typed address before redirecting — a safety check, not
  enumeration.
- `app/signup/page.tsx:129–136`: for a sessionless success (which covers both "new
  unconfirmed account" and "existing account" under anti-enumeration), the page shows
  the generic `SIGNUP_GENERIC_NOTICE`. This is the privacy-correct behavior: identical
  response whether or not the account exists.

## Residual issue (one real defect)

`lib/auth-email.ts:37–48` message-text fallback: when Supabase returns an error
**without** a structured code, the raw English phrases ("already registered",
"email exists") are used to conclude `duplicate-account`, and the page then displays
`ACCOUNT_EXISTS_MESSAGE` ("This account already exists. Please log in."). Under
enumeration protection this path should never fire, but if server config ever leaks
the explicit error, the frontend would state account existence directly.

## Proposed change (exact diff)

`lib/auth-email.ts` — replace the text-sniffing block:

```ts
  if (code) {
    return 'other';
  }
-  const text = (error?.message ?? '').toLowerCase();
-  if (
-    text.includes('user already registered') ||
-    ... (all five phrases)
-  ) {
-    return 'duplicate-account';
-  }
  return 'other';
```

with: **only** structured codes map to `'duplicate-account'`; any codeless error falls
to `'other'` and renders `safeAuthMessage(error.message)` (already privacy-safe — it
maps unknown errors to "Something went wrong. Please try again in a moment.").
Additionally, `ACCOUNT_EXISTS_MESSAGE` rendering stays gated on
`isDuplicate === true`, which now only happens when Supabase itself sent the explicit
code.

No other changes. No dependency on `identities.length` is added or exists today.

## Affected callers

`classifySignupError` is used only in `app/signup/page.tsx` (grep-verified).

## Tests (requires approval / isolated account)

1. Signup with a brand-new address → check-your-email screen (unchanged).
2. Signup with an existing address while enumeration protection is ON → generic
   notice; no "account exists" text (verify actual live behavior — current dashboard
   state is unknown to me and must be checked, not assumed).
3. Signup with an existing address while enumeration protection is OFF → Supabase's
   explicit `user_already_exists` code still yields the login/forgot-password
   shortcuts (intentional UX when the server chooses to say so).

## Deployment order / rollback

Frontend-only; ships with the next site publish. Rollback = revert this one file.

## Explicitly out of scope here

- SMTP credential repair (separate track; status unknown until retested).
- Any Auth dashboard setting change (enumeration protection, leaked-password
  protection) — requires your action; leaked-password protection additionally
  requires Pro plan or above per Supabase documentation.
