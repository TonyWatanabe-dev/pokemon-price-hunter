# Release Executor Bridge

## Required invariants

- Fetch authoritative GitHub/Vercel evidence from provider adapters; never trust claims supplied by an agent.
- Evaluate the Release Governor and persist the decision before a side effect.
- Serialize work with a distributed lock; local-only mutexes are insufficient across workers.
- Re-fetch evidence immediately before merge/deploy and require the exact same SHA, base/head refs, checks, and deployment state.
- Any missing evidence, stale SHA, permission error, conflict, or audit failure blocks the action.
- Re-evaluate and persist a distinct authorization for merge and deploy; neither action grants the other.
- Persist the execution outcome with an idempotency key and exact SHA. An outcome-audit failure must not be reported as success.
- R3 remains human-required. Production migrations, secrets, and commercial policy decisions are never inferred from broad autonomy.

## Adapter contract

The executor must inject `readEvidence`, `withLock`, `execute`, and `auditSink`. `readEvidence` must query GitHub checks/PR metadata and Vercel deployment metadata directly. `withLock` must be distributed and release on all exits. `execute` must enforce least privilege and verify the final SHA after the provider confirms the operation.

## Rollout gates

1. Unit tests for stale evidence, missing permissions, duplicate workers, audit outage, and provider failures.
2. End-to-end dry run on a documentation-only PR.
3. Actual low-risk merge only after green checks and a fresh exact-SHA recheck.
4. Preview deployment and smoke tests before production.
5. Production deploy only after a separately evaluated Governor decision and a verified Preview.
