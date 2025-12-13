import type { Config } from "../config/schema.js";
import { runBuild } from "./build.js";
import { runUpload } from "./upload.js";
import { runRestart } from "./restart.js";
import { logger, showSummary, showError } from "../utils/logger.js";

export interface ShipResult {
  success: boolean;
  steps: {
    build?: { success: boolean; duration: number };
    upload?: { success: boolean; duration: number; method: string };
    restart?: { success: boolean; duration: number };
  };
  totalDuration: number;
  error?: string;
}

export interface ShipOptions {
  skipBuild?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Tüm deployment adımlarını çalıştır: build → upload → restart
 */
export async function runShip(
  config: Config,
  options: ShipOptions = {},
  cwd: string = process.cwd()
): Promise<ShipResult> {
  const startTime = Date.now();
  const result: ShipResult = {
    success: false,
    steps: {},
    totalDuration: 0,
  };

  // Dry-run modu
  if (options.dryRun) {
    logger.info("Dry-run mode enabled. No changes will be made.");
    console.log();
    console.log("  Configuration:");
    console.log(`    SSH Host:     ${config.ssh.host}`);
    console.log(`    SSH User:     ${config.ssh.user}`);
    console.log(`    SSH Port:     ${config.ssh.port}`);
    console.log(`    Remote Path:  ${config.upload.remotePath}`);
    console.log(`    PM2 App:      ${config.pm2.appName}`);
    console.log(`    Build Cmd:    ${config.build.command}`);
    console.log(`    Skip Build:   ${options.skipBuild || config.build.skipBuild}`);
    console.log();
    return {
      success: true,
      steps: {},
      totalDuration: 0,
    };
  }

  try {
    // Step 1: Build
    const buildConfig = {
      ...config.build,
      skipBuild: options.skipBuild || config.build.skipBuild,
    };

    const buildResult = await runBuild(buildConfig, cwd);
    result.steps.build = {
      success: buildResult.success,
      duration: buildResult.duration,
    };

    if (!buildResult.success) {
      result.error = buildResult.error;
      result.totalDuration = Date.now() - startTime;
      return result;
    }

    // Step 2: Upload
    const uploadResult = await runUpload(config.ssh, config.upload, cwd);
    result.steps.upload = {
      success: uploadResult.success,
      duration: uploadResult.duration,
      method: uploadResult.method,
    };

    if (!uploadResult.success) {
      result.error = uploadResult.error;
      result.totalDuration = Date.now() - startTime;
      return result;
    }

    // Step 3: Restart PM2
    const restartResult = await runRestart(config.ssh, config.pm2);
    result.steps.restart = {
      success: restartResult.success,
      duration: restartResult.duration,
    };

    if (!restartResult.success) {
      result.error = restartResult.error;
      result.totalDuration = Date.now() - startTime;
      return result;
    }

    // Success!
    result.success = true;
    result.totalDuration = Date.now() - startTime;

    showSummary({
      host: config.ssh.host,
      remotePath: config.upload.remotePath,
      appName: config.pm2.appName,
      duration: result.totalDuration,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.totalDuration = Date.now() - startTime;
    showError(error instanceof Error ? error : new Error(String(error)), options.verbose);
    return result;
  }
}
