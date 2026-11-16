# Username/password feasibility and identity decision

- **Status:** Conditional Supabase architecture approved for fictional local development and implemented as an M2 review candidate.
- **Reviewed:** 16 November 2026
- **Decision boundary:** No hosted Supabase project, real EUE identity, real credential, academic record, or public deployment has been used or authorized.

## Required experience

Students receive staff-provisioned usernames and passwords. There is no public registration, Microsoft sign-in, student-facing email requirement, or student claim of another identity. Students change an initial password privately and recover access through authorized staff. Staff accounts require TOTP MFA and AAL2 for privileged actions.

## Provider behavior confirmed locally

Supabase password sign-in accepts email or phone identifiers, not usernames. The admin create-user API is privileged and accepts provider identity data. The actual local Supabase Auth password response includes the user's email and provider access and refresh tokens; the access token also contains an email claim. A server-side username lookup alone does not keep these details private if the browser signs in directly. **Direct client Supabase Auth is therefore rejected.**

The M2 BFF keeps the provider Auth calls and private username-to-email mapping server-side. The browser receives a 256-bit opaque `__Host-aa_session` cookie, a session-bound CSRF value, and a small role/action summary. It never receives the Auth user object, email, provider JWTs, refresh tokens, service-role credential, private account ID, or mapping. A local response scan asserts the provider fields are absent. TOTP enrollment returns only the one-time authenticator secret; it omits Supabase's raw `otpauth` URI because the URI label can contain the provider email. The UI clears the secret after confirmation or close.

## Local username/password workflow

The pinned Supabase CLI native stack runs Auth, Postgres, and PostgREST on loopback. The provider has public signup disabled. Tests create random `*.academic-arena.test` accounts through local Auth Admin using fictional passwords, set the local confirmation flag because Auth requires confirmed addresses for password sign-in in this setup, then delete the accounts. That test-only confirmation flag is not external email verification.

The BFF workflow:

1. Requires same-origin `Origin`, strict request shape, normalized username, and persistent rate-limit checks.
2. Resolves username privately in `app_private`; there is no availability endpoint. Username and edge-IP rate buckets are stored as HMACed keys. Unknown, wrong-password, suspended, and throttled login results share a generic 401 body and minimum response duration.
3. Calls Supabase Auth with the private provider identity, verifies returned user/session association, encrypts provider tokens for server-side storage, hashes the opaque session for database lookup, and issues a Secure, HttpOnly, SameSite=Strict cookie.
4. Requires the current password for password changes, forces the initial change, clears the forced-change state only after provider success, and revokes BFF sessions.
5. Requires an active, verified TOTP factor and signed AAL2 claim for staff-only operations. Both BFF authorization and database permission functions check current role/account state; RLS is tested with actual local provider JWTs.

Local integration tests exercised account creation by an AAL2 admin, initial password change, recovery, suspension, session expiration and revocation, TOTP enrollment/verification/reset, same-origin and CSRF checks, private mapping, and login/MFA rate limits. These are local provider tests, not a hosted-project certification.

## Alternatives evaluated

### Cloudflare Workers, D1, and Better Auth

Better Auth's username plugin still builds on email/password authentication, and its documented account creation workflow requires email. It does not remove the need for a legitimate provider email and a private mapping. It also requires a new D1 schema, recovery, and staff MFA design. It is not selected.

### V6 FastAPI/Argon2 flow

V6's custom password and session logic is a pilot reference, not a reviewed provider lifecycle. Porting it would require owning password verification, session security, recovery, MFA, and rate limiting in application code, and the Argon2 package has no established Cloudflare Workers compatibility here. It is not selected.

## Development safeguards and remaining gates

Account provisioning, recovery, suspension, and staff-MFA reset BFF routes explicitly refuse requests outside `ENVIRONMENT=test`. Their database RPCs additionally require a private lifecycle gate that defaults to false in migrations; the local fictional seed alone turns it on. SQL provisioning also rejects provider identities outside the reserved `academic-arena.test` domain, even when an AAL2 user calls PostgREST directly. Student password recovery and staff MFA reset set a pending flag and revoke sessions before changing provider credentials/factors; login and password changes stay blocked until the server confirms provider success and finalizes the matching credential epoch. A private retry record retains the encrypted temporary password for up to 15 minutes, and same-epoch retries reuse it. MFA reset retries resume factor deletion. No deployment secret or hosted project is configured. This provides a local end-to-end workflow without creating real institutional accounts.

Before hosted integration, the university must authorize processing a legitimate roster and institutional email addresses in Supabase, select/approve the project region and terms, name staff custodians, approve the account-recovery process, and authorize the external provider configuration. The initial administrator bootstrap and offline recovery procedure for a sole administrator who loses their factor also need an institution-approved runbook. The hosted Auth session/ban behavior, deployment secret binding, quotas, backups, and production observability remain unverified. No real identity import or public deployment is authorized.

## Recommendation

Continue with Cloudflare Pages Functions as a same-origin BFF and Supabase Auth/Postgres on the free plan. Keep username/email mapping and provider tokens server-side; require opaque revocable cookie sessions, generic login failures, persistent limits, staff-provisioned accounts, forced initial password change, and staff TOTP/AAL2. The user approved this architecture for fictional local development. Real institutional email processing and production account routes remain separate authorization gates.

## References

- [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase sign-in with password API](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase admin create user](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp)
- [Supabase MFA enforcement with RLS](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase Auth user object and email attribute](https://supabase.com/docs/guides/auth/users)
- [Supabase required JWT claims, including email](https://supabase.com/docs/guides/auth/jwt-fields)
- [Supabase custom access-token hook required claims](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Better Auth username plugin](https://better-auth.com/docs/plugins/username)
- [Cloudflare Workers Free limits](https://developers.cloudflare.com/workers/platform/pricing/)
