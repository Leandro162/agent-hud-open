import { ProviderCache } from "./model.mjs";
import { readCodex, readDeepseek } from "./readers.mjs";
import { createQuotaServer } from "./http.mjs";

const providers = {
  codex: new ProviderCache(readCodex),
  deepseek: new ProviderCache(readDeepseek),
};
const server = createQuotaServer(providers);
let timer;
server.on("error", () => {
  console.error("Quota listener failed; verify port 17843 is free.");
  clearInterval(timer);
  process.exitCode = 1;
});
server.listen(17843, "127.0.0.1", () => {
  console.log(
    "Agent HUD quota reader: loopback port 17843; SSH tunnel required.",
  );
  refresh();
  timer = setInterval(refresh, 5000);
});
function refresh() {
  for (const provider of Object.values(providers)) void provider.refresh();
}
function stop() {
  clearInterval(timer);
  server.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
