import { createServer } from "node:http";

export function createQuotaServer(providers) {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    // This service is only for SSH loopback forwarding, never public HTTP.
    // Do not allow browser-originated reads/writes, CORS, or DNS rebinding.
    if (
      request.headers.origin ||
      !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? "")
    ) {
      response.writeHead(403).end('{"error":"forbidden"}');
      return;
    }
    const refresh = request.method === "POST" && request.url === "/api/refresh";
    if (
      !(request.method === "GET" && request.url === "/api/snapshot") &&
      !refresh
    ) {
      response.writeHead(404).end('{"error":"not_found"}');
      return;
    }
    if (refresh)
      await Promise.allSettled(
        Object.values(providers).map((provider) => provider.refresh(true)),
      );
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        serverTime: new Date().toISOString(),
        providers: Object.fromEntries(
          Object.entries(providers).map(([name, provider]) => [
            name,
            provider.snapshot(),
          ]),
        ),
      }),
    );
  });
}
