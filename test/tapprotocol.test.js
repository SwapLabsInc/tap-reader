const { describe, expect, it } = require("@jest/globals");

describe("TapProtocol locally available reads", () => {
  it("reads the current block from the no-wait bee", async () => {
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const tapProtocol = new TapProtocol({
      noWaitBee: {
        async get(key) {
          expect(key).toBe("block");
          return { value: "123" };
        },
      },
      bee: {
        async get() {
          throw new Error("bee.get should not be used");
        },
      },
    });

    await expect(tapProtocol.getCurrentBlock()).resolves.toBe(123);
  });

  it("returns null when a local-only read is not available yet", async () => {
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const tapProtocol = new TapProtocol({
      noWaitBee: {
        async get() {
          const error = new Error("missing block");
          error.code = "BLOCK_NOT_AVAILABLE";
          throw error;
        },
      },
    });

    await expect(tapProtocol.getReorgs()).resolves.toBeNull();
  });

  it("rethrows unexpected local read failures", async () => {
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const error = new Error("boom");
    const tapProtocol = new TapProtocol({
      noWaitBee: {
        async get() {
          throw error;
        },
      },
    });

    await expect(tapProtocol.getCurrentBlock()).rejects.toBe(error);
  });
});
