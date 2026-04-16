import { createServer } from "http";
import { Server } from "socket.io";
import config from "config";
import {
  apiKeysMatch,
  getSuppliedApiKeyFromSocket,
} from "./ApiKeyAuth.mjs";
import { TimeoutError, withTimeout } from "./AsyncUtils.mjs";
import ConcurrencyGate from "./ConcurrencyGate.mjs";
import RequestMonitor from "./RequestMonitor.mjs";

const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_CONTEXT_KEY = Symbol("requestContextKey");
const TRANSFER_AMOUNT_GATE = {
  maxActive: 64,
  maxQueued: 512,
};
const TRANSFER_LIST_GATE = {
  maxActive: 8,
  maxQueued: 128,
};

export default class WebsocketModule {
  /**
   * Creates an instance of WebsocketModule for Trac Core
   * @param {Object} tracManager - An object managing Trac Core.
   */
  constructor(tracManager) {
    this.tracManager = tracManager;
    this.apiKey = (process.env.TRAC_API_KEY || process.env.TAP_READER_API_KEY || "").trim();
    this.requestContextCounter = 0;
    this.requestContexts = new Map();
    this.requestGates = new Map([
      [
        "transferAmountByInscription",
        new ConcurrencyGate(
          "transferAmountByInscription",
          TRANSFER_AMOUNT_GATE.maxActive,
          TRANSFER_AMOUNT_GATE.maxQueued
        ),
      ],
      [
        "accountTransferList",
        new ConcurrencyGate(
          "accountTransferList",
          TRANSFER_LIST_GATE.maxActive,
          TRANSFER_LIST_GATE.maxQueued
        ),
      ],
      [
        "accountTransferListLength",
        new ConcurrencyGate(
          "accountTransferListLength",
          TRANSFER_LIST_GATE.maxActive,
          TRANSFER_LIST_GATE.maxQueued
        ),
      ],
    ]);

    this.socket_port = config.get("websocketPort");
    this.httpServer = createServer();
    this.httpServer.maxConnections = 1000;

    console.log("Starting socket.io");
    this.io = new Server(this.httpServer, {
      cors: {
        origin: config.get("websocketCORS"),
      },
    }).listen(this.socket_port);
    this.requestMonitor = new RequestMonitor("tap-reader", () => ({
      socketCount: this.io?.engine?.clientsCount ?? 0,
      peerCount: this.tracManager.peerConnectionCount ?? 0,
      gates: [...this.requestGates.entries()].map(([func, gate]) => ({
        func,
        ...gate.getSnapshot(),
      })),
    }));

    if (this.apiKey.length > 0) {
      this.io.use((socket, next) => {
        const suppliedApiKey = getSuppliedApiKeyFromSocket(socket);
        if (!apiKeysMatch(this.apiKey, suppliedApiKey)) {
          next(new Error("unauthorized"));
          return;
        }

        next();
      });
    }

    this.io.on("connection", (socket) => {
      socket.on("get", async (cmd) => {
        if (!this.validCmd(cmd, socket)) return;
        const context = this.requestMonitor.start(cmd.func, {
          callId: cmd.call_id,
          socketId: socket.id,
        });
        cmd[REQUEST_CONTEXT_KEY] = this.nextRequestContextKey(socket);
        this.requestContexts.set(cmd[REQUEST_CONTEXT_KEY], context);
        let requestError = null;

        try {
          const result = await this.runCommandWithControls(cmd, async () => {
            let result = null;

            switch (cmd.func) {

            case "transferredListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTransferredListLength(
                  cmd.args[0]
              );
              break;

            case "transferredList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTransferredList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "tickerTransferredListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerTransferredListLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerTransferredList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerTransferredList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "tickerTransferredListByBlockLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerTransferredListByBlockLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerTransferredListByBlock":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerTransferredListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "transferredListByBlockLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTransferredListByBlockLength(
                  cmd.args[0]
              );
              break;

            case "transferredListByBlock":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTransferredListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "mintedListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintedListLength(
                  cmd.args[0]
              );
              break;

            case "mintedList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintedList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "tickerMintedListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerMintedListLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerMintedList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerMintedList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "tickerMintedListByBlockLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerMintedListByBlockLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerMintedListByBlock":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerMintedListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "mintedListByBlockLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintedListByBlockLength(
                  cmd.args[0]
              );
              break;

            case "mintedListByBlock":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintedListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "deployedListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDeployedListLength(
                  cmd.args[0]
              );
              break;

            case "deployedList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDeployedList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "tickerDeployedListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerDeployedListLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerDeployedList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerDeployedList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "tickerDeployedListByBlockLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerDeployedListByBlockLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerDeployedListByBlock":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerDeployedListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "deployedListByBlockLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDeployedListByBlockLength(
                  cmd.args[0]
              );
              break;

            case "deployedListByBlock":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDeployedListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "getInscribeTransferListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getInscribeTransferListLength(
                  cmd.args[0]
              );
              break;

            case "inscribeTransferList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getInscribeTransferList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "tickerInscribeTransferListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerInscribeTransferListLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerInscribeTransferList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerInscribeTransferList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "tickerInscribeTransferListByBlockLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerInscribeTransferListByBlockLength(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "tickerInscribeTransferListByBlock":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerInscribeTransferListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;

            case "inscribeTransferListByBlockLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getInscribeTransferListByBlockLength(
                  cmd.args[0]
              );
              break;

            case "inscribeTransferListByBlock":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getInscribeTransferListByBlock(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;


            case "dmtMintHolder":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtMintHolder(
                  cmd.args[0]
              );
              break;

            case "dmtMintHolderByBlock":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtMintHolderByBlock(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;

            case "reorgs":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                  await this.tracManager.tapProtocol.getReorgs();
              break;

            case "currentBlock":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                  await this.tracManager.tapProtocol.getCurrentBlock();
              break;
  
            case "dmtMintHoldersHistoryListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtMintHoldersHistoryListLength(
                  cmd.args[0]
              );
              break;

            case "dmtMintHoldersHistoryList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtMintHoldersHistoryList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;

            case "dmtMintWalletHistoricListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtMintWalletHistoricListLength(
                  cmd.args[0]
              );
              break;

            case "dmtMintWalletHistoricList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtMintWalletHistoricList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;


            case "deployments":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDeployments(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "deployment":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDeployment(
                cmd.args[0]
              );
              break;
            case "deploymentsLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getDeploymentsLength();
              break;
            case "mintTokensLeft":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintTokensLeft(
                cmd.args[0]
              );
              break;
            case "balance":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getBalance(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "transferable":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTransferable(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "holdersLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getHoldersLength(
                cmd.args[0]
              );
              break;
            case "holders":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getHolders(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "accountTokensLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountTokensLength(
                  cmd.args[0]
                );
              break;
            case "accountTokens":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountTokens(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "accountMintList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountMintList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2],
                cmd.args[3]
              );
              break;
            case "accountMintListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountMintListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "tickerMintList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerMintList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "tickerMintListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTickerMintListLength(
                  cmd.args[0]
                );
              break;
            case "mintList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "mintListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getMintListLength();
              break;
            case "accountTransferList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountTransferList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
                );
              break;
            case "accountTransferListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountTransferListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "tickerTransferList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerTransferList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "tickerTransferListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTickerTransferListLength(
                  cmd.args[0]
                );
              break;
            case "transferList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTransferList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "transferListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTransferListLength();
              break;
            case "accountSentList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountSentList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2],
                cmd.args[3]
              );
              break;
            case "accountSentListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountSentListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "tickerSentList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerSentList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "tickerSentListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTickerSentListLength(
                  cmd.args[0]
                );
              break;
            case "sentList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getSentList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "sentListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getSentListLength();
              break;
            case "accountReceiveList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountReceiveList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2],
                cmd.args[3]
              );
              break;
            case "accountReceiveListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountReceiveListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "accumulator":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccumulator(
                cmd.args[0]
              );
              break;
            case "accountAccumulatorList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountAccumulatorList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
                );
              break;
            case "accountAccumulatorListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountAccumulatorListLength(
                  cmd.args[0]
                );
              break;
            case "accumulatorList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccumulatorList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "getAccumulatorListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccumulatorListLength();
              break;
            case "accountTradesList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountTradesList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2],
                cmd.args[3]
              );
              break;
            case "accountTradesListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountTradesListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "tickerTradesList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTickerTradesList(
                cmd.args[0],
                cmd.args[2],
                cmd.args[3]
              );
              break;
            case "tickerTradesListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTickerTradesListLength(
                  cmd.args[0]
                );
              break;
            case "tradesList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTradesList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "tradesListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTradesListLength();
              break;
            case "accountReceiveTradesFilledList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountReceiveTradesFilledList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
                );
              break;
            case "accountReceiveTradesFilledListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountReceiveTradesFilledListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "accountTradesFilledList":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountTradesFilledList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
                );
              break;
            case "accountTradesFilledListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountTradesFilledListLength(
                  cmd.args[0],
                  cmd.args[1]
                );
              break;
            case "tickerTradesFilledList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTickerTradesFilledList(
                  cmd.args[0],
                  cmd.args[2],
                  cmd.args[3]
                );
              break;
            case "tickerTradesFilledListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTickerTradesFilledListLength(
                  cmd.args[0]
                );
              break;
            case "tradesFilledList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTradesFilledList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "tradesFilledListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTradesFilledListLength();
              break;
            case "trade":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getTrade(cmd.args[0]);
              break;
            case "privilegeAuthIsVerified":
              if (cmd.args.length != 4) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                  await this.tracManager.tapProtocol.getPrivilegeAuthIsVerified(
                      cmd.args[0],
                      cmd.args[1],
                      cmd.args[2],
                      cmd.args[3]
                  );
              break;
            case "privilegeAuthorityListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                  await this.tracManager.tapProtocol.getPrivilegeAuthorityListLength(
                      cmd.args[0]
                  );
              break;
            case "privilegeAuthorityList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getPrivilegeAuthorityList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;
            case "privilegeAuthorityCollectionListLength":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                  await this.tracManager.tapProtocol.getPrivilegeAuthorityCollectionListLength(
                      cmd.args[0],
                      cmd.args[1]
                  );
              break;
            case "privilegeAuthorityCollectionList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getPrivilegeAuthorityCollectionList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2],
                  cmd.args[3]
              );
              break;
            case "accountAuthList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountAuthList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "accountPrivilegeAuthList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountPrivilegeAuthList(
                  cmd.args[0],
                  cmd.args[1],
                  cmd.args[2]
              );
              break;
            case "accountAuthListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountAuthListLength(
                  cmd.args[0]
                );
              break;
            case "accountPrivilegeAuthListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                  await this.tracManager.tapProtocol.getAccountPrivilegeAuthListLength(
                      cmd.args[0]
                  );
              break;
            case "authList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAuthList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "privilegeAuthList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getPrivilegeAuthList(
                  cmd.args[0],
                  cmd.args[1]
              );
              break;
            case "authListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAuthListLength();
              break;
            case "privilegeAuthListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getPrivilegeAuthListLength();
              break;
            case "accountRedeemList":
              if (cmd.args.length != 3) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAccountRedeemList(
                cmd.args[0],
                cmd.args[1],
                cmd.args[2]
              );
              break;
            case "accountRedeemListLength":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getAccountRedeemListLength(
                  cmd.args[0]
                );
              break;
            case "redeemList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getRedeemList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "redeemListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getRedeemListLength();
              break;
            case "authHashExists":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAuthHashExists(
                cmd.args[0]
              );
              break;
            case "privilegeAuthHashExists":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getPrivilegeAuthHashExists(
                  cmd.args[0]
              );
              break;
            case "authCancelled":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getAuthCancelled(
                cmd.args[0]
              );
              break;
            case "privilegeAuthCancelled":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getPrivilegeAuthCancelled(
                  cmd.args[0]
              );
              break;
            case "dmtElementsList":
              if (cmd.args.length != 2) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result = await this.tracManager.tapProtocol.getDmtElementsList(
                cmd.args[0],
                cmd.args[1]
              );
              break;
            case "dmtElementsListLength":
              if (cmd.args.length != 0) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getDmtElementsListLength();
              break;
            case "transferAmountByInscription":
              if (cmd.args.length != 1) {
                this.invalidCmd(cmd, socket);
                return;
              }
              result =
                await this.tracManager.tapProtocol.getTransferAmountByInscription(
                  cmd.args[0]
                );
              break;
            default:
              this.invalidCmd(cmd, socket);
              return;
            }

            return result;
          });

          if (!context.responseSent) {
            this.sendSuccessResponse(socket, cmd, result, context);
          }
        } catch (error) {
          requestError = error;

          if (!context.responseSent) {
            this.sendErrorResponse(socket, cmd, error, context);
          }
        } finally {
          this.requestContexts.delete(cmd[REQUEST_CONTEXT_KEY]);
          delete cmd[REQUEST_CONTEXT_KEY];
          this.requestMonitor.finish(context, context.status, requestError ?? context.error);
        }
      });
    });
  }
  nextRequestContextKey(socket) {
    this.requestContextCounter += 1;
    return `${socket.id}:${this.requestContextCounter}`;
  }
  async runCommandWithControls(cmd, task) {
    const deadlineAt = Date.now() + REQUEST_TIMEOUT_MS;
    const gate = this.requestGates.get(cmd.func);

    if (gate === undefined) {
      return await this.runWithDeadline(cmd, task, deadlineAt);
    }

    const release = await gate.acquire({ maxWaitMs: REQUEST_TIMEOUT_MS });
    return await this.runWithDeadline(cmd, task, deadlineAt, release);
  }

  async runWithDeadline(cmd, task, deadlineAt, release = null) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      release?.();
      throw new TimeoutError(`Request timed out for ${cmd.func}`, REQUEST_TIMEOUT_MS, {
        callId: cmd.call_id,
        func: cmd.func,
      });
    }

    let activeRelease = release;
    const releaseOnce = () => {
      if (activeRelease !== null) {
        activeRelease();
        activeRelease = null;
      }
    };

    const operationPromise = Promise.resolve().then(task);
    operationPromise.then(
      () => {
        releaseOnce();
      },
      () => {
        releaseOnce();
      }
    );

    try {
      return await withTimeout(
        operationPromise,
        remainingMs,
        `Request timed out for ${cmd.func}`,
        {
          callId: cmd.call_id,
          func: cmd.func,
        }
      );
    } catch (error) {
      if (error?.code !== "REQUEST_TIMEOUT") {
        releaseOnce();
      }

      throw error;
    }
  }

  buildResponse(cmd, overrides = {}) {
    return {
      error: "",
      func: cmd?.func ?? null,
      args: Array.isArray(cmd?.args) ? cmd.args : [],
      call_id:
        typeof cmd?.call_id === "undefined" ? null : cmd.call_id,
      result: null,
      ...overrides,
    };
  }

  getRequestContext(cmd) {
    if (typeof cmd?.[REQUEST_CONTEXT_KEY] === "undefined") {
      return null;
    }

    return this.requestContexts.get(cmd[REQUEST_CONTEXT_KEY]) ?? null;
  }

  emitErrorEvent(socket, cmd, error, code = null) {
    this.io.to(socket.id).emit("error", {
      error,
      code,
      cmd: {
        call_id:
          typeof cmd?.call_id === "undefined" ? null : cmd.call_id,
        func: cmd?.func ?? null,
        args: Array.isArray(cmd?.args) ? cmd.args : [],
      },
    });
  }

  sendSuccessResponse(socket, cmd, result, context = null) {
    const requestContext = context ?? this.getRequestContext(cmd);
    if (requestContext !== null) {
      requestContext.status = "success";
      requestContext.responseSent = true;
      requestContext.error = null;
    }

    this.io.to(socket.id).emit("response", this.buildResponse(cmd, { result }));
  }

  sendErrorResponse(socket, cmd, error, context = null) {
    const requestContext = context ?? this.getRequestContext(cmd);
    const classified = this.classifyError(error);

    if (requestContext !== null) {
      requestContext.status = classified.status;
      requestContext.responseSent = true;
      requestContext.error = error;
    }

    this.emitErrorEvent(socket, cmd, classified.message, classified.code);
    this.io.to(
      socket.id
    ).emit(
      "response",
      this.buildResponse(cmd, {
        error: classified.message,
        code: classified.code,
      })
    );
  }

  classifyError(error) {
    if (error?.code === "INVALID_COMMAND") {
      return {
        status: "invalid",
        code: error.code,
        message: "invalid command",
      };
    }

    if (error?.code === "SERVER_BUSY") {
      return {
        status: "busy",
        code: error.code,
        message: error.message || "server busy",
      };
    }

    if (error?.code === "REQUEST_TIMEOUT") {
      return {
        status: "timeout",
        code: error.code,
        message: error.message || "request timed out",
      };
    }

    return {
      status: "error",
      code: error?.code ?? "REQUEST_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "request failed",
    };
  }

  getDebugSnapshot() {
    return {
      socketCount: this.io?.engine?.clientsCount ?? 0,
      monitor: this.requestMonitor.getSnapshot(),
      gates: [...this.requestGates.entries()].map(([func, gate]) => ({
        func,
        ...gate.getSnapshot(),
      })),
    };
  }
  /**
   * Handles an invalid command by emitting an error to the socket.
   * @param {Object} cmd - The invalid command object.
   * @param {Socket} socket - The WebSocket socket object.
   */
  invalidCmd(cmd, socket) {
    const error = new Error("invalid command");
    error.code = "INVALID_COMMAND";

    const requestContext = this.getRequestContext(cmd);
    if (requestContext !== null) {
      requestContext.status = "invalid";
      requestContext.responseSent = true;
      requestContext.error = error;
    }

    this.emitErrorEvent(socket, cmd, error.message, error.code);

    if (typeof cmd?.call_id !== "undefined") {
      this.io.to(
        socket.id
      ).emit(
        "response",
        this.buildResponse(cmd, {
          error: error.message,
          code: error.code,
        })
      );
    }
  }
  /**
   * Validates if a given command is valid.
   * @param {Object} cmd - The command object to validate.
   * @param {Socket} socket - The WebSocket socket object.
   * @returns {boolean} - True if the command is valid, false otherwise.
   */
  validCmd(cmd, socket) {
    if (
      cmd === null ||
      typeof cmd !== "object" ||
      typeof cmd.call_id == "undefined" ||
      typeof cmd.func == "undefined" ||
      typeof cmd.args == "undefined" ||
      !Array.isArray(cmd.args)
    ) {
      this.invalidCmd(cmd, socket);
      return false;
    }

    return true;
  }
}
