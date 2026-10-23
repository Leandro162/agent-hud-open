// Only normalized quota and balance data cross the tunnel. Never return raw
// app-server messages, auth files, account identifiers, or provider errors.
export function codexLimits(payload) {
  const map = payload?.rateLimitsByLimitId;
  const buckets =
    map && typeof map === "object" && !Array.isArray(map)
      ? Object.entries(map)
      : payload?.rateLimits
        ? [["codex", payload.rateLimits]]
        : [];
  const windows = [];
  for (const [bucketId, bucket] of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const [slot, value] of Object.entries(bucket)) {
      // Discover window objects rather than hard-code 5h/weekly windows.
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (
        !["usedPercent", "windowDurationMins", "resetsAt"].some(
          (key) => key in value,
        )
      )
        continue;
      const used = value.usedPercent;
      const duration = value.windowDurationMins;
      const reset = value.resetsAt;
      const validReset =
        typeof reset === "number" &&
        Number.isFinite(reset) &&
        reset > 0 &&
        reset * 1000 <= 8640000000000000;
      windows.push({
        id: `${bucketId}:${slot}`,
        name:
          typeof bucket.limitName === "string" && bucket.limitName.trim()
            ? bucket.limitName.slice(0, 120)
            : bucketId.slice(0, 120),
        slot,
        durationMinutes:
          typeof duration === "number" &&
          Number.isFinite(duration) &&
          duration > 0
            ? duration
            : null,
        remainingPercent:
          typeof used === "number" &&
          Number.isFinite(used) &&
          used >= 0 &&
          used <= 100
            ? 100 - used
            : null,
        resetsAt: validReset ? new Date(reset * 1000).toISOString() : null,
      });
    }
  }
  return { windows };
}

function amount(value) {
  return typeof value === "string" &&
    /^-?\d+(\.\d+)?$/.test(value) &&
    value.length <= 80
    ? value
    : null;
}

export function deepseekBalance(payload) {
  if (!Array.isArray(payload?.balance_infos))
    throw new Error("invalid_response");
  const balances = payload.balance_infos.map((row) => ({
    currency:
      typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)
        ? row.currency
        : null,
    total: amount(row.total_balance),
    toppedUp: amount(row.topped_up_balance),
    granted: amount(row.granted_balance),
  }));
  return { balances };
}

export class ProviderCache {
  constructor(read, { now = Date.now, interval = 60000 } = {}) {
    this.read = read;
    this.now = now;
    this.interval = interval;
    this.nextAttempt = 0;
    this.failures = 0;
    this.pending = null;
    this.state = {
      data: null,
      updatedAt: null,
      attemptedAt: null,
      status: "loading",
      error: null,
    };
  }
  refresh(force = false) {
    if (this.pending) return this.pending;
    // Manual requests share a 5s floor; automatic failures back off to 15m.
    if (this.now() < (force ? this.lastAttempt + 5000 : this.nextAttempt))
      return Promise.resolve(this.state);
    this.lastAttempt = this.now();
    this.state.attemptedAt = new Date(this.lastAttempt).toISOString();
    this.pending = (async () => {
      try {
        const data = await this.read();
        this.state = {
          data,
          updatedAt: new Date(this.now()).toISOString(),
          attemptedAt: this.state.attemptedAt,
          status: "ok",
          error: null,
        };
        this.failures = 0;
      } catch (error) {
        this.failures++;
        const allowed = [
          "not_configured",
          "decryption_unavailable",
          "auth_required",
          "permission_denied",
          "network_error",
          "timeout",
          "invalid_response",
          "codex_not_found",
          "unsupported",
        ];
        const code = allowed.includes(error?.message)
          ? error.message
          : "read_failed";
        this.state = {
          ...this.state,
          status: this.state.data ? "stale" : "error",
          error: code,
        };
      }
      this.nextAttempt =
        this.now() +
        Math.min(900000, this.interval * 2 ** Math.min(this.failures, 4));
      return this.state;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  snapshot() {
    const expired =
      this.state.updatedAt &&
      this.now() - Date.parse(this.state.updatedAt) > this.interval * 2;
    return { ...this.state, status: expired ? "stale" : this.state.status };
  }
}
