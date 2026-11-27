// Shared request checks for the staff reward workflow. A period key is the
// stable earning-period identity (e.g. "2026-27:week-05"), never a publication id.
import { UUID_PATTERN } from "./route-auth.js";

export const PERIOD_KEY = /^[a-z0-9][a-z0-9._:-]{2,63}$/u;
export const PERIOD_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,47}$/u;
export const validPublication = (value) => typeof value === "string" && UUID_PATTERN.test(value);
export const validPeriodKey = (value) => typeof value === "string" && PERIOD_KEY.test(value.trim().toLowerCase());
export const validPeriodLabel = (value) => typeof value === "string" && PERIOD_LABEL.test(value);

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

// Aggregates only: the database never returns names, usernames or accounts here.
export function previewFromRow(data) {
  const collections = {};
  for (const [name, value] of Object.entries(data?.collections ?? {})) {
    if (!/^[a-z][a-z0-9_]{1,31}$/u.test(name)) continue;
    collections[name] = {
      newGrants: count(value?.newGrants), alreadyGranted: count(value?.alreadyGranted),
      previouslyRevoked: count(value?.previouslyRevoked), wouldRevoke: count(value?.wouldRevoke),
    };
  }
  const blockers = Array.isArray(data?.blockers) ? data.blockers.filter((code) => typeof code === "string" && /^[a-z_]{1,40}$/u.test(code)) : [];
  return {
    publication: { version: count(data?.snapshot?.version), label: data?.snapshot?.label ?? null, current: data?.snapshot?.current === true },
    canonicalKey: typeof data?.canonicalKey === "string" ? data.canonicalKey : null,
    period: {
      key: data?.period?.key, exists: data?.period?.exists === true, label: data?.period?.label ?? null,
      versions: Array.isArray(data?.period?.versions) ? data.period.versions.map(count) : [],
    },
    rows: count(data?.rows), linked: count(data?.linked), previousLinked: count(data?.previousLinked), eligibleStudents: count(data?.eligibleStudents),
    exclusions: { unlinked: count(data?.exclusions?.unlinked), linkedSuspended: count(data?.exclusions?.linkedSuspended) },
    collections,
    revocation: { students: count(data?.revocation?.students), equippedFallbacks: count(data?.revocation?.equippedFallbacks) },
    expectedChanges: { grant: count(data?.expectedChanges?.grant), reconcile: count(data?.expectedChanges?.reconcile) },
    conflicts: {
      snapshotBoundToPeriod: typeof data?.conflicts?.snapshotBoundToPeriod === "string" ? data.conflicts.snapshotBoundToPeriod : null,
      likelyReplacementOf: typeof data?.conflicts?.likelyReplacementOf === "string" ? data.conflicts.likelyReplacementOf : null,
      incompleteLinks: data?.conflicts?.incompleteLinks === true,
    },
    blockers,
    rewardsSwitchOn: data?.rewardsSwitchOn === true,
  };
}
