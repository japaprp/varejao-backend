# Mercado Pago webhook configuration

The backend intentionally rejects Mercado Pago webhook notifications unless both values below are configured in the hosting environment:

- `MP_WEBHOOK_SECRET`: the signing secret generated for this application's webhook configuration in Mercado Pago.
- `MP_COLLECTOR_ID`: the numeric seller/collector account ID that must own the payment.

Keep both values in the hosting provider's encrypted environment/secret settings. Never commit them, paste them into issues, or expose them to the frontend. Do not reuse `MP_ACCESS_TOKEN` as the webhook secret.

Configure the Mercado Pago notification URL to the deployed backend's `POST /pagamento/webhook` endpoint. The notification must include the standard `data.id` query parameter and the `x-signature` and `x-request-id` headers. The backend validates the HMAC-SHA256 signature using Mercado Pago's documented manifest, retrieves the payment independently through the API, and checks:

- payment ID and external order reference;
- payment status before updating an order;
- BRL currency;
- order amount (one-cent rounding tolerance);
- expected collector account ID.

If either configuration value is absent, the endpoint returns HTTP 503 and does not change an order. Invalid signatures return HTTP 401. Do not disable these checks to restore webhook processing; configure the correct values first.

## Safe rollout checklist

1. Obtain the webhook signing secret from the Mercado Pago application settings.
2. Obtain the collector ID for the same Mercado Pago account that receives the payments.
3. Add both values as encrypted environment variables in the backend hosting service; do not expose them in frontend configuration.
4. Confirm the configured webhook URL and enable payment notifications.
5. Test with a Mercado Pago test payment before production traffic.
6. Confirm a valid notification changes only the matching order and that amount, currency, collector, and signature mismatches are rejected.

The repository does not contain production credentials and this change does not configure hosting secrets or deploy the service.
