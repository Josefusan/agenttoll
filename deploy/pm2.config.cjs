// pm2 process list for the no-sudo VPS demo (README path B).
//   pm2 start deploy/pm2.config.cjs && pm2 save
// Secrets live in a mode-600 env file outside git (default ~/agenttoll/config/agenttoll-live.env).
// Every payment on this stack is SIMULATED (demo/mock-facilitator).
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const home = os.homedir();
const envFile = process.env.AGENTTOLL_ENV_FILE || path.join(home, "agenttoll", "config", "agenttoll-live.env");
const dataDir = process.env.AGENTTOLL_DATA_DIR || path.join(home, "agenttoll", "data");
const bin = process.env.AGENTTOLL_BIN || path.join(root, "target", "release");
const cloudflared = process.env.CLOUDFLARED || path.join(home, "bin", "cloudflared");
const gwPort = process.env.AGENTTOLL_GATEWAY_PORT || "8402";
const adminPort = process.env.AGENTTOLL_ADMIN_PORT || "8403";
const dashPort = process.env.AGENTTOLL_DASHBOARD_PORT || "3402";
const logs = path.join(dataDir, "logs");

// Run a command with the env file loaded, without ever printing it.
// The gateway ports come from here into agenttoll.vps.yaml, so the listener and the tunnel
// target cannot drift apart.
const withEnv = (cmd) => ({
  script: "bash",
  args: ["-c", `set -a; . "${envFile}"; set +a; export AGENTTOLL_DATA_DIR="${dataDir}" AGENTTOLL_LISTEN="127.0.0.1:${gwPort}" AGENTTOLL_ADMIN_LISTEN="127.0.0.1:${adminPort}"; exec ${cmd}`],
  cwd: root,
});
const logsFor = (name) => ({
  out_file: path.join(logs, `${name}.out.log`),
  error_file: path.join(logs, `${name}.err.log`),
  merge_logs: true,
  interpreter: "none",
  autorestart: true,
  max_restarts: 20,
  restart_delay: 2000,
});

module.exports = {
  apps: [
    { name: "at-origin", ...withEnv(`env ORIGIN_LISTEN=127.0.0.1:4000 "${bin}/agenttoll-demo-origin"`), ...logsFor("at-origin") },
    { name: "at-facilitator", ...withEnv(`env MOCK_FACILITATOR_LISTEN=127.0.0.1:4020 "${bin}/agenttoll-mock-facilitator"`), ...logsFor("at-facilitator") },
    { name: "at-gateway", ...withEnv(`"${bin}/agenttoll-gateway" --config "${root}/deploy/agenttoll.vps.yaml"`), ...logsFor("at-gateway") },
    {
      name: "at-dashboard",
      script: "bash",
      args: ["-c", `set -a; . "${envFile}"; set +a; export AGENTTOLL_ADMIN_URL=http://127.0.0.1:${adminPort}; exec ./node_modules/.bin/next start -H 127.0.0.1 -p ${dashPort}`],
      cwd: path.join(root, "apps", "dashboard"),
      ...logsFor("at-dashboard"),
    },
    { name: "at-tunnel-gw", script: cloudflared, args: `tunnel --no-autoupdate --url http://127.0.0.1:${gwPort}`, ...logsFor("at-tunnel-gw") },
    { name: "at-tunnel-dash", script: cloudflared, args: `tunnel --no-autoupdate --url http://127.0.0.1:${dashPort}`, ...logsFor("at-tunnel-dash") },
  ],
};
