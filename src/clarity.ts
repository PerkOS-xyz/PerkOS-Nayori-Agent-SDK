import { ClarityType } from "@stacks/transactions";
import type {
  ClarityValue,
  ListCV,
  PrincipalCV,
  ResponseCV,
  SomeCV,
  TupleCV,
} from "@stacks/transactions";
import { CLARITY_ERROR_MESSAGES } from "./constants.js";
import { PerkOSError } from "./errors.js";

function cvType(value: ClarityValue): string {
  return String(value.type);
}

export function unwrapResponse(value: ClarityValue, context: string): ClarityValue {
  if (value.type === ClarityType.ResponseOk) {
    return (value as ResponseCV).value;
  }
  if (value.type === ClarityType.ResponseErr) {
    const errorValue = (value as ResponseCV).value;
    const clarityCode =
      errorValue.type === ClarityType.UInt || errorValue.type === ClarityType.Int
        ? BigInt(errorValue.value)
        : undefined;
    const knownMessage =
      clarityCode !== undefined ? CLARITY_ERROR_MESSAGES[Number(clarityCode)] : undefined;
    throw new PerkOSError(
      "CONTRACT_ERROR",
      knownMessage ?? `${context} returned a Clarity error.`,
      clarityCode === undefined ? undefined : { clarityCode }
    );
  }
  throw new PerkOSError(
    "READ_FAILED",
    `${context} returned ${cvType(value)} instead of a Clarity response.`
  );
}

export function expectTuple(value: ClarityValue, context: string): TupleCV["value"] {
  if (value.type !== ClarityType.Tuple) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity tuple.`);
  }
  return (value as TupleCV).value;
}

export function expectList(value: ClarityValue, context: string): readonly ClarityValue[] {
  if (value.type !== ClarityType.List) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity list.`);
  }
  return (value as ListCV).value;
}

export function expectUint(value: ClarityValue | undefined, context: string): bigint {
  if (!value || value.type !== ClarityType.UInt) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity uint.`);
  }
  return BigInt(value.value);
}

export function expectString(value: ClarityValue | undefined, context: string): string {
  if (
    !value ||
    (value.type !== ClarityType.StringASCII && value.type !== ClarityType.StringUTF8)
  ) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity string.`);
  }
  return value.value;
}

export function expectPrincipal(value: ClarityValue | undefined, context: string): string {
  if (
    !value ||
    (value.type !== ClarityType.PrincipalStandard &&
      value.type !== ClarityType.PrincipalContract)
  ) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity principal.`);
  }
  return (value as PrincipalCV).value;
}

export function expectBoolean(value: ClarityValue | undefined, context: string): boolean {
  if (!value || (value.type !== ClarityType.BoolTrue && value.type !== ClarityType.BoolFalse)) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity boolean.`);
  }
  return value.type === ClarityType.BoolTrue;
}

export function optionalPrincipal(
  value: ClarityValue | undefined,
  context: string
): string | undefined {
  if (!value || value.type === ClarityType.OptionalNone) return undefined;
  if (value.type !== ClarityType.OptionalSome) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity optional.`);
  }
  return expectPrincipal((value as SomeCV<ClarityValue>).value, context);
}

export function optionalBuffer(
  value: ClarityValue | undefined,
  context: string
): string | undefined {
  if (!value || value.type === ClarityType.OptionalNone) return undefined;
  if (value.type !== ClarityType.OptionalSome) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity optional.`);
  }
  const inner = (value as SomeCV<ClarityValue>).value;
  if (inner.type !== ClarityType.Buffer) {
    throw new PerkOSError("READ_FAILED", `${context} must contain a Clarity buffer.`);
  }
  return inner.value;
}

export function optionalUint(
  value: ClarityValue | undefined,
  context: string
): bigint | undefined {
  if (!value || value.type === ClarityType.OptionalNone) return undefined;
  if (value.type !== ClarityType.OptionalSome) {
    throw new PerkOSError("READ_FAILED", `${context} must be a Clarity optional.`);
  }
  return expectUint((value as SomeCV<ClarityValue>).value, context);
}
