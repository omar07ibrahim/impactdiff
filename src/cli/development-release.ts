import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const helpText =
  "Usage: development-release --root <pre-existing-0700-publication-root>\n";
const defaultFailureCode = "generation.failed";
const argumentFailureCode = "generation.arguments";
const maximumFailureCodeLength = 128;
const safeFailureCodePattern = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

type ParsedArguments =
  { readonly kind: "help" } | { readonly kind: "release"; readonly root: string };

class DevelopmentReleaseCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super();
    this.name = "DevelopmentReleaseCliError";
    this.code = code;
  }
}

function argumentFailure(): never {
  throw new DevelopmentReleaseCliError(argumentFailureCode);
}

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  let help = false;
  let root: string | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      if (help) argumentFailure();
      help = true;
      continue;
    }
    if (argument === "--root") {
      if (root !== undefined) argumentFailure();
      const value = arguments_[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        argumentFailure();
      }
      root = value;
      index += 1;
      continue;
    }
    argumentFailure();
  }

  if (help) {
    if (root !== undefined) argumentFailure();
    return Object.freeze({ kind: "help" });
  }
  if (root === undefined) argumentFailure();
  return Object.freeze({ kind: "release", root });
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

async function main(): Promise<void> {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed.kind === "help") {
      process.stdout.write(helpText);
      return;
    }

    const publicationRoot = resolve(process.cwd(), parsed.root);
    const fixtureDirectory = fileURLToPath(
      new URL("../../../fixtures/checkout-card-v1/", import.meta.url),
    );
    const { publishFreshMutationFixturePair } = await import("../generation/index.js");
    const release = await publishFreshMutationFixturePair({
      fixtureDirectory,
      publicationRoot,
      operatorKey: "pointer_interceptor",
    });
    process.stdout.write(
      `${JSON.stringify({
        publication_id: release.commit.publication_id,
        evidence_id: release.evidence.evidence_id,
        sealed_record_id: release.sealedRecord.sealed_record_id,
        release_path: release.paths.releasePath,
      })}\n`,
    );
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${JSON.stringify({ code: safeFailureCode(error) })}\n`);
  }
}

await main();
