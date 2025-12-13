// PXI NextShip - Next.js Deployment Tool
// Programmatic API exports

export { loadConfig, hasConfigFile, type LoadConfigOptions } from "./config/index.js";
export {
  configSchema,
  type Config,
  type SSHConfig,
  type BuildConfig,
  type UploadConfig,
  type PM2Config,
  type PartialConfig,
} from "./config/schema.js";

export { runBuild, type BuildResult } from "./commands/build.js";
export { runUpload, type UploadCommandResult } from "./commands/upload.js";
export { runRestart, type RestartResult } from "./commands/restart.js";
export { runShip, type ShipResult, type ShipOptions } from "./commands/ship.js";

export { createSSHConnection, testConnection, execRemoteCommand } from "./lib/ssh.js";
export { upload, uploadWithRsync, uploadWithSFTP, isRsyncAvailable } from "./lib/rsync.js";
export { reloadApp, getAppStatus, verifyAppRunning, startApp } from "./lib/pm2.js";
