# DEC-002: OIDC Callback Path

<!--
documentation-metadata
audience: maintainers; documentation contributors
owner: application maintainers and documentation maintainers
status: current
last-verified: 2026-10-25
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: P11 route-owner reconciliation; public callback and original decision preserved
source-anchors: src/app.ts; src/modules/settings.ts; src/modules/oidc.ts; docs/backlog/documentation-remediation.yml; src/routes/users.ts
next-review: D04
-->

## Decision status

**Resolved for documentation.**

The documented OIDC callback path is:

```text
/users/oidc/callback
```

This decision changes documentation state only. It does not modify application source, tests, examples, or runtime
configuration.

## Evidence

The original public route was composed from two implementation elements:

1. `src/app.ts` mounts the users router at `/users`.
2. The retired native users router registered `/oidc/callback` inside that mount.

The resulting externally reachable callback path is `/users/oidc/callback`. OIDC login and callback processing use the
configured redirect URL, so the deployment URL and identity-provider registration must use the same complete public
URL.

## Documentation contract

D04 operator documentation and D12 maintainer documentation must use `/users/oidc/callback` consistently. For example,
a deployment whose public root is `https://surveyor.example.org` uses:

```text
https://surveyor.example.org/users/oidc/callback
```

The hostname is illustrative; the callback path is the verified contract.

A transient default-value mismatch is tracked centrally as `IMP-001` in
[`documentation-remediation.yml`](../backlog/documentation-remediation.yml). Product documentation must not repeat that defect,
its temporary consequences, or a workaround. It describes the corrected working configuration represented by this
decision.

## Gate effect

`DEC-002` no longer blocks D04 or D12. Any later intentional change to the users-router mount, callback route, or OIDC
redirect contract reopens this decision and requires re-verification of both packages.

## P11 route-owner reconciliation (2026-10-25)

The explicitly requested cutover retires that native users router. The canonical document router and its identity
composition retain `/users/oidc/callback` and the existing OIDC handler. This changes source ownership only; the
public callback URL, identity-provider registration requirement and original decision remain unchanged.
