// Shopify Dev Dashboard apps in the same organization use a client-credentials
// grant. The access token expires after 24 hours; never persist it or the
// client secret in the receipt ledger, logs, or source control.
const REQUIRED_SCOPES = ["read_locations", "read_products", "read_inventory", "write_inventory"];

function createPosTokenProvider({ shop, clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
  let cachedToken = "";
  let expiresAt = 0;
  let pending = null;
  return async function getPosToken() {
    if (!shop || !clientId || !clientSecret) throw new Error("Dedicated POS inventory credentials are not configured");
    if (cachedToken && now() < expiresAt - 60_000) return cachedToken;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
      });
      if (!response.ok) throw new Error(`Shopify POS token request failed (${response.status})`);
      const result = await response.json();
      const granted = new Set(String(result.scope || "").split(",").map((scope) => scope.trim()));
      // Shopify can omit an implied read scope from the token response when
      // its write counterpart is granted (for example, write_inventory
      // includes read_inventory). The effective installation scopes and
      // inventory query still include the read permission.
      const hasScope = (scope) => granted.has(scope) ||
        (scope.startsWith("read_") && granted.has(`write_${scope.slice(5)}`));
      if (!result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 60 ||
          REQUIRED_SCOPES.some((scope) => !hasScope(scope))) {
        throw new Error("Dedicated POS app token is missing required inventory permissions");
      }
      cachedToken = result.access_token;
      expiresAt = now() + result.expires_in * 1000;
      return cachedToken;
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}

module.exports = { createPosTokenProvider, REQUIRED_SCOPES };
