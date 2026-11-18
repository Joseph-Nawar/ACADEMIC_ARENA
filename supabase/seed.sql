-- Deliberately contains no student, staff, identity, or academic data.
-- Integration tests create fictional .test identities with runtime-generated passwords.
-- This local-only seed enables the staff lifecycle RPCs for fictional test users.
-- Migrations alone leave the database gate disabled.
update app_private.runtime_controls
set allow_fictional_account_lifecycle = true
where singleton;

-- Local-only: enable the V1.2 student rollout switches for fictional tests.
-- Hosted projects keep every switch off until the owner enables them with
-- app_private.operator_set_student_feature after the required approvals.
update app_private.student_feature_controls
set student_sign_in = true, student_provisioning = true, avatar_personalization = true, welcome_dialog = true
where singleton;
