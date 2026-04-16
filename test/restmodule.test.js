const { afterEach, beforeEach, describe, expect, it } = require("@jest/globals");

const configValues = {
  enableRestSSL: false,
  enableRestApiDocs: false,
  restCacheControl: {
    maxAge: 1,
    public: false,
  },
  restHeaders: [],
  host: "127.0.0.1",
  restPort: 5099,
};

beforeEach(() => {
  jest.resetModules();
  jest.unstable_mockModule("config", () => ({
    default: {
      get(key) {
        return configValues[key];
      },
    },
  }));
});

async function buildRestModule() {
  const { default: RestModule } = await import("../src/RestModule.mjs");
  const restModule = new RestModule({
    blockDownloader: null,
    tapProtocol: {
      async getCurrentBlock() {
        return 123;
      },
      async getReorgs() {
        return ["reorg"];
      },
    },
  });

  await restModule.fastify.ready();
  return restModule;
}

afterEach(() => {
  delete process.env.TAP_READER_API_KEY;
  jest.resetModules();
});

describe("RestModule", () => {
  it("allows unauthenticated health checks when an API key is configured", async () => {
    process.env.TAP_READER_API_KEY = "secret-key";
    const restModule = await buildRestModule();

    const response = await restModule.fastify.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await restModule.fastify.close();
  });

  it("rejects protected routes without an API key", async () => {
    process.env.TAP_READER_API_KEY = "secret-key";
    const restModule = await buildRestModule();

    const response = await restModule.fastify.inject({
      method: "GET",
      url: "/getCurrentBlock",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized", result: null });

    await restModule.fastify.close();
  });

  it("accepts x-api-key authentication for protected routes", async () => {
    process.env.TAP_READER_API_KEY = "secret-key";
    const restModule = await buildRestModule();

    const response = await restModule.fastify.inject({
      method: "GET",
      url: "/getCurrentBlock",
      headers: {
        "x-api-key": "secret-key",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 123 });

    await restModule.fastify.close();
  });

  it("accepts bearer authentication for protected routes", async () => {
    process.env.TAP_READER_API_KEY = "secret-key";
    const restModule = await buildRestModule();

    const response = await restModule.fastify.inject({
      method: "GET",
      url: "/getCurrentBlock",
      headers: {
        authorization: "Bearer secret-key",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 123 });

    await restModule.fastify.close();
  });
});
