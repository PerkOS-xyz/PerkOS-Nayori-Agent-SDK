export type PerkOSErrorCode =
  | "CONFIG_INVALID"
  | "INPUT_INVALID"
  | "CONTRACT_ERROR"
  | "READ_FAILED"
  | "SIGNER_REQUIRED"
  | "SIGNER_MISMATCH"
  | "POLICY_DENIED"
  | "POLICY_LIMIT_REQUIRED"
  | "SIGNING_FAILED";

export interface PerkOSErrorDetails {
  readonly clarityCode?: bigint;
  readonly contract?: string;
  readonly functionName?: string;
  readonly cause?: unknown;
  readonly [key: string]: unknown;
}

export class PerkOSError extends Error {
  readonly code: PerkOSErrorCode;
  readonly details: PerkOSErrorDetails | undefined;

  constructor(code: PerkOSErrorCode, message: string, details?: PerkOSErrorDetails) {
    super(message);
    this.name = "PerkOSError";
    this.code = code;
    this.details = details;
  }
}
