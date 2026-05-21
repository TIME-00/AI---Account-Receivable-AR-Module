# P1 Production Smoke Test Summary

## Scope Tested

P1 production smoke testing covered the core financial API flows after deployment:

- Post invoice
- Post receipt
- Manual receipt allocation
- Reverse allocation
- Cancel invoice
- Handle bounced cheque
- Cleanup of temporary production diagnostic logs

## Final Verified Database States

The following production smoke records were verified after test execution:

| Record | Final state |
| --- | --- |
| `PROD-SMOKE-BI-B70973` invoice | `Open`, `total_amount = 1.00`, `outstanding = 1.00` after bounced cheque |
| `PROD-SMOKE-BR-B70973` receipt | `Bounced`, `receipt_amount = 1.00`, `allocated_amount = 0.00`, `unallocated_amount = 0.00` |
| `PROD-SMOKE-I-2D7E23` invoice | `Cancelled`, `outstanding = 0.00` |
| `PROD-SMOKE-R-2D7E23` receipt | `Posted`, `allocated_amount = 0.00`, `unallocated_amount = 1.00` after reverse allocation |

## Diagnostic Cleanup

Temporary production diagnostic logs added during smoke-test debugging were removed after verification. Application authorization logic, RPC behavior, and database logic were not changed as part of this documentation update.

## Result

P1 production smoke testing passed for the tested financial flows.
