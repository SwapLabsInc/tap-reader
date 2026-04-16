const { afterEach, beforeEach, describe, expect, it } = require("@jest/globals");

let fakeIo;
let serverFactoryMock;

beforeEach(() => {
  jest.resetModules();
  delete process.env.TAP_READER_API_KEY;

  fakeIo = {
    use: jest.fn(),
    on: jest.fn(),
    to: jest.fn(() => ({
      emit: jest.fn(),
    })),
  };

  serverFactoryMock = jest.fn(() => ({
    listen: jest.fn(() => fakeIo),
  }));

  jest.unstable_mockModule("config", () => ({
    default: {
      get(key) {
        if (key === "websocketPort") return 5095;
        if (key === "websocketCORS") return "*";
        return null;
      },
    },
  }));

  jest.unstable_mockModule("socket.io", () => ({
    Server: serverFactoryMock,
  }));
});

afterEach(() => {
  delete process.env.TAP_READER_API_KEY;
  jest.resetModules();
});

describe("WebsocketModule", () => {
  it("registers auth middleware when TAP_READER_API_KEY is set", async () => {
    process.env.TAP_READER_API_KEY = "secret-key";
    const { default: WebsocketModule } = await import("../src/WebsocketModule.mjs");

    new WebsocketModule({ tapProtocol: {} });

    expect(serverFactoryMock).toHaveBeenCalled();
    expect(fakeIo.use).toHaveBeenCalledTimes(1);

    const middleware = fakeIo.use.mock.calls[0][0];
    const next = jest.fn();
    middleware(
      {
        handshake: {
          auth: {
            apiKey: "secret-key",
          },
        },
      },
      next
    );

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects unauthorized websocket handshakes", async () => {
    process.env.TAP_READER_API_KEY = "secret-key";
    const { default: WebsocketModule } = await import("../src/WebsocketModule.mjs");

    new WebsocketModule({ tapProtocol: {} });

    const middleware = fakeIo.use.mock.calls[0][0];
    const next = jest.fn();
    middleware(
      {
        handshake: {
          auth: {},
          headers: {},
        },
      },
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe("unauthorized");
  });
});
