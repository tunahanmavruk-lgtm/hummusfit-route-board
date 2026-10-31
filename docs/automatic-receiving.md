# Automatic Receiving — 2026-10-13

This release restores the existing Flow proof callbacks and provides signed-service food correction processing for exactly the 14 POS stores. No picking, fulfillment, warehouse inventory, customer or B2B changes are made here.

## Safety contract

- Only new staff-submitted reports carrying `receiving-auto-2026-10-13-v1` and submitted after 2026-10-13 20:21:19 UTC are eligible. Existing historical reports are NOT enqueued or replayed.
- The exact fully fulfilled Shopify order, unique destination and successful Shipping Warehouse fulfillment must match.
- Original per-line Shopify Flow credits are independently re-read before food corrections. The two existing callback URLs accept the existing `x-hf-flow-credit-secret`; they record proof only.
- A shortage or overage changes only the destination's available inventory by received minus originally credited quantity. Wrong/extra food requires a scanned, uniquely matched product and exact quantity. Unknown/typed items remain review-only.
- Positive deltas above 10 units require manual physical-count confirmation. Duplicate reports/count amendments, mixed source locations, merged/ambiguous order lines and catalog classification conflicts also require review.
- Shopify's idempotency key and compare-and-swap protect each persisted mutation plan. A lost response retries identical input/key for at most one hour. Only explicit `CHANGE_FROM_QUANTITY_STALE` rejection permits a fresh attempt (at most four). Never delete or reset `automatic-receiving-v1.json` to force a retry.
- Other Essentials never receive POS adjustments. Retail case conversion retains its existing separate ledger and rules; unresolved retail shortages/mapping problems still require review.

## Operations

Keep one process/replica per service and `/data` mounted. Do not autoscale this JSON-ledger implementation without moving its locks/transactions to a shared database.

The Receiving service saves its queue in each report, starts work immediately after confirmation, and retries every 30 seconds to five minutes for up to 24 hours. It independently verifies returned Shopify adjustment groups before adding Agent Hazar proof. A saved report is not necessarily a posted inventory adjustment.

`RECEIVING_AUTOMATION_ENABLED=false` pauses correction execution without deleting queue/ledger data. The read-only `/api/receiving-automation-health` identifies the release. Failed jobs retain their reasons on reports.

For exact fulfilled Retail Essentials cases, the fulfillment callback may activate a missing destination case inventory level at zero before posting its idempotent case credit. An ACTIVE product with the `Retail Essentials - Case` type and `retail-essentials` tag qualifies even when its new flavor has no case-to-unit mapping yet. An existing mapping with a changed variant ID remains blocked for review. A missing mapping still blocks sell-unit conversion; this case-credit rule does not authorize a conversion or infer a store receipt.

Deploy from the current GitHub main source, not older local copies. Preserve `store-flow-credit-proofs.json`, `holbrook-flow-credit-proofs.json`, `automatic-receiving-v1.json`, `essentials-pos-receipts.json`, archives and all picking state. Take a volume/source backup before releases. After deployment verify release hashes, auth rejection, health, retained report counts, and then the first real staff-confirmed receipt's exact Shopify group. Never create a fake production receipt or synthetic stock adjustment for smoke testing.

Shopify inventory/CAS reference: https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/manage-quantities-states
