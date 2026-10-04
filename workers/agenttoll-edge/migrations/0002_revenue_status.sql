-- Settlement status per payment (docs/ADMIN_API.md RevenueEvent.status): `settled`, `pending`
-- (settlement_pending, still confirming) or `unconfirmed` (settle timed out after the content
-- was served; the payment may have landed, tx_signature is `unconfirmed:<hash>`).
-- The Worker also adds the column lazily, so local dev and tests need no migration step.
ALTER TABLE revenue_events ADD COLUMN status TEXT NOT NULL DEFAULT 'settled';
