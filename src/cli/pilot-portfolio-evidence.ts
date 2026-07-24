import { resolve } from "node:path";

import {
  captureAndPublishPilotPortfolioEvidence,
  verifyPilotPortfolioEvidenceForRepository,
} from "../portfolio-evidence/index.js";

const helpText =
  "Usage: pilot-portfolio-evidence capture --repository <repository-root> --output <new-bundle-directory>\n" +
  "       pilot-portfolio-evidence check --repository <repository-root> --output <bundle-directory>\n";
const defaultFailureCode = "portfolio_evidence.failed";
const argumentFailureCode = "portfolio_evidence.arguments";
const maximumFailureCodeLength = 128;
const safeFailureCodePattern = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

type ParsedArguments =
  | { readonly kind: "help" }
  | {
      readonly kind: "capture";
      readonly repository: string;
      readonly output: string;
    }
  | {
      readonly kind: "check";
      readonly repository: string;
      readonly output: string;
    };

class PilotPortfolioEvidenceCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super();
    this.name = "PilotPortfolioEvidenceCliError";
    this.code = code;
  }
}

function argumentFailure(): never {
  throw new PilotPortfolioEvidenceCliError(argumentFailureCode);
}

function argumentValue(arguments_: readonly string[], index: number): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    argumentFailure();
  }
  return value;
}

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  if (arguments_.length === 1 && arguments_[0] === "--help") {
    return Object.freeze({ kind: "help" });
  }
  const command = arguments_[0];
  if (command !== "capture" && command !== "check") {
    argumentFailure();
  }
  let repository: string | undefined;
  let output: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--repository") {
      if (repository !== undefined) argumentFailure();
      repository = argumentValue(arguments_, index);
      index += 1;
      continue;
    }
    if (argument === "--output") {
      if (output !== undefined) argumentFailure();
      output = argumentValue(arguments_, index);
      index += 1;
      continue;
    }
    argumentFailure();
  }
  if (output === undefined) argumentFailure();
  if (repository === undefined) argumentFailure();
  return Object.freeze({ kind: command, repository, output });
}

function safeFailureCode(error: unknown): string {
  try {
    if (typeof error !== "object" || error === null) return defaultFailureCode;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code =
      descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
    return typeof code === "string" &&
      code.length > 0 &&
      code.length <= maximumFailureCodeLength &&
      safeFailureCodePattern.test(code)
      ? code
      : defaultFailureCode;
  } catch {
    return defaultFailureCode;
  }
}

function writeReceipt(
  receipt: Awaited<ReturnType<typeof verifyPilotPortfolioEvidenceForRepository>>,
): void {
  process.stdout.write(
    `${JSON.stringify({
      official: receipt.official,
      manifest_sha256: receipt.manifest_sha256,
      fixture_count: receipt.fixture_count,
      workflow_count: receipt.workflow_count,
      checkpoint_count: receipt.checkpoint_count,
    })}\n`,
  );
}

async function main(): Promise<void> {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed.kind === "help") {
      process.stdout.write(helpText);
      return;
    }
    const output = resolve(process.cwd(), parsed.output);
    const repository = resolve(process.cwd(), parsed.repository);
    const receipt =
      parsed.kind === "capture"
        ? await captureAndPublishPilotPortfolioEvidence(repository, output)
        : await verifyPilotPortfolioEvidenceForRepository(repository, output);
    writeReceipt(receipt);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${JSON.stringify({ code: safeFailureCode(error) })}\n`);
  }
}

await main();
