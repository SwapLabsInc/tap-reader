const { afterEach, beforeEach, describe, expect, it } = require("@jest/globals");

beforeEach(() => {
  jest.useRealTimers();
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
  jest.resetModules();
});

describe("TapProtocol hot path deadlines", () => {
  it("times out transferAmountByInscription when Hyperbee reads hang", async () => {
    jest.useFakeTimers();
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const tapProtocol = new TapProtocol({
      bee: {
        get: jest.fn(() => new Promise(() => {})),
      },
    });

    const pending = expect(
      tapProtocol.getTransferAmountByInscription("inscription-1")
    ).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await jest.advanceTimersByTimeAsync(2_000);
    await pending;
  });

  it("times out accountTransferListLength when the list length read hangs", async () => {
    jest.useFakeTimers();
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const tapProtocol = new TapProtocol({
      bee: {
        get: jest.fn(() => new Promise(() => {})),
      },
    });

    const pending = expect(
      tapProtocol.getAccountTransferListLength("bc1qaddress", "tap")
    ).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await jest.advanceTimersByTimeAsync(2_000);
    await pending;
  });

  it("fails accountTransferList when an indexed entry is missing", async () => {
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const tapProtocol = new TapProtocol({
      bee: {
        async get(key) {
          if (key === 'atrl/bc1qaddress/"tap"') {
            return { value: "2" };
          }

          if (key === 'atrli/bc1qaddress/"tap"/0') {
            return { value: JSON.stringify({ txid: "abc" }) };
          }

          if (key === 'atrli/bc1qaddress/"tap"/1') {
            return null;
          }

          throw new Error(`Unexpected key: ${key}`);
        },
      },
    });

    await expect(
      tapProtocol.getAccountTransferList("bc1qaddress", "tap", 0, 10)
    ).rejects.toMatchObject({
      code: "LIST_ENTRY_MISSING",
    });
  });

  it("does not apply the hot-path timeout to unrelated shared list helpers", async () => {
    jest.useFakeTimers();
    const { default: TapProtocol } = await import("../src/TapProtocol.mjs");
    const tapProtocol = new TapProtocol({
      bee: {
        get: jest.fn(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve({ value: "7" });
              }, 2_500);
            })
        ),
      },
    });

    const pending = tapProtocol.getDeploymentsLength();
    await jest.advanceTimersByTimeAsync(2_500);

    await expect(pending).resolves.toBe(7);
  });
});
