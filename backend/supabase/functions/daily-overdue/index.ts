// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Scheduled Task: Daily Overdue & Credit Control
// ============================================================================
// Implements:
//   BR-INV-005: Update invoice status to 'Overdue' when past due_date
//   BR-CM-004:  Auto-hold customers with >90 days overdue balance
//
// Trigger: Supabase CRON (pg_cron) or external scheduler
// Recommended schedule: Daily at 01:00 UTC (09:00 MYT)
//
// Deployment:
//   supabase functions deploy daily-overdue
//   Then set up a pg_cron job or external cron to POST to this function daily.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/db.ts';
import { roundTo2 } from '../invoices/calculator.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OverdueResult {
  invoices_updated: number;
  customers_held: number;
  customers_checked: number;
  errors: string[];
  execution_time_ms: number;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  const startTime = Date.now();
  const client = getAdminClient();
  const result: OverdueResult = {
    invoices_updated: 0,
    customers_held: 0,
    customers_checked: 0,
    errors: [],
    execution_time_ms: 0,
  };

  try {
    // Optional: Verify this is called by a trusted source (cron secret)
    const cronSecret = req.headers.get('X-Cron-Secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    if (expectedSecret && cronSecret !== expectedSecret) {
      return jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } }, 401);
    }

    const today = new Date().toISOString().slice(0, 10);
    console.log(`[DAILY-OVERDUE] Starting daily overdue check for ${today}`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 1: BR-INV-005 — Update invoice status to 'Overdue'
    // ════════════════════════════════════════════════════════════════════
    // Find all Open/Partially Paid invoices where due_date < today
    // and update their status to 'Overdue'.

    const { data: overdueInvoices, error: invErr } = await client
      .from('invoices')
      .select('id, invoice_no, customer_id, due_date, outstanding, status')
      .in('status', ['Open', 'Partially Paid'])
      .in('doc_type', ['Invoice', 'Debit Note'])
      .lt('due_date', today)
      .gt('outstanding', 0);

    if (invErr) {
      result.errors.push(`Failed to fetch overdue invoices: ${invErr.message}`);
      console.error('[DAILY-OVERDUE] Invoice fetch error:', invErr.message);
    } else if (overdueInvoices && overdueInvoices.length > 0) {
      // Batch update all discovered overdue invoices
      const invoiceIds = overdueInvoices.map(i => i.id);

      const { error: updateErr, count } = await client
        .from('invoices')
        .update({ status: 'Overdue' })
        .in('id', invoiceIds)
        .in('status', ['Open', 'Partially Paid']); // Safety: only update non-terminal

      if (updateErr) {
        result.errors.push(`Failed to update overdue invoices: ${updateErr.message}`);
      } else {
        result.invoices_updated = count ?? invoiceIds.length;
        console.log(`[DAILY-OVERDUE] Updated ${result.invoices_updated} invoices to Overdue`);
      }
    } else {
      console.log('[DAILY-OVERDUE] No new overdue invoices found');
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 2: BR-CM-004 — Auto-hold customers with >90 days overdue
    // ════════════════════════════════════════════════════════════════════
    // Business rule: If a customer has ANY invoice >90 days past due,
    // and their status is currently Active, change to 'On Hold'.
    // This is a conservative measure — does NOT block, only holds.
    // Finance Manager can review and decide to block or release.

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoffDate = ninetyDaysAgo.toISOString().slice(0, 10);

    // Find all distinct customers with invoices overdue by >90 days
    const { data: severeOverdue, error: severeErr } = await client
      .from('invoices')
      .select('customer_id')
      .in('status', ['Overdue'])
      .in('doc_type', ['Invoice', 'Debit Note'])
      .lt('due_date', cutoffDate)
      .gt('outstanding', 0);

    if (severeErr) {
      result.errors.push(`Failed to fetch severe overdue: ${severeErr.message}`);
    } else if (severeOverdue && severeOverdue.length > 0) {
      // Deduplicate customer IDs
      const customerIds = [...new Set(severeOverdue.map(i => i.customer_id))];
      result.customers_checked = customerIds.length;

      for (const custId of customerIds) {
        try {
          // Only hold Active customers (don't downgrade On Hold → On Hold or Blocked → On Hold)
          const { data: customer } = await client
            .from('customers')
            .select('id, customer_name, status')
            .eq('id', custId)
            .eq('status', 'Active')
            .single();

          if (!customer) continue; // Already On Hold, Blocked, or Inactive

          // Calculate the worst overdue days for this customer
          const { data: worstInvoice } = await client
            .from('invoices')
            .select('invoice_no, due_date, outstanding')
            .eq('customer_id', custId)
            .in('status', ['Overdue'])
            .in('doc_type', ['Invoice', 'Debit Note'])
            .gt('outstanding', 0)
            .order('due_date', { ascending: true })
            .limit(1)
            .single();

          if (!worstInvoice) continue;

          const worstDueDate = new Date(worstInvoice.due_date);
          const daysPastDue = Math.floor(
            (new Date().getTime() - worstDueDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Update customer status to On Hold
          const { error: holdErr } = await client
            .from('customers')
            .update({ status: 'On Hold' })
            .eq('id', custId)
            .eq('status', 'Active'); // Optimistic check

          if (holdErr) {
            result.errors.push(`Failed to hold customer ${custId}: ${holdErr.message}`);
            continue;
          }

          result.customers_held++;

          // Write audit log
          await client
            .from('customer_change_logs')
            .insert({
              customer_id: custId,
              field_name: 'status',
              old_value: 'Active',
              new_value: 'On Hold',
              changed_by: null, // System action
              change_reason: `BR-CM-004: Auto-hold — Invoice ${worstInvoice.invoice_no} is ${daysPastDue} days past due (>90 days), outstanding amount ${worstInvoice.outstanding}`,
            });

          // Write credit control log
          await client
            .from('credit_control_logs')
            .insert({
              company_id: (await client.from('customers').select('company_id').eq('id', custId).single()).data?.company_id,
              customer_id: custId,
              action: 'Auto Hold (>90 days)',
              details: `System auto-hold: Invoice ${worstInvoice.invoice_no} is ${daysPastDue} days past due. Earliest due date: ${worstInvoice.due_date}, outstanding: ${worstInvoice.outstanding}`,
              amount: Number(worstInvoice.outstanding),
              created_by: null,
            });

          // Notification placeholder
          console.log(`[EMAIL_HOOK] Auto-hold notification: Customer ${customer.customer_name} held due to ${daysPastDue}-day overdue invoice ${worstInvoice.invoice_no}`);

        } catch (err) {
          result.errors.push(`Error processing customer ${custId}: ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      }

      console.log(`[DAILY-OVERDUE] Checked ${result.customers_checked} customers, held ${result.customers_held}`);
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 3: Summary
    // ════════════════════════════════════════════════════════════════════

    result.execution_time_ms = Date.now() - startTime;

    console.log(`[DAILY-OVERDUE] Complete. Invoices: ${result.invoices_updated}, Customers held: ${result.customers_held}, Time: ${result.execution_time_ms}ms`);

    return jsonResponse({
      success: true,
      data: result,
    });

  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    result.execution_time_ms = Date.now() - startTime;

    console.error('[DAILY-OVERDUE] Fatal error:', error);

    return jsonResponse({
      success: false,
      data: result,
      error: { code: 'SCHEDULED_TASK_ERROR', message: 'Daily overdue task failed' },
    }, 500);
  }
});
