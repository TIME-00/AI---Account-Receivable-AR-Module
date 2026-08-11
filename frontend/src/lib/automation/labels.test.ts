// Gate E — label/tone completeness + truthful status wording.
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_PROCESSING_STATUSES,
  CLASSIFICATION_STATUSES,
  COMMAND_STATUSES,
  COMMAND_TYPES,
  CONNECTION_STATUSES,
  DOCUMENT_TYPES,
  EXCEPTION_LIFECYCLES,
  EXCEPTION_REASON_CODES,
  OPERATING_MODES,
  REMINDER_ATTEMPT_STATUSES,
  REMINDER_STATUSES,
  RUN_STATUSES,
} from "./contract";
import {
  CLASSIFICATION_STATUS_LABEL,
  CLASSIFICATION_STATUS_TONE,
  COMMAND_STATUS_LABEL,
  COMMAND_STATUS_TONE,
  COMMAND_TYPE_LABEL,
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPE_TONE,
  EXCEPTION_LIFECYCLE_LABEL,
  EXCEPTION_LIFECYCLE_TONE,
  EXCEPTION_REASON_LABEL,
  OPERATING_MODE_DESCRIPTION,
  OPERATING_MODE_FINANCIAL_IMPACT,
  OPERATING_MODE_LABEL,
  OPERATING_MODE_TONE,
  PROCESSING_STATUS_LABEL,
  PROCESSING_STATUS_TONE,
  RECOVERY_ACTION_LABEL,
  REMINDER_ATTEMPT_STATUS_LABEL,
  REMINDER_MODE_DESCRIPTION,
  REMINDER_MODE_LABEL,
  REMINDER_MODE_TONE,
  REMINDER_STATUS_LABEL,
  REMINDER_STATUS_TONE,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  switchStatusLabel,
} from "./labels";
import { RECOVERY_ACTION_TYPES, REMINDER_MODES } from "./contract";

function coverage(members: readonly string[], ...maps: Record<string, unknown>[]) {
  for (const member of members) {
    for (const map of maps) {
      expect(map[member], `missing label/tone for ${member}`).toBeDefined();
    }
  }
}

describe("label + tone completeness", () => {
  it("covers every operating mode (label, tone, description, impact)", () => {
    coverage(
      OPERATING_MODES,
      OPERATING_MODE_LABEL,
      OPERATING_MODE_TONE,
      OPERATING_MODE_DESCRIPTION,
      OPERATING_MODE_FINANCIAL_IMPACT,
    );
  });
  it("covers connection, run, document, classification, processing", () => {
    coverage(CONNECTION_STATUSES, CONNECTION_STATUS_LABEL, CONNECTION_STATUS_TONE);
    coverage(RUN_STATUSES, RUN_STATUS_LABEL, RUN_STATUS_TONE);
    coverage(DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL, DOCUMENT_TYPE_TONE);
    coverage(CLASSIFICATION_STATUSES, CLASSIFICATION_STATUS_LABEL, CLASSIFICATION_STATUS_TONE);
    coverage(ATTACHMENT_PROCESSING_STATUSES, PROCESSING_STATUS_LABEL, PROCESSING_STATUS_TONE);
  });
  it("covers commands, exceptions, reminders", () => {
    coverage(COMMAND_TYPES, COMMAND_TYPE_LABEL);
    coverage(COMMAND_STATUSES, COMMAND_STATUS_LABEL, COMMAND_STATUS_TONE);
    coverage(EXCEPTION_LIFECYCLES, EXCEPTION_LIFECYCLE_LABEL, EXCEPTION_LIFECYCLE_TONE);
    coverage(EXCEPTION_REASON_CODES, EXCEPTION_REASON_LABEL);
    coverage(REMINDER_STATUSES, REMINDER_STATUS_LABEL, REMINDER_STATUS_TONE);
    coverage(REMINDER_ATTEMPT_STATUSES, REMINDER_ATTEMPT_STATUS_LABEL);
  });
  it("labels all 29 exception reason codes", () => {
    expect(Object.keys(EXCEPTION_REASON_LABEL)).toHaveLength(29);
  });
});

describe("truthful status wording", () => {
  it("never labels a disabled mode as Live/Active", () => {
    expect(OPERATING_MODE_LABEL.disabled).toBe("Disabled");
    expect(OPERATING_MODE_LABEL.straight_through).not.toMatch(/live/i);
  });
  it("marks straight_through impact as posting without a person", () => {
    expect(OPERATING_MODE_FINANCIAL_IMPACT.straight_through).toMatch(/without a person/i);
  });
  it("switch status is Enabled/Disabled, never Live", () => {
    expect(switchStatusLabel(true).label).toBe("Enabled");
    expect(switchStatusLabel(false).label).toBe("Disabled");
  });
});

describe("reminder mode + recovery labels", () => {
  it("covers every reminder mode with label, tone, and description", () => {
    coverage(
      REMINDER_MODES,
      REMINDER_MODE_LABEL,
      REMINDER_MODE_TONE,
      REMINDER_MODE_DESCRIPTION,
    );
  });
  it("describes reminder modes truthfully", () => {
    expect(REMINDER_MODE_LABEL.off).toBe("Off");
    expect(REMINDER_MODE_DESCRIPTION.evaluate_only).toMatch(/does not send email/i);
    expect(REMINDER_MODE_DESCRIPTION.automatic_delivery).toMatch(/sends approved/i);
  });
  it("labels both recovery actions without implying AI auto-correction", () => {
    coverage(RECOVERY_ACTION_TYPES, RECOVERY_ACTION_LABEL);
    expect(RECOVERY_ACTION_LABEL.confirm_receipt_invoice_match).toMatch(/Confirm/i);
    expect(RECOVERY_ACTION_LABEL.correct_invoice_external_reference).toMatch(/External Reference/i);
    for (const label of Object.values(RECOVERY_ACTION_LABEL)) {
      expect(label).not.toMatch(/AI|OCR/i);
    }
  });
});
