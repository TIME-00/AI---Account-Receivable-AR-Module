// ============================================================================
// AR Copilot — privacy and read-only disclosure copy.
//
// This is a single source of truth on purpose. The AR Help drawer previously
// told users that the feature "does not use any external AI service and never
// sends your data anywhere". That was true of static help; it is FALSE of AR
// Copilot, which calls OpenAI. Keeping the wording in one module means the
// claim can be asserted by test and cannot drift back into a component.
//
// Every statement below is limited to what the reviewed backend actually
// proves:
//
//   - the provider call is `backend/supabase/functions/ar-copilot/openai.ts`;
//   - the tool registry has no mutation, SQL, RPC, or arbitrary HTTP tool;
//   - `assertToolOutcomeSafe` rejects token/secret/oauth/password/email/phone/
//     address/tax_id/bank_account/raw_body/ocr_text/recipient fields before any
//     tool result is given to the model;
//   - no chat-history table exists and this UI keeps the conversation in memory
//     for the current session only;
//   - the request body sets `store: false`.
//
// What is deliberately NOT claimed: that OpenAI retains nothing. `store:false`
// is a request-level instruction, not an independently established statement
// about a third party's retention, so it is described as what it is.
// ============================================================================

/** The one-line disclosure shown wherever the Copilot is first presented. */
export const COPILOT_PRIVACY_SUMMARY =
  "AR Copilot uses OpenAI to generate responses. Only the minimum authorized " +
  "context needed for your question is shared. It is read-only and cannot " +
  "post, cancel, allocate, or change financial records.";

/** Compact status shown in the panel header. */
export const COPILOT_READ_ONLY_BADGE = "Read-only assistant";

/** Tooltip / description for the read-only badge. */
export const COPILOT_READ_ONLY_DETAIL =
  "AR Copilot can explain and retrieve authorized information. Financial " +
  "actions continue through the existing AR workflows.";

/** Heading for the expandable note. */
export const COPILOT_PRIVACY_DETAIL_HEADING = "What is and is not shared";

/**
 * The expandable detail. Each line is individually supported by the reviewed
 * backend; nothing here describes a third party's internal retention policy.
 */
export const COPILOT_PRIVACY_DETAILS: readonly string[] = [
  "Raw Gmail message bodies are not sent.",
  "Attachment and document content is not sent.",
  "Customer contact details and bank credentials are not sent.",
  "Credentials, tokens, and API keys are not sent.",
  "This AR application does not store your conversation; it is kept in this browser session only and is cleared when you sign out, switch company, or reload.",
  "Requests to OpenAI are sent with storage disabled, and answers are generated from bounded evidence you are already authorized to read.",
];

/**
 * Phrases that were true of the old static help panel and are false once a
 * provider call exists. Exported so a test can assert they are absent from the
 * shipped UI rather than relying on review to catch a regression.
 */
export const STALE_PRIVACY_CLAIMS: readonly string[] = [
  "does not use any external AI service",
  "never sends your data anywhere",
  "no external AI",
  "no data leaves the browser",
];
