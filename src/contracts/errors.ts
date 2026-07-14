export interface ContractIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class ContractValidationError extends Error {
  readonly contract: string;
  readonly issues: readonly ContractIssue[];

  constructor(contract: string, issues: readonly ContractIssue[]) {
    super(`${contract} failed validation with ${issues.length} issue(s)`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.issues = issues;
  }
}

export const issue = (code: string, path: string, message: string): ContractIssue => ({
  code,
  path,
  message,
});

export function assertNoIssues(contract: string, issues: ContractIssue[]): void {
  if (issues.length > 0) {
    throw new ContractValidationError(contract, issues);
  }
}
