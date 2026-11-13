import { logger } from "./logger.js";

const STATE = Object.freeze({ CLOSED: "CLOSED", OPEN: "OPEN", HALF_OPEN: "HALF_OPEN" });

export class CircuitBreaker {
  #name;
  #failureThreshold;
  #successThreshold;
  #timeout;
  #state = STATE.CLOSED;
  #failureCount = 0;
  #successCount = 0;
  #nextAttemptAt = 0;

  constructor(name, { failureThreshold = 5, successThreshold = 2, timeout = 30_000 } = {}) {
    this.#name = name;
    this.#failureThreshold = failureThreshold;
    this.#successThreshold = successThreshold;
    this.#timeout = timeout;
  }

  get state() { return this.#state; }

  async execute(fn) {
    if (this.#state === STATE.OPEN) {
      if (Date.now() < this.#nextAttemptAt) {
        const err = new Error(`[CircuitBreaker:${this.#name}] OPEN -- service unavailable`);
        err.code = "CIRCUIT_OPEN";
        throw err;
      }
      this.#state = STATE.HALF_OPEN;
      this.#successCount = 0;
      logger.warn({ circuit: this.#name }, "Circuit HALF_OPEN -- probing");
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (err) {
      // why: an OPEN-circuit rejection is thrown by the breaker itself, not by the wrapped call — must not count as a new failure
      if (err.code !== "CIRCUIT_OPEN") this.#onFailure();
      throw err;
    }
  }

  #onSuccess() {
    this.#failureCount = 0;
    if (this.#state === STATE.HALF_OPEN) {
      this.#successCount++;
      if (this.#successCount >= this.#successThreshold) {
        this.#state = STATE.CLOSED;
        logger.info({ circuit: this.#name }, "Circuit CLOSED -- service recovered");
      }
    }
  }

  #onFailure() {
    this.#failureCount++;
    if (this.#state === STATE.HALF_OPEN || this.#failureCount >= this.#failureThreshold) {
      this.#state = STATE.OPEN;
      this.#nextAttemptAt = Date.now() + this.#timeout;
      this.#failureCount = 0;
      logger.error(
        { circuit: this.#name, retryAfterMs: this.#timeout },
        "Circuit OPEN -- too many failures"
      );
    }
  }

  status() {
    return {
      name: this.#name,
      state: this.#state,
      failureCount: this.#failureCount,
      nextAttemptAt: this.#state === STATE.OPEN ? new Date(this.#nextAttemptAt).toISOString() : null,
    };
  }
}
