/**
 * Domain errors carry a machine code plus a message that is safe to show to a
 * customer or staff member. Technical detail belongs in `detail`, which is
 * logged but never rendered — spec §17: never show technical errors to users.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    /** Safe to display verbatim in the UI. */
    readonly userMessage: string,
    readonly detail?: unknown,
  ) {
    super(userMessage);
    this.name = "DomainError";
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super(
      "INVALID_TRANSITION",
      "This action is no longer possible for this booking.",
      `${entity}: ${from} -> ${to}`,
    );
    this.name = "InvalidTransitionError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super("NOT_FOUND", "We could not find that record.", what);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(detail?: string) {
    super("FORBIDDEN", "You do not have permission to do that.", detail);
    this.name = "ForbiddenError";
  }
}
