# Core Rules

Primary entry point: [CLAUDE.md](../../../../CLAUDE.md)

## Language
Respond in {{ASSISTANT_RESPONSE_LANGUAGE}} for explanations and assistance.

## Response Style
Default response brevity: {{ASSISTANT_RESPONSE_BREVITY}}.

## Communication
1. Respond in {{ASSISTANT_RESPONSE_LANGUAGE}}.
2. Keep responses {{ASSISTANT_RESPONSE_BREVITY}} unless the user explicitly asks for more or less detail.
3. Keep code in English (variables, functions, classes, comments in code).
4. Keep documentation in English (README, docs, file content).

## Code Quality

### Cleanliness and Readability
- Code must be self-documenting.
- Use meaningful names (`productRepository` instead of `repo`).
- Keep functions small and focused.
- Avoid magic numbers and use constants.

### Single Responsibility Principle (SRP)
- Each class or function should have one responsibility.
- Split functions that perform multiple responsibilities.
- Split classes that have multiple reasons to change.

### DRY (Don't Repeat Yourself)
- Do not duplicate code; extract shared logic.
- Avoid copy-paste solutions.
- Reuse services, utilities, and base abstractions.

### Comments
- Minimize comments.
- Do not comment obvious behavior.
- Write comments only in English.
- Use comments only for rationale or non-obvious business constraints.

Bad example:
```java
// Increment counter
counter++;
```

Good example:
```java
// Skip first element due to API limitation that always returns a duplicate
items.stream().skip(1)...
```

