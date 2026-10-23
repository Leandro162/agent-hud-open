export type Provider<T> = {
  data: T | null;
  updatedAt: string | null;
  attemptedAt: string | null;
  status: "loading" | "ok" | "stale" | "error";
  error: string | null;
};
export type QuotaWindow = {
  id: string;
  name: string;
  slot: string;
  durationMinutes: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
};
export type Snapshot = {
  schemaVersion: 1;
  serverTime: string;
  providers: {
    codex: Provider<{ windows: QuotaWindow[] }>;
    deepseek: Provider<{
      balances: {
        currency: string | null;
        total: string | null;
        toppedUp: string | null;
        granted: string | null;
      }[];
    }>;
  };
};
