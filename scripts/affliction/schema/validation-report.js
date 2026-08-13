export class AfflictionValidationReport {
  #issues = [];

  add({ severity = "error", code, path = "", message, data = {} }) {
    this.#issues.push(Object.freeze({ severity, code, path, message, data }));
    return this;
  }

  get issues() { return [...this.#issues]; }
  get errors() { return this.#issues.filter((issue) => issue.severity === "error"); }
  get warnings() { return this.#issues.filter((issue) => issue.severity === "warning"); }
  get hints() { return this.#issues.filter((issue) => issue.severity === "hint"); }
  get information() { return this.#issues.filter((issue) => issue.severity === "info"); }
  get valid() { return this.errors.length === 0; }

  toJSON() {
    return {
      valid: this.valid,
      issues: this.issues,
      errors: this.errors,
      warnings: this.warnings,
      hints: this.hints,
      information: this.information
    };
  }
}

export class AfflictionValidationError extends Error {
  constructor(report) {
    super(`Affliction definition is invalid (${report?.errors?.length ?? 0} error(s)).`);
    this.name = "AfflictionValidationError";
    this.report = report;
  }
}
