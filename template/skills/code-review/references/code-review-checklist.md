# Code Review Checklist

## Scope
- Confirm reviewed diff matches requested task scope.
- Confirm no accidental unrelated behavior changes.

## Correctness
- Validate happy path behavior.
- Validate edge cases and boundary conditions.
- Validate error handling and exception mapping.

## Regression Risk
- Check backward compatibility of public APIs and DTOs.
- Check side effects in adjacent modules.
- Check concurrency or transactional side effects.

## Security
- Validate input validation at boundaries.
- Validate authorization checks at service level.
- Validate query safety and no injection vectors.

## Testing
- Confirm tests define expected behavior for changed runtime logic.
- Confirm bug fixes include regression tests.
- Confirm test scope matches impact scope.

## Documentation
- Confirm documentation impact assessment exists when behavior changed.
- Confirm documentation update targets are identified when contracts, behavior, or operation flow changed.
- Confirm changelog update is planned for runtime behavior changes.

## Rule Checklist Row Template
```text
| rule_id | status | evidence |
|---------|--------|----------|
| TEST-PASS-GATE | PASS | backend/application/src/test/...:42 |
```

## Mandatory Core Rule IDs
- `SOLID-SRP`
- `SOLID-OCP`
- `SOLID-DIP`
- `QG-COMPLEXITY`
- `QG-TRANSACTIONS`
- `QG-INPUT-VALIDATION`
- `TEST-TEST-FIRST`
- `TEST-REGRESSION`
- `TEST-PASS-GATE`
- `DOC-IMPACT-ASSESSMENT`
- `DOC-UPDATE-REQUIRED`
- `DOC-CHANGELOG-ENTRY`

Include additional rule ids when scope requires them.
