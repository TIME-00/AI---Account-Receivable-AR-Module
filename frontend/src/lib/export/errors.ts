// ============================================================================
// TSH Synergy AR — Gate C report export: typed error taxonomy
//
// The hook and UI branch on these classes to show the right message. None of
// them carries backend SQL/schema detail — only safe, user-facing copy.
// ============================================================================

import type { ExportOversizeDetails } from "./types";

export type ExportErrorKind =
  | "validation"
  | "authorization"
  | "oversize"
  | "network"
  | "parse"
  | "generation";

export class ExportError extends Error {
  readonly kind: ExportErrorKind;
  constructor(kind: ExportErrorKind, message: string) {
    super(message);
    this.name = "ExportError";
    this.kind = kind;
  }
}

export class ExportValidationError extends ExportError {
  constructor(message = "The export request was rejected. Adjust the report filters and try again.") {
    super("validation", message);
    this.name = "ExportValidationError";
  }
}

export class ExportAuthorizationError extends ExportError {
  constructor(message = "You are not authorized to export this report.") {
    super("authorization", message);
    this.name = "ExportAuthorizationError";
  }
}

export class ExportOversizeError extends ExportError {
  readonly details?: ExportOversizeDetails;
  constructor(message: string, details?: ExportOversizeDetails) {
    super("oversize", message);
    this.name = "ExportOversizeError";
    this.details = details;
  }
}

export class ExportNetworkError extends ExportError {
  constructor(message = "The export could not be reached. Check your connection and try again.") {
    super("network", message);
    this.name = "ExportNetworkError";
  }
}

export class ExportGenerationError extends ExportError {
  constructor(message = "The export file could not be generated.") {
    super("generation", message);
    this.name = "ExportGenerationError";
  }
}
