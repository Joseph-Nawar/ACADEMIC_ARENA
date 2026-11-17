-- Deliberately contains no student, staff, identity, or academic data.
-- Integration tests create fictional .test identities with runtime-generated passwords.
-- This local-only seed enables the staff lifecycle RPCs for fictional test users.
-- Migrations alone leave the database gate disabled.
update app_private.runtime_controls
set allow_fictional_account_lifecycle = true
where singleton;
