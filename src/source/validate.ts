import { Ajv2020 } from "ajv/dist/2020.js";

import { parseCanonicalJson } from "../contracts/canonical.js";
import type { ParseLimits } from "../contracts/canonical.js";
import { assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import { sourceStateSchema } from "./schema.js";
import type { SourceState } from "./schema.js";

const sourceStateContract = "impactdiff.source-state/v1";
const sourceStateLimits = {
  maximumBytes: 1_048_576,
  maximumDepth: 8,
  maximumValues: 10_000,
} as const satisfies ParseLimits;

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const sourceStateValidator = ajv.compile<SourceState>(sourceStateSchema);

function unsafeRelativePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function sourceStateIssues(value: SourceState): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const paths = new Set<string>();
  let priorPath: string | undefined;

  for (const [index, resource] of value.source.resources.entries()) {
    const path = `/source/resources/${index}/path`;
    if (unsafeRelativePath(resource.path)) {
      issues.push(
        issue(
          "source_state.resource_path",
          path,
          "resource paths must be normalized relative paths without traversal",
        ),
      );
    }
    if (paths.has(resource.path)) {
      issues.push(
        issue("source_state.duplicate_resource", path, "resource paths must be unique"),
      );
    }
    if (priorPath !== undefined && resource.path <= priorPath) {
      issues.push(
        issue(
          "source_state.resource_order",
          path,
          "resources must be strictly sorted by path",
        ),
      );
    }
    paths.add(resource.path);
    priorPath = resource.path;

    const parameterNames = resource.media_type
      .split("; ")
      .slice(1)
      .map((parameter) => parameter.slice(0, parameter.indexOf("=")));
    const sortedNames = [...parameterNames].sort();
    if (
      new Set(parameterNames).size !== parameterNames.length ||
      parameterNames.some(
        (name, parameterIndex) => name !== sortedNames[parameterIndex],
      )
    ) {
      issues.push(
        issue(
          "source_state.media_type_parameter_order",
          `/source/resources/${index}/media_type`,
          "media-type parameters must be unique and sorted by name",
        ),
      );
    }
  }

  if (unsafeRelativePath(value.source.entrypoint)) {
    issues.push(
      issue(
        "source_state.entrypoint_path",
        "/source/entrypoint",
        "the entrypoint must be a normalized relative path",
      ),
    );
  } else if (!paths.has(value.source.entrypoint)) {
    issues.push(
      issue(
        "source_state.entrypoint_missing",
        "/source/entrypoint",
        "the entrypoint must name one resource in the closed source package",
      ),
    );
  }
  if (
    value.initial_state.route.includes("//") ||
    value.initial_state.route
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    issues.push(
      issue(
        "source_state.initial_route",
        "/initial_state/route",
        "the initial route must be normalized and cannot contain traversal",
      ),
    );
  }
  return issues;
}

export function validateSourceState(value: unknown): SourceState {
  const normalized = normalizedSchemaValue(
    sourceStateContract,
    sourceStateValidator,
    value,
  );
  assertNoIssues(sourceStateContract, sourceStateIssues(normalized));
  return normalized;
}

export function parseSourceState(input: string | Uint8Array): SourceState {
  return validateSourceState(parseCanonicalJson(input, sourceStateLimits));
}
