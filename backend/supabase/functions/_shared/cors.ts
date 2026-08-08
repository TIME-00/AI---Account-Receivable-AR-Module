// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// CORS Handler for Edge Functions
// ============================================================================

/**
 * Standard CORS headers for API responses.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-id", // 关键：在这里加入 apikey 和 x-company-id
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, PATCH, DELETE",
};

/**
 * Handle CORS preflight requests.
 * Call this at the top of every Edge Function's serve handler.
 *
 * @example
 * ```ts
 * Deno.serve(async (req) => {
 *   // Handle CORS preflight
 *   if (req.method === 'OPTIONS') {
 *     return handleCORS();
 *   }
 *   // ... rest of handler
 * });
 * ```
 */
export function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Create a JSON response with CORS headers.
 */
export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
