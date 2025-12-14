import type { Config } from "../config/schema.js";
import { runBuild } from "./build.js";
import { runUpload } from "./upload.js";
import { runPrepare } from "./prepare.js";
import { runRestart } from "./restart.js";
import { logger, showSummary, showError } from "../utils/logger.js";

export interface ShipResult {
  success: boolean;
  steps: {
    build?: { success: boolean; duration: number };
    upload?: { success: boolean; duration: number; method: string };
    prepare?: { success: boolean; duration: number };
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
 * Run all deployment steps: build → upload → restart
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
    console.log(`    PM2 Port:     ${config.pm2.port || "default (3000)"}`);
    const envCount = config.pm2.env ? Object.keys(config.pm2.env).length : 0;
    console.log(`    PM2 Env:      ${envCount > 0 ? `${envCount} variable(s)` : "none"}`);
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

    // Step 3: Prepare standalone folder (copy static + public)
    // prepareLocally true ise bu adım local'de yapıldı, sunucuda tekrar yapmaya gerek yok
    if (config.build.standalone && !config.build.prepareLocally) {
      const prepareResult = await runPrepare(config.ssh, config.upload);
      result.steps.prepare = {
        success: prepareResult.success,
        duration: prepareResult.duration,
      };

      if (!prepareResult.success) {
        result.error = prepareResult.error;
        result.totalDuration = Date.now() - startTime;
        return result;
      }
    }

    // Step 4: Restart PM2 (or start if not exists)
    const restartResult = await runRestart(config.ssh, config.pm2, config.upload.remotePath);
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
      bytesTransferred: uploadResult.bytesTransferred,
      buildDuration: result.steps.build?.duration,
      uploadDuration: result.steps.upload?.duration,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.totalDuration = Date.now() - startTime;
    showError(error instanceof Error ? error : new Error(String(error)), options.verbose);
    return result;
  }
}
