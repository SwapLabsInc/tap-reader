const { describe, expect, it } = require("@jest/globals");

describe("ApiKeyAuth helpers", () => {
  it("reads API keys from REST-style headers", async () => {
    const { getSuppliedApiKeyFromHeaders } = await import("../src/ApiKeyAuth.mjs");

    expect(
      getSuppliedApiKeyFromHeaders({
        "x-api-key": "secret-key",
      })
    ).toBe("secret-key");

    expect(
      getSuppliedApiKeyFromHeaders({
        authorization: "Bearer bearer-key",
      })
    ).toBe("bearer-key");

    expect(
      getSuppliedApiKeyFromHeaders({
        authorization: "bearer lowercase-key",
      })
    ).toBe("lowercase-key");
  });

  it("reads API keys from socket auth payloads", async () => {
    const { getSuppliedApiKeyFromSocket } = await import("../src/ApiKeyAuth.mjs");

    expect(
      getSuppliedApiKeyFromSocket({
        handshake: {
          auth: {
            apiKey: "secret-key",
          },
        },
      })
    ).toBe("secret-key");

    expect(
      getSuppliedApiKeyFromSocket({
        handshake: {
          auth: {
            token: "Bearer bearer-key",
          },
        },
      })
    ).toBe("bearer-key");

    expect(
      getSuppliedApiKeyFromSocket({
        handshake: {
          auth: {
            token: "bearer lowercase-key",
          },
        },
      })
    ).toBe("lowercase-key");
  });

  it("falls back to socket handshake headers", async () => {
    const { getSuppliedApiKeyFromSocket } = await import("../src/ApiKeyAuth.mjs");

    expect(
      getSuppliedApiKeyFromSocket({
        handshake: {
          headers: {
            "x-api-key": "secret-key",
          },
        },
      })
    ).toBe("secret-key");
  });
});
