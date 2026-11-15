# Username/password feasibility and identity decision

- **Status:** Conditional Supabase architecture approved for fictional development; no account implementation/provider project exists yet.
- **Reviewed:** 15 November 2026
- **Decision boundary:** Real institutional email processing still requires explicit authorization from the appropriate university personnel. This does not authorize real account creation or public deployment.

## Required experience

Students receive a staff-issued username and password. There is no public registration, Microsoft sign-in, student-facing email requirement, or student claim of another published identity. Students privately change the initial password and recover access through authorized staff. Staff accounts require stronger protection and MFA.

The V6 pilot’s current FastAPI login screen already accepts username/password, but that custom backend is local-only and unaudited. Passing its smoke suite does not establish a production identity system.

## Findings

### Supabase Auth native flow

Supabase password authentication accepts email/password or phone/password. Its password sign-in API does not accept a username. The admin user-creation API is server-only and requires an email or phone identity; Supabase explicitly warns never to expose the service-role key in the browser. New-user sign-up can be disabled, so the no-public-registration control is available.

Therefore, Supabase does not satisfy username-only login natively. A made-up address, fabricated confirmation, phone number, or public username-to-email lookup is not an acceptable workaround.

### Conditional Supabase mapping option

The selected development path is a server-side username mapping to an already-issued, legitimate university email address, once EUE explicitly authorizes the source and its private processing in Supabase. Fictional identities may be used before that approval. The student UI asks only for username/password. A same-origin server function would:

1. Normalize and rate-limit the supplied username without exposing an availability endpoint.
2. Resolve it to the legitimate email through a private mapping that anonymous and student clients cannot read.
3. Call Supabase Auth server-side, retain provider tokens on the server, and issue only a secure opaque HttpOnly session; do not return the email mapping, provider user object, provider tokens, or service-role secret.
4. Keep account-to-public-ranking links in a separate private mapping, never in public JSON.
5. Use an approved staff-only password-reset workflow; do not rely on email delivery or SMS.

Supabase documents TOTP MFA for application users, with the assurance level available for enforcement in restrictive RLS policies. This is a plausible staff MFA control, but it still needs an end-to-end test proving staff cannot reach privileged functions or tables at AAL1.

**Tradeoffs:** This preserves the username-only student experience and delegates password authentication to a managed provider. It adds a server-side mapping/BFF, opaque-session lifecycle, and rate-limit responsibility. Legitimate university emails become confidential personal data processed by Supabase. The university must approve the data source, notice, processing location/terms, retention, staff access, and recovery procedure before those identities are imported.

**Direct client Auth is not acceptable for the privacy requirement.** The Supabase Auth user object includes the user's `email` field. Supabase's JWT reference also lists `email` as a required access-token claim, and the custom access-token hook must preserve required claims. A client that calls Supabase Auth directly can inspect the provider email in the returned user object and access token; resolving the username on a server first does not hide that data after direct client sign-in. The browser must never receive a Supabase Auth user object or provider JWT. A same-origin BFF must set an HttpOnly cookie and return only a small allowlisted session summary.

### Cloudflare Worker + D1 + Better Auth

Cloudflare Workers/D1 have free allowances suitable for a small app, but Better Auth’s username plugin extends its email/password authenticator. Its documented sign-up still requires email and name. Username support therefore does not remove the email requirement. No fake internal email should be introduced to bypass that requirement. The username plugin does include an option to disable its username-availability endpoint, which would help reduce enumeration if the option were otherwise approved.

This alternative does not meet the stated identity constraints without the same legitimate email dependency. No local end-to-end proof was run, and the library’s compatibility alone would not establish an independent audit or safe recovery/MFA configuration.

### Hardening the V6 Argon2id flow on a Cloudflare Python Worker

V6 uses argon2-cffi for password hashing, but its login, opaque-session issuance, token storage, lockout, and CSRF logic are application code rather than a selected audited authentication/session library. That does not meet the instruction to avoid hand-rolled sessions. Cloudflare documents Python Workers as Pyodide-based and supports pure Python, PyEmscripten, and Pyodide packages; compatibility of the current Argon2id binding is not established. Workers Free also documents a 10 ms CPU limit per invocation. A measured Argon2id compatibility and cost test would be required before this route could be considered, and it would still need staff MFA, reliable resets, and reviewed session handling.

This option is not recommended for V1 without a maintained auth/session library that both satisfies the username-only requirement and has verified Cloudflare compatibility.

## M1 feasibility checks and local provider procedure

M1 automated tests verify that the browser submits only username/password to a same-origin BFF route, receives no provider email in the safe session contract, uses one generic sign-in message for invalid and throttled attempts, and does not load a Supabase browser client. These are frontend contract tests; they do not implement or prove a provider session.

The local Supabase stack was not started: Docker is installed, but its daemon was not running. No hosted project or credentials were used. Before implementing real accounts, use a local-only Supabase stack with Docker and fictional `*.test` identities, public sign-up disabled, and email confirmation disabled for the local fixture. Create the local user through a local admin path without marking a fabricated real-world email as verified. Keep local service credentials in ignored environment files and never point the test at a hosted project.

Once the local BFF exists, its acceptance test should capture the local provider's Auth response and decoded JWT to confirm email exposure, then verify that the browser receives only the opaque cookie and a minimal session JSON object. The following lifecycle checks remain for Milestone 2:

- Disabled public sign-up and staff-only account provisioning.
- First-login password change and staff-assisted credential reset/recovery.
- Account suspension and immediate session/token revocation.
- Username-to-auth identity mapping without enumeration or exposure.
- No email, provider user object, account mapping, access token, or refresh token in browser network responses, storage, or readable cookies.
- User-to-public-record binding that a student cannot change.
- Mandatory TOTP enrollment and server/RLS AAL2 enforcement for staff.
- Generic invalid-account, invalid-password, suspended-account, and throttled responses with server-side IP and account-aware rate limits.

## Recommendation and decision status

**Recommendation:** Continue the approved conditional Supabase design with a same-origin BFF, server-side username-to-email resolution, disabled public sign-up, staff-issued credentials, staff-run recovery, opaque HttpOnly sessions, server-only tokens/mappings, and staff TOTP MFA enforced at the database/function boundary. Keep the account-to-public-ranking link private and separate.

**Current decision:** The architecture is approved for fictional-data development. Real university email processing remains gated on explicit authorization from appropriate university personnel. No real identities, institutional credentials, or academic records are part of M1. Do not fabricate verified institutional addresses or implement custom password/session cryptography as a shortcut.

## References checked

- [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase sign-in with password API](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase admin create user](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp)
- [Supabase MFA enforcement with RLS](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase Terms of Service](https://supabase.com/terms)
- [Supabase Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum)
- [Supabase Auth user object and email attribute](https://supabase.com/docs/guides/auth/users)
- [Supabase required JWT claims, including email](https://supabase.com/docs/guides/auth/jwt-fields)
- [Supabase custom access-token hook required claims](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Better Auth username plugin](https://better-auth.com/docs/plugins/username)
- [Cloudflare Python package support](https://developers.cloudflare.com/workers/languages/python/packages/)
- [Cloudflare Python Workers runtime](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)
- [Cloudflare Workers Free limits](https://developers.cloudflare.com/workers/platform/pricing/)
