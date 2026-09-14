export type ErrorCode =
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "OUTCOME_UNKNOWN"
  | "CANCELLED"
  | "INVALID_RESPONSE"
  | "INVALID_PATH"
  | "TRADING_DISABLED";

export class Trading212Error extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "Trading212Error";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      retryAfterMs: this.retryAfterMs,
    };
  }
}
