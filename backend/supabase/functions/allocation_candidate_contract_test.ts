import type { AuthContext } from './_shared/auth.ts';
import { AuthenticationError } from './_shared/errors.ts';
import { createAllocationHandler } from './allocations/index.ts';
import {
  ALLOCATION_CANDIDATE_CONTRACT_VERSION,
  ALLOCATION_CANDIDATE_MAX,
  AllocationService,
} from './allocations/service.ts';
import type { AllocationCandidateResult } from './allocations/service.ts';

const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = 'Values differ'): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertJsonEquals(actual: unknown, expected: unknown, message = 'JSON values differ'): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}. Expected ${expectedJson}, got ${actualJson}`);
  }
}

const companyId = '30000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000002';
const receiptId = '30000000-0000-4000-8000-000000000003';
const customerId = '30000000-0000-4000-8000-000000000004';
const invoiceId1 = '30000000-0000-4000-8000-000000000005';
const invoiceId2 = '30000000-0000-4000-8000-000000000006';

const clerkAuth: AuthContext = {
  userId,
  companyId,
  roles: ['AR Clerk'],
  highestRole: 'AR Clerk',
  email: 'allocation-clerk@example.test',
};

function candidateResult(candidateCount = 2): AllocationCandidateResult {
  const candidates = [
    {
      id: invoiceId1,
      invoice_no: 'INV-202607-00001',
      doc_type: 'Invoice' as const,
      invoice_date: '2026-07-01',
      due_date: '2026-07-10',
      currency: 'SGD',
      exchange_rate: 3.4,
      total_amount: 100,
      outstanding: 75,
      status: 'Partially Paid' as const,
      version: 2,
    },
    {
      id: invoiceId2,
      invoice_no: 'DN-202607-00001',
      doc_type: 'Debit Note' as const,
      invoice_date: '2026-07-02',
      due_date: null,
      currency: 'SGD',
      exchange_rate: 3.4,
      total_amount: 25,
      outstanding: 25,
      status: 'Open' as const,
      version: 1,
    },
  ].slice(0, candidateCount);

  return {
    contract_version: ALLOCATION_CANDIDATE_CONTRACT_VERSION,
    complete: true,
    max_candidates: ALLOCATION_CANDIDATE_MAX,
    ordering: ['due_date ASC NULLS LAST', 'invoice_no ASC', 'id ASC'],
    receipt: {
      id: receiptId,
      receipt_no: 'RCT-202607-00001',
      receipt_date: '2026-07-15',
      customer_id: customerId,
      customer_name: 'Allocation Contract Customer',
      currency: 'SGD',
      exchange_rate: 3.4,
      receipt_amount: 150,
      allocated_amount: 50,
      unallocated_amount: 100,
      payment_method: 'TT',
      status: 'Posted',
      version: 3,
    },
    customer_id: customerId,
    currency: 'SGD',
    total: candidates.length,
    candidates,
  };
}

class RpcOnlyClient {
  calls: Array<{ functionName: string; params: Record<string, unknown> }> = [];

  constructor(
    private readonly data: unknown,
    private readonly error: { message: string; code?: string } | null = null,
  ) {}

  async rpc(functionName: string, params: Record<string, unknown>) {
    this.calls.push({ functionName, params });
    return await Promise.resolve({ data: this.data, error: this.error });
  }
}

function request(path: string, method = 'GET'): Request {
  return new Request(`https://example.test/functions/v1/allocations${path}`, {
    method,
    headers: {
      Authorization: 'Bearer allocation-contract-test-token',
      'X-Company-Id': companyId,
    },
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test('Migration 030 installs one additive, service-role-only snapshot RPC', async () => {
  const migration = await read('../../../database/030_batch_9d_d_allocation_candidate_snapshot.sql');

  assertEquals((migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assertEquals((migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assertEquals(
    (migration.match(/CREATE FUNCTION public\.get_allocation_candidates\(/g) ?? []).length,
    1,
  );
  assert(migration.includes('RETURNS pg_catalog.jsonb'));
  assert(migration.includes('LANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path ='));
  assert(migration.includes("SET search_path = ''"));
  assert(migration.includes("'public.allocate_receipt(uuid,uuid,uuid,jsonb)'"));
  assert(migration.includes("'public.rpc_check_customer_access(uuid,uuid,uuid)'"));

  const signature = `public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
)`;
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM ${role};`));
  }
  assert(migration.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
});

Deno.test('Migration 030 independently enforces tenant, role, visibility, assignment, and Receipt eligibility', async () => {
  const migration = await read('../../../database/030_batch_9d_d_allocation_candidate_snapshot.sql');

  assert(migration.includes('FROM public.companies c'));
  assert(migration.includes('c.is_active = TRUE'));
  assert(migration.includes("ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')"));
  assert(!migration.includes("ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')"));
  assert(migration.includes('r.company_id = p_company_id'));
  assert(migration.includes('c.company_id = r.company_id'));
  assert(migration.includes('c.is_deleted = FALSE'));
  assert(migration.includes('c.is_hidden = FALSE'));
  assert(migration.includes('JOIN public.user_customer_assignments uca'));
  assert(migration.includes('uca.customer_id = v_receipt.customer_id'));
  assert(migration.includes("MESSAGE = 'NOT_FOUND: Receipt not found'"));
  assert(migration.includes("v_receipt.status <> 'Posted' OR v_receipt.unallocated_amount <= 0"));
  assert(migration.includes("MESSAGE = 'BR-ALLOC-CANDIDATES: Receipt is not eligible for allocation'"));
});

Deno.test('Migration 030 candidate eligibility and ordering match the governed allocation mutation boundary', async () => {
  const migration = await read('../../../database/030_batch_9d_d_allocation_candidate_snapshot.sql');
  const mutation = await read('../../../database/007_financial_rpcs.sql');
  const lifecycle = await read('../../../database/028_linked_credit_note_reference_integrity.sql');

  for (const fragment of [
    'i.company_id = p_company_id',
    'i.customer_id = v_receipt.customer_id',
    'i.currency = v_receipt.currency',
    "i.doc_type IN ('Invoice', 'Debit Note')",
    "i.status IN ('Open', 'Overdue', 'Partially Paid')",
    'i.outstanding > 0',
  ]) {
    assert(migration.includes(fragment), `Missing candidate rule: ${fragment}`);
  }
  assert(mutation.includes("v_inv.status NOT IN ('Open', 'Overdue', 'Partially Paid')"));
  assert(mutation.includes('v_inv.currency != v_rct.currency'));
  assert(mutation.includes('v_inv.customer_id != v_rct.customer_id'));
  assert(lifecycle.includes("v_invoice_doc_type NOT IN ('Invoice', 'Debit Note')"));
  assert(migration.includes('ORDER BY i.due_date ASC NULLS LAST, i.invoice_no ASC, i.id ASC'));
});

Deno.test('Migration 030 returns complete JSON without OFFSET/PostgREST truncation and fails on overflow', async () => {
  const migration = await read('../../../database/030_batch_9d_d_allocation_candidate_snapshot.sql');
  const functionBody = migration.split('AS $$')[1]?.split('$$;')[0] ?? '';

  assert(functionBody.includes('v_max_candidates CONSTANT pg_catalog.int4 := 5000'));
  assert(functionBody.includes('SELECT pg_catalog.count(*)'));
  assert(functionBody.includes('IF v_total > v_max_candidates THEN'));
  assert(!functionBody.includes('IF v_total >= v_max_candidates THEN'));
  assert(functionBody.includes("MESSAGE = 'BR-ALLOC-CANDIDATE-LIMIT:"));
  assert(functionBody.includes('pg_catalog.jsonb_agg('));
  assert(functionBody.includes("'[]'::pg_catalog.jsonb"));
  assert(functionBody.includes("'complete', TRUE"));
  assert(functionBody.includes("'total', v_total"));
  assert(functionBody.includes("'candidates', v_candidates"));
  assert(!/\bOFFSET\b/.test(functionBody));
  assert(!/\bLIMIT\s+\d+/i.test(functionBody));
  assert(!/\bINSERT\s+INTO\b/i.test(functionBody));
  assert(!/\bUPDATE\s+public\./i.test(functionBody));
  assert(!/\bDELETE\s+FROM\b/i.test(functionBody));
  assert(
    migration.includes('STABLE execution keeps Receipt authorization, exact count, and the complete JSON candidate array on the invoking statement snapshot'),
  );
});

Deno.test('AllocationService binds only AuthContext and route Receipt identity to the governed RPC', async () => {
  const client = new RpcOnlyClient(candidateResult());
  const service = new AllocationService(client as never);
  const result = await service.getAllocationCandidates(clerkAuth, receiptId);

  assertEquals(result.complete, true);
  assertEquals(result.total, 2);
  assertEquals(result.candidates[0].id, invoiceId1);
  assertEquals(result.candidates[1].doc_type, 'Debit Note');
  assertJsonEquals(client.calls, [{
    functionName: 'get_allocation_candidates',
    params: {
      p_receipt_id: receiptId,
      p_user_id: userId,
      p_company_id: companyId,
    },
  }]);
});

Deno.test('AllocationService rejects unauthorized roles before RPC and malformed partial contracts', async () => {
  const unauthorizedClient = new RpcOnlyClient(candidateResult());
  const unauthorized = new AllocationService(unauthorizedClient as never);
  let unauthorizedError: unknown;
  try {
    await unauthorized.getAllocationCandidates({
      ...clerkAuth,
      roles: ['Auditor'],
      highestRole: 'Auditor',
    }, receiptId);
  } catch (error) {
    unauthorizedError = error;
  }
  assert(unauthorizedError instanceof Error);
  assertEquals(unauthorizedClient.calls.length, 0);

  const partial = candidateResult(1) as unknown as Record<string, unknown>;
  partial.total = 2;
  const partialClient = new RpcOnlyClient(partial);
  let partialError: unknown;
  try {
    await new AllocationService(partialClient as never)
      .getAllocationCandidates(clerkAuth, receiptId);
  } catch (error) {
    partialError = error;
  }
  assert(partialError instanceof Error);
  assertEquals(
    partialError.message,
    'Allocation candidate RPC returned an invalid completeness contract.',
  );
});

Deno.test('Production allocations dispatcher exposes governed candidates and propagates AuthContext', async () => {
  const calls: Array<{ auth: AuthContext; id: string }> = [];
  const expected = candidateResult();
  const routeHandler = createAllocationHandler({
    authenticate: (req, requestedCompanyId) => {
      assertEquals(req.headers.get('Authorization'), 'Bearer allocation-contract-test-token');
      assertEquals(requestedCompanyId, companyId);
      return Promise.resolve(clerkAuth);
    },
    createService: () => ({
      getAllocationCandidates: (auth: AuthContext, id: string) => {
        calls.push({ auth, id });
        return Promise.resolve(expected);
      },
    } as unknown as AllocationService),
  });

  const response = await routeHandler(request(`/candidates?receipt_id=${receiptId}`));
  assertEquals(response.status, 200);
  const body = await responseJson(response);
  assertEquals(body.success, true);
  assertJsonEquals(body.data, expected);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].auth.userId, userId);
  assertEquals(calls[0].auth.companyId, companyId);
  assertEquals(calls[0].id, receiptId);
});

Deno.test('Candidate route requires authentication and validates the only accepted identifier', async () => {
  let serviceCreated = false;
  const unauthenticated = createAllocationHandler({
    authenticate: () => Promise.reject(new AuthenticationError('Authentication required')),
    createService: () => {
      serviceCreated = true;
      return {} as AllocationService;
    },
  });

  const unauthenticatedResponse = await unauthenticated(
    request(`/candidates?receipt_id=${receiptId}`),
  );
  assertEquals(unauthenticatedResponse.status, 401);
  assertEquals(serviceCreated, false);

  const calls: string[] = [];
  const handler = createAllocationHandler({
    authenticate: () => Promise.resolve(clerkAuth),
    createService: () => ({
      getAllocationCandidates: (_auth: AuthContext, id: string) => {
        calls.push(id);
        return Promise.resolve(candidateResult(0));
      },
    } as unknown as AllocationService),
  });

  for (const path of ['/candidates', '/candidates?receipt_id=not-a-uuid']) {
    const response = await handler(request(path));
    assertEquals(response.status, 400);
    assertEquals((await responseJson(response)).success, false);
  }
  assertEquals(calls.length, 0);
});

Deno.test('Candidate errors are explicit on overflow and sanitized on unknown database failure', async () => {
  const cases = [
    {
      message: 'NOT_FOUND: Receipt not found',
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      message: 'BR-ALLOC-CANDIDATES: Receipt is not eligible for allocation',
      status: 400,
      code: 'BR-ALLOC-CANDIDATES',
    },
    {
      message: 'BR-ALLOC-CANDIDATE-LIMIT: Eligible document count exceeds the supported allocation workbench limit',
      status: 400,
      code: 'BR-ALLOC-CANDIDATE-LIMIT',
    },
    {
      message: 'relation private_financial_table does not exist',
      status: 500,
      code: 'INTERNAL_ERROR',
    },
  ];

  for (const testCase of cases) {
    const client = new RpcOnlyClient(null, { message: testCase.message, code: 'P0001' });
    const handler = createAllocationHandler({
      authenticate: () => Promise.resolve(clerkAuth),
      createService: () => new AllocationService(client as never),
    });
    const response = await handler(request(`/candidates?receipt_id=${receiptId}`));
    assertEquals(response.status, testCase.status);
    const body = await responseJson(response);
    assertEquals((body.error as Record<string, unknown>).code, testCase.code);
    if (testCase.status === 500) {
      assert(!JSON.stringify(body).includes('private_financial_table'));
    }
  }
});

Deno.test('POST allocations auto remains disabled and cannot invoke candidate or mutation services', async () => {
  let serviceCallCount = 0;
  const handler = createAllocationHandler({
    authenticate: () => Promise.resolve(clerkAuth),
    createService: () => ({
      getAllocationCandidates: () => {
        serviceCallCount += 1;
        return Promise.resolve(candidateResult());
      },
      manualAllocate: () => {
        serviceCallCount += 1;
        return Promise.resolve([]);
      },
    } as unknown as AllocationService),
  });

  const response = await handler(request('/auto', 'POST'));
  assertEquals(response.status, 403);
  const body = await responseJson(response);
  assertEquals((body.error as Record<string, unknown>).code, 'AUTO_ALLOCATION_DISABLED');
  assertEquals(serviceCallCount, 0);
});

Deno.test('Migration 030 creates no mutation route, overload, policy, trigger, or table privilege change', async () => {
  const migration = await read('../../../database/030_batch_9d_d_allocation_candidate_snapshot.sql');
  const handler = await read('./allocations/index.ts');

  assertEquals((migration.match(/get_allocation_candidates\(/g) ?? []).length > 0, true);
  assert(!/CREATE\s+(TABLE|TRIGGER|POLICY)|ALTER\s+TABLE/i.test(migration));
  assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)\s+ON/i.test(migration));
  assert(handler.includes("AUTO_ALLOCATION_DISABLED"));
  assert(handler.includes("candidates:/^\\/candidates\\/?$/"));
  assert(!handler.includes("getAllocationCandidates(auth, receiptId, companyId"));
});

Deno.test('Service accepts a verified zero-candidate result and rejects values above the exact capacity', async () => {
  const zeroClient = new RpcOnlyClient(candidateResult(0));
  const zero = await new AllocationService(zeroClient as never)
    .getAllocationCandidates(clerkAuth, receiptId);
  assertEquals(zero.total, 0);
  assertJsonEquals(zero.candidates, []);
  assertEquals(zero.complete, true);

  const overCapacity = candidateResult(0) as unknown as Record<string, unknown>;
  overCapacity.total = ALLOCATION_CANDIDATE_MAX + 1;
  const overflowClient = new RpcOnlyClient(overCapacity);
  let overflowError: unknown;
  try {
    await new AllocationService(overflowClient as never)
      .getAllocationCandidates(clerkAuth, receiptId);
  } catch (error) {
    overflowError = error;
  }
  assert(overflowError instanceof Error);
  assertEquals(
    overflowError.message,
    'Allocation candidate RPC returned an invalid completeness contract.',
  );
});
