import type { ErrorObject, ValidateFunction } from "ajv";

import { JsonDataError, normalizeJsonData } from "./canonical.js";
import type { JsonValue } from "./canonical.js";
import { ContractValidationError } from "./errors.js";
import type { ContractIssue } from "./errors.js";

const schemaIssues = (errors: ErrorObject[] | null | undefined): ContractIssue[] =>
  (errors ?? []).map((error) => ({
    code: `schema.${error.keyword}`,
    path: error.instancePath || "/",
    message: error.message ?? "schema constraint failed",
  }));

function assertSchema<T>(
  contract: string,
  validator: ValidateFunction<T>,
  value: unknown,
): asserts value is T {
  if (!validator(value)) {
    throw new ContractValidationError(contract, schemaIssues(validator.errors));
  }
}

export function inputFailure(
  contract: string,
  code: string,
  path: string,
  message: string,
): never {
  throw new ContractValidationError(contract, [{ code, path, message }]);
}

export function normalizedSchemaValue<T>(
  contract: string,
  validator: ValidateFunction<T>,
  value: unknown,
): T {
  const normalized = normalizedJsonValue(contract, value);
  assertSchema(contract, validator, normalized);
  return normalized;
}

export function normalizedJsonValue(contract: string, value: unknown): JsonValue {
  try {
    return normalizeJsonData(value);
  } catch (error) {
    if (error instanceof JsonDataError) {
      inputFailure(contract, `input.${error.code}`, error.path, error.message);
    }
    throw error;
  }
}
