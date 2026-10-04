const test = require("node:test");
const assert = require("node:assert/strict");
const { createPosTokenProvider } = require("../shopify-pos-auth");

test("requests a scoped client-credentials token, caches it, and refreshes before expiry", async () => {
  let clock = 1000;
  const calls = [];
  const getToken = createPosTokenProvider({
    shop: "myhummusfit.myshopify.com", clientId: "id", clientSecret: "secret", now: () => clock,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({
        access_token: `token-${calls.length}`,
        scope: "read_locations,read_products,read_inventory,write_inventory",
        expires_in: 3600,
      }) };
    },
  });
  assert.equal(await getToken(), "token-1");
  assert.equal(await getToken(), "token-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://myhummusfit.myshopify.com/admin/oauth/access_token");
  assert.equal(calls[0].options.body.get("grant_type"), "client_credentials");
  clock += 3_540_001;
  assert.equal(await getToken(), "token-2");
  assert.equal(calls.length, 2);
});

test("fails closed when credentials or inventory scopes are missing", async () => {
  await assert.rejects(createPosTokenProvider({ shop: "store", clientId: "", clientSecret: "secret" })(), /not configured/);
  const getToken = createPosTokenProvider({
    shop: "store", clientId: "id", clientSecret: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: "token", scope: "read_products", expires_in: 3600 }) }),
  });
  await assert.rejects(getToken(), /missing required inventory permissions/);
});

test("accepts Shopify's implicit read_inventory grant from write_inventory", async () => {
  const getToken = createPosTokenProvider({
    shop: "store", clientId: "id", clientSecret: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => ({
      access_token: "token",
      // This is the scope string Shopify returned for the installed POS app.
      scope: "read_locations,read_products,write_inventory",
      expires_in: 3600,
    }) }),
  });
  assert.equal(await getToken(), "token");
});
