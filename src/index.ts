import { startScheduler } from "./scheduler.js";
import { startSocketMode } from "./socket-mode.js";
import { config } from "./config.js";

console.log("=================================");
console.log("  Bagel Agent Service Starting");
console.log(`  Timezone: ${config.timezone}`);
console.log(`  Hours: ${config.businessHoursStart} - ${config.businessHoursEnd}`);
console.log(`  Slack: ${config.slackChannelId}`);
console.log(`  Asana: ${config.asanaProjectGid}`);
console.log(`  Vault: ${config.obsidianRepoUrl.split("/").pop()?.replace(".git", "")}`);
console.log("=================================");

startScheduler();
startSocketMode().catch((err) => {
  console.error("[socket-mode] Failed to start:", err);
});

process.on("SIGTERM", () => {
  console.log("Bagel agent shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Bagel agent interrupted, shutting down...");
  process.exit(0);
});
