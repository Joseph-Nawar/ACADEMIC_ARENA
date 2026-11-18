# Student accounts runbook (V1.2)

Staff-issued usernames and passwords on the existing Supabase Auth. No public
sign-up, no Microsoft OAuth, no self-claiming. Everything here is run by the
**authorized operator on their own device**. Never in CI, never in an AI chat,
never against staging with real people.

## Rollout switches (all default off)

| Switch | Effect when on |
|---|---|
| `student_provisioning` | Operator CLI may create, recover and suspend student accounts. |
| `student_sign_in` | Student-only accounts can sign in. Turning it **off** ends every student session at once; public rankings and staff are unaffected. |
| `avatar_personalization` | Linked, opted-in students' own characters replace the default artwork. Off = default artwork everywhere. |
| `welcome_dialog` | First-visit welcome dialog (only shown when student sign-in is also on). |

```bash
node scripts/student-accounts.mjs features --target <ref>
node scripts/student-accounts.mjs features --target <ref> --set student_sign_in=off
```

Turning a switch **on** in production also needs `--confirm-production`.
Do it only after the approvals in the checklist below. Every change is audited.
The fictional lifecycle gate (`allow_fictional_account_lifecycle`) and hosted
`ENVIRONMENT=test` are never used for real students. The in-app staff
lifecycle routes stay 403 on hosted sites.

## Private roster (never committed or shared)

`roster_ref,email,username,eligible`

- `roster_ref`: stable university reference. It is used only on the device to detect duplicates and never leaves the device.
- `email`: verified institutional email from the approved roster. It is the private Auth identity and students never type it.
- `username`: unique and non-identifying, for example `quiet-river`. It must not contain a name, an email local part, the roster reference, or a run of 5+ digits.
- `eligible`: `yes` or `no`.

`validate` rejects duplicates, unapproved domains, identifying usernames, and formula or markup characters. It reports line numbers only.

## Provisioning (bounded, resumable)

```bash
read -s AA_EXPORT_PASSPHRASE && export AA_EXPORT_PASSPHRASE   # separate from the backup passphrase
node scripts/student-accounts.mjs validate  --roster ~/private/roster.csv --email-domain <university-domain>
node scripts/student-accounts.mjs provision --target <ref> --roster ~/private/roster.csv --email-domain <university-domain> --dry-run
node scripts/student-accounts.mjs provision --target <ref> --roster ~/private/roster.csv --email-domain <university-domain> \
  --batch-size 25 --export ~/private/batch-01.aacred
node scripts/student-accounts.mjs status    --target <ref> --roster ~/private/roster.csv --email-domain <university-domain>
```

- Each student gets a unique 20-character temporary password, the `student` role only, and must change the password at first sign-in.
- Reruns are idempotent. Finished rows show as `done`, and nothing is ever created twice.
- **Orphans** are Auth users without an app account, for example after a timeout. They are never adopted silently.
  - A user that this tool created and that has never signed in is adopted only with `--adopt-orphans`, which also sets a fresh password.
  - Any other orphan is reported for manual review.
- If the provider does not answer clearly, the batch stops. Rerun later to reconcile.
- Output contains counts and roster line numbers only: no emails, names or passwords.

## Credential delivery (one student at a time)

1. Verify the student's identity through the approved university channel (in person with a university ID card, or an approved private university message).
2. Copy that one password to the clipboard:
   `node scripts/student-accounts.mjs deliver --export ~/private/batch-01.aacred --username quiet-river`
3. Give the username and password only to that student, privately. Clear the clipboard.
4. When the batch has been delivered and verified (`status` shows sign-ins), securely delete the `.aacred` file.

Never email lists of passwords, share spreadsheets, or keep plaintext copies. If delivery fails, run a reset instead of keeping the password.

## Lost password (student recovery)

1. The student asks through the approved university channel. Staff verify identity independently and record a ticket reference (no personal data in it).
2. Run:
   `node scripts/student-accounts.mjs reset --target <ref> --username <u> --verified-ref <ticket-code> --export ~/private/reset-<ticket>.aacred`
3. What the reset does:
   - The account locks first: sessions are revoked, sign-in is blocked, and the credential epoch moves on.
   - The Auth Admin API then sets a new temporary password, and the student must change it at the next sign-in.
   - If the provider times out, the account **stays locked**. Rerun `reset`; nothing is released because time has passed.
   - Each run is bound to its own credential epoch, so an earlier overlapping run can never unlock the account. The encrypted credential is saved before the unlock.
4. Deliver it as above. The audit records `operator_recovery_started`, keyed by the ticket code, and `operator_recovery_completed`.

## Suspension

```bash
node scripts/student-accounts.mjs suspend    --target <ref> --username <u> --reason <ticket-code>
node scripts/student-accounts.mjs reactivate --target <ref> --username <u> --reason <ticket-code>
```

Suspension revokes sessions at once. A suspended student's personal character disappears from the boards; their published rank and name stay.

## Linking students to published rankings

- Staff Desk → **Verified account links** (admin, AAL2). Choose the publication and upload `level,rank,username`.
  - Every username must first be checked against the authoritative roster.
  - The private preview shows each row's public name, the username and the account status. Institutional emails never reach the browser; check usernames against the roster on the operator device. Each row is marked as new, changed, or the same as the previous version.
- Every publication needs its own approved links. Nothing carries forward silently, and rollback restores that version's links.
- Names, emails and student numbers are never accepted as link keys, and students cannot claim rows.
- The public board shows a student's own character only when:
  - the row is linked;
  - the student switched public display on;
  - the account is active;
  - `avatar_personalization` is on.

## Incident: disable student interaction

`features --set student_sign_in=off`. This ends every student session and blocks student sign-in. Add `--set avatar_personalization=off` to return the boards to default artwork. Public rankings stay up.

## Staff MFA recovery

This is unchanged and separate: see `identity-runbook.md`. Student tools never touch staff accounts.
