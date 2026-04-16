import TracManager from "./TracManager.mjs";
import { formatError } from "./AsyncUtils.mjs";

let tracCore = new TracManager();
await tracCore.initReader();

function logProcessSnapshot(reason, error = null) {
  console.error("[tap-reader] process snapshot", {
    reason,
    error: error ? formatError(error) : null,
    memoryUsage: process.memoryUsage(),
    snapshot: tracCore.getDebugSnapshot(),
  });
}

process.on("unhandledRejection", (reason) => {
  logProcessSnapshot("unhandledRejection", reason);
});

process.on("uncaughtException", (error) => {
  logProcessSnapshot("uncaughtException", error);

  setTimeout(() => {
    process.exit(1);
  }, 25);
});

for (const signal of ["SIGUSR1", "SIGUSR2"]) {
  process.on(signal, () => {
    logProcessSnapshot(signal);
  });
}

// example call if used without rest or websockets
//console.log( await tracCore.tapProtocol.getHolders( 'dmt-nat', 111, 111) );
