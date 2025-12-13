import { reloadApp, verifyAppRunning } from "../lib/pm2.js";
import type { SSHConfig, PM2Config } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export interface RestartResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * Restart PM2 app or start if not exists
 */
export async function runRestart(
  sshConfig: SSHConfig,
  pm2Config: PM2Config,
  remotePath?: string
): Promise<RestartResult> {
  const startTime = Date.now();

  const action = pm2Config.reload ? "Reloading" : "Restarting";
  const spinner = logger.spinner(`${action} PM2 app "${pm2Config.appName}"...`);
  spinner.start();

  try {
    // Reload/Restart or Start if not exists
    const result = await reloadApp(sshConfig, pm2Config, remotePath);

    if (!result.success) {
      spinner.error({ text: `${action} failed: ${result.error}` });
      return {
        success: false,
        duration: Date.now() - startTime,
        error: result.error,
      };
    }

    // Verify application is running
    spinner.update({ text: "Verifying application is running..." });

    const verification = await verifyAppRunning(sshConfig, pm2Config.appName);

    if (!verification.success) {
      spinner.warn({
        text: `App restarted but verification failed: ${verification.error}`,
      });
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    }

    spinner.success({ text: `PM2 app "${pm2Config.appName}" is running` });

    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.error({ text: `${action} failed: ${message}` });

    return {
      success: false,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}
