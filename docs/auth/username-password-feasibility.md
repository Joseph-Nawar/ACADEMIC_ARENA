# Username/password feasibility and identity decision

- **Status:** M0 decision memo; no account implementation is approved.
- **Reviewed:** 15 November 2026
- **Decision gate:** Approval is required before identity implementation or M1 continuation.

## Required experience

Students receive a staff-issued username and password. There is no public registration, Microsoft sign-in, student-facing email requirement, or student claim of another published identity. Students privately change the initial password and recover access through authorized staff. Staff accounts require stronger protection and MFA.

The V6 pilot’s current FastAPI login screen already accepts username/password, but that custom backend is local-only and unaudited. Passing its smoke suite does not establish a production identity system.

## Findings

### Supabase Auth native flow

Supabase password authentication accepts email/password or phone/password. Its password sign-in API does not accept a username. The admin user-creation API is server-only and requires an email or phone identity; Supabase explicitly warns never to expose the service-role key in the browser. New-user sign-up can be disabled, so the no-public-registration control is available.

Therefore, Supabase does not satisfy username-only login natively. A made-up address, fabricated confirmation, phone number, or public username-to-email lookup is not an acceptable workaround.

### Conditional Supabase mapping option

The only Supabase path worth advancing is a server-side username mapping to an already-issued, legitimate university email address, provided EUE explicitly authorizes the source and private storage/use of those addresses. The student UI would still ask only for username/password. A same-origin server function would:

1. Normalize and rate-limit the supplied username without exposing an availability endpoint.
2. Resolve it to the legitimate email through a private mapping that anonymous and student clients cannot read.
3. Call Supabase Auth server-side and return a secure, HttpOnly session; do not return the email mapping or service-role secret.
4. Keep account-to-public-ranking links in a separate private mapping, never in public JSON.
5. Use an approved staff-only password-reset workflow; do not rely on email delivery or SMS.

Supabase documents TOTP MFA for application users, with the assurance level available for enforcement in restrictive RLS policies. This is a plausible staff MFA control, but it still needs an end-to-end test proving staff cannot reach privileged functions or tables at AAL1.

**Tradeoffs:** This preserves the username-only student experience and delegates password hashing/session identity to a managed provider. It adds a server-side mapping/BFF and rate-limit responsibility, and it makes legitimate university emails confidential personal data processed by Supabase. The university must approve the data source, notice, processing location/terms, retention, staff access, and recovery procedure. No such email list, Supabase project, or institutional approval was supplied, so this path is not currently cleared.

### Cloudflare Worker + D1 + Better Auth

Cloudflare Workers/D1 have free allowances suitable for a small app, but Better Auth’s username plugin extends its email/password authenticator. Its documented sign-up still requires email and name. Username support therefore does not remove the email requirement. No fake internal email should be introduced to bypass that requirement. The username plugin does include an option to disable its username-availability endpoint, which would help reduce enumeration if the option were otherwise approved.

This alternative does not meet the stated identity constraints without the same legitimate email dependency. No local end-to-end proof was run, and the library’s compatibility alone would not establish an independent audit or safe recovery/MFA configuration.

### Hardening the V6 Argon2id flow on a Cloudflare Python Worker

V6 uses argon2-cffi for password hashing, but its login, opaque-session issuance, token storage, lockout, and CSRF logic are application code rather than a selected audited authentication/session library. That does not meet the instruction to avoid hand-rolled sessions. Cloudflare documents Python Workers as Pyodide-based and supports pure Python, PyEmscripten, and Pyodide packages; compatibility of the current Argon2id binding is not established. Workers Free also documents a 10 ms CPU limit per invocation. A measured Argon2id compatibility and cost test would be required before this route could be considered, and it would still need staff MFA, reliable resets, and reviewed session handling.

This option is not recommended for V1 without a maintained auth/session library that both satisfies the username-only requirement and has verified Cloudflare compatibility.

## Feasibility spike status

The documentation-level feasibility check rules out native Supabase username login and shows the email requirement in the Better Auth username path. I did not run a hosted/local account lifecycle test. There is no approved Supabase project or legitimate university identity input, and a test that marks a fabricated address verified would violate the blueprint. The following remain untested and must be demonstrated with an institution-approved test identity before M2:

- Staff provisioning and disabled public sign-up.
- First-login password change and authorized staff reset.
- Account suspension and immediate session revocation.
- Username-to-auth identity mapping without enumeration or exposure.
- User-to-public-record binding that a student cannot change.
- Mandatory TOTP enrollment and AAL2 enforcement for staff.

## Recommendation and explicit approval gate

**Recommendation:** Approve only the conditional Supabase design using EUE-issued, already-verified institutional emails as private provider identifiers, supplied through an authorized staff process. Keep the public student login fields username/password. Make the username-to-email mapping server-only, keep account-to-ranking links separate and private, disable public sign-up, have staff perform resets, and require staff TOTP MFA enforced at the database/function boundary.

**Current decision:** Pending. Do not build the account system or import real identities. M1 remains paused under the handoff instruction until this identity condition is explicitly approved. If EUE cannot authorize the legitimate email source and its private processing, keep student authentication out of V1 and return to the identity decision gate; do not use fake emails or custom password/session code as a shortcut.

**Approval requested:** Do you approve this conditional Supabase approach only if EUE staff provide already-issued, verified institutional email addresses through an authorized process and approve their private use/storage in Supabase? This approval would clear the architecture decision for fictional-data M1 work; it would not authorize real student imports or public deployment.

## References checked

- [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase sign-in with password API](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase admin create user](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp)
- [Supabase MFA enforcement with RLS](https://supabase.com/docs/guides/auth/auth-mfa)
- [Better Auth username plugin](https://better-auth.com/docs/plugins/username)
- [Cloudflare Python package support](https://developers.cloudflare.com/workers/languages/python/packages/)
- [Cloudflare Python Workers runtime](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)
- [Cloudflare Workers Free limits](https://developers.cloudflare.com/workers/platform/pricing/)
