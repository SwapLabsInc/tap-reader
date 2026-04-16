const { afterEach, beforeEach, describe, expect, it } = require("@jest/globals");

let fakeIo;
let serverFactoryMock;
let ioHandlers;
let emitSpy;

beforeEach(() => {
  jest.useRealTimers();
  jest.resetModules();
  delete process.env.TRAC_API_KEY;
  delete process.env.TAP_READER_API_KEY;
  ioHandlers = new Map();
  emitSpy = jest.fn();

  fakeIo = {
    engine: {
      clientsCount: 0,
    },
    use: jest.fn(),
    on: jest.fn((event, handler) => {
      ioHandlers.set(event, handler);
    }),
    to: jest.fn((socketId) => ({
      emit(event, payload) {
        emitSpy(socketId, event, payload);
      },
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

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.TRAC_API_KEY;
  delete process.env.TAP_READER_API_KEY;
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.resetModules();
});

async function buildWebsocketModule(tracManager = {}) {
  const { default: WebsocketModule } = await import("../src/WebsocketModule.mjs");
  const websocketModule = new WebsocketModule({
    peerConnectionCount: 0,
    tapProtocol: {},
    ...tracManager,
  });

  return {
    websocketModule,
    connectionHandler: ioHandlers.get("connection"),
  };
}

function connectSocket(connectionHandler, socketId = "socket-1") {
  const socketHandlers = new Map();
  const socket = {
    id: socketId,
    on: jest.fn((event, handler) => {
      socketHandlers.set(event, handler);
    }),
  };

  connectionHandler(socket);

  return {
    socket,
    getHandler(event) {
      return socketHandlers.get(event);
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe("WebsocketModule", () => {
  it("registers auth middleware when TRAC_API_KEY is set", async () => {
    process.env.TRAC_API_KEY = "secret-key";
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
    process.env.TRAC_API_KEY = "secret-key";
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

  it("emits a response payload for invalid websocket commands", async () => {
    const { connectionHandler } = await buildWebsocketModule();
    const { getHandler } = connectSocket(connectionHandler);

    await getHandler("get")({
      call_id: "call-1",
      func: "transferAmountByInscription",
      args: [],
    });

    expect(emitSpy).toHaveBeenCalledWith("socket-1", "error", {
      error: "invalid command",
      code: "INVALID_COMMAND",
      cmd: {
        call_id: "call-1",
        func: "transferAmountByInscription",
        args: [],
      },
    });
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "response",
      expect.objectContaining({
        call_id: "call-1",
        func: "transferAmountByInscription",
        error: "invalid command",
        code: "INVALID_COMMAND",
        result: null,
      })
    );
  });

  it("emits a timeout response when a websocket request hangs", async () => {
    jest.useFakeTimers();
    const { connectionHandler } = await buildWebsocketModule({
      tapProtocol: {
        getTransferAmountByInscription: jest.fn(() => new Promise(() => {})),
      },
    });
    const { getHandler } = connectSocket(connectionHandler);

    const pending = getHandler("get")({
      call_id: "call-2",
      func: "transferAmountByInscription",
      args: ["inscription-1"],
    });

    await jest.advanceTimersByTimeAsync(8_000);
    await pending;

    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "error",
      expect.objectContaining({
        error: "Request timed out for transferAmountByInscription",
        code: "REQUEST_TIMEOUT",
      })
    );
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "response",
      expect.objectContaining({
        call_id: "call-2",
        func: "transferAmountByInscription",
        error: "Request timed out for transferAmountByInscription",
        code: "REQUEST_TIMEOUT",
        result: null,
      })
    );
  });

  it("rejects overloaded transferAmountByInscription requests with a response error", async () => {
    const tapProtocol = {
      getTransferAmountByInscription: jest.fn(),
    };
    const { websocketModule, connectionHandler } = await buildWebsocketModule({
      tapProtocol,
    });
    const gate = websocketModule.requestGates.get("transferAmountByInscription");
    gate.maxActive = 1;
    gate.maxQueued = 0;
    gate.active = 1;

    const { getHandler } = connectSocket(connectionHandler);
    await getHandler("get")({
      call_id: "call-3",
      func: "transferAmountByInscription",
      args: ["inscription-2"],
    });

    expect(tapProtocol.getTransferAmountByInscription).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "error",
      expect.objectContaining({
        error: "transferAmountByInscription queue is full",
        code: "SERVER_BUSY",
      })
    );
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "response",
      expect.objectContaining({
        call_id: "call-3",
        func: "transferAmountByInscription",
        error: "transferAmountByInscription queue is full",
        code: "SERVER_BUSY",
        result: null,
      })
    );
  });

  it("keeps timed out work counted against the gate until the underlying read settles", async () => {
    jest.useFakeTimers();
    const firstRequest = createDeferred();
    const tapProtocol = {
      getTransferAmountByInscription: jest
        .fn()
        .mockImplementationOnce(() => firstRequest.promise),
    };
    const { websocketModule, connectionHandler } = await buildWebsocketModule({
      tapProtocol,
    });
    const gate = websocketModule.requestGates.get("transferAmountByInscription");
    gate.maxActive = 1;
    gate.maxQueued = 1;

    const { getHandler } = connectSocket(connectionHandler);
    const firstPending = getHandler("get")({
      call_id: "call-4",
      func: "transferAmountByInscription",
      args: ["inscription-4"],
    });
    const secondPending = getHandler("get")({
      call_id: "call-5",
      func: "transferAmountByInscription",
      args: ["inscription-5"],
    });

    await jest.advanceTimersByTimeAsync(8_000);
    await Promise.all([firstPending, secondPending]);

    expect(tapProtocol.getTransferAmountByInscription).toHaveBeenCalledTimes(1);
    expect(gate.active).toBe(1);
    expect(gate.getSnapshot().queued).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "response",
      expect.objectContaining({
        call_id: "call-4",
        code: "REQUEST_TIMEOUT",
      })
    );
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "response",
      expect.objectContaining({
        call_id: "call-5",
        code: "REQUEST_TIMEOUT",
      })
    );

    firstRequest.resolve("123");
    await jest.advanceTimersByTimeAsync(0);

    expect(gate.active).toBe(0);
  });

  it("keeps request state isolated when two sockets reuse the same call_id", async () => {
    const firstRequest = createDeferred();
    const tapProtocol = {
      getTransferAmountByInscription: jest
        .fn()
        .mockImplementationOnce(() => firstRequest.promise),
    };
    const { connectionHandler } = await buildWebsocketModule({
      tapProtocol,
    });
    const firstSocket = connectSocket(connectionHandler, "socket-1");
    const secondSocket = connectSocket(connectionHandler, "socket-2");

    const firstPending = firstSocket.getHandler("get")({
      call_id: "shared-call-id",
      func: "transferAmountByInscription",
      args: ["inscription-6"],
    });
    const secondPending = secondSocket.getHandler("get")({
      call_id: "shared-call-id",
      func: "transferAmountByInscription",
      args: [],
    });

    await secondPending;
    firstRequest.resolve("123");
    await firstPending;

    expect(emitSpy).toHaveBeenCalledWith(
      "socket-2",
      "response",
      expect.objectContaining({
        call_id: "shared-call-id",
        error: "invalid command",
        code: "INVALID_COMMAND",
      })
    );
    expect(emitSpy).toHaveBeenCalledWith(
      "socket-1",
      "response",
      expect.objectContaining({
        call_id: "shared-call-id",
        error: "",
        result: "123",
      })
    );
  });
});
