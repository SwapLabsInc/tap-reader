export class TimeoutError extends Error {
  constructor(message, timeoutMs, details = {}) {
    super(message);
    this.name = "TimeoutError";
    this.code = "REQUEST_TIMEOUT";
    this.timeoutMs = timeoutMs;
    this.details = details;
  }
}

export async function withTimeout(promiseOrFactory, timeoutMs, message, details = {}) {
  let timer = null;
  const promise =
    typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new TimeoutError(message, timeoutMs, details));
        }, timeoutMs);

        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: error.code ?? null,
      stack: error.stack ?? null,
      cause:
        error.cause instanceof Error
          ? {
              name: error.cause.name,
              message: error.cause.message,
              code: error.cause.code ?? null,
            }
          : error.cause ?? null,
      details: error.details ?? null,
    };
  }

  return {
    name: "NonError",
    message: String(error),
    code: null,
    stack: null,
    cause: null,
    details: null,
  };
}
