import { execRemoteCommand } from "../lib/ssh.js";
import type { SSHConfig, UploadConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export interface PrepareResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * Prepare standalone folder by copying static and public files
 * This is required for Next.js standalone mode to work correctly
 */
export async function runPrepare(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig
): Promise<PrepareResult> {
  const startTime = Date.now();
  const { remotePath } = uploadConfig;

  const spinner = logger.spinner("Preparing standalone folder...");
  spinner.start();

  try {
    // Detect OS and use appropriate commands
    const osCheck = await execRemoteCommand(sshConfig, "uname -s 2>/dev/null || echo Windows");
    const isWindows = osCheck.stdout.includes("Windows") || osCheck.code !== 0;

    if (isWindows) {
      // Windows commands using xcopy
      const winPath = remotePath.replace(/^\/mnt\/([a-z])\//, "$1:\\\\").replace(/\//g, "\\");

      // Copy .next/static to .next/standalone/.next/static
      const staticCmd = `xcopy "${winPath}\\.next\\static" "${winPath}\\.next\\standalone\\.next\\static" /E /I /Y /Q`;
      const staticResult = await execRemoteCommand(sshConfig, staticCmd);

      if (staticResult.code !== 0 && !staticResult.stdout.includes("File(s) copied")) {
        spinner.error({ text: `Failed to copy static files: ${staticResult.stderr}` });
        return {
          success: false,
          duration: Date.now() - startTime,
          error: staticResult.stderr,
        };
      }

      // Copy public to .next/standalone/public
      const publicCmd = `xcopy "${winPath}\\public" "${winPath}\\.next\\standalone\\public" /E /I /Y /Q`;
      const publicResult = await execRemoteCommand(sshConfig, publicCmd);

      if (publicResult.code !== 0 && !publicResult.stdout.includes("File(s) copied")) {
        spinner.error({ text: `Failed to copy public files: ${publicResult.stderr}` });
        return {
          success: false,
          duration: Date.now() - startTime,
          error: publicResult.stderr,
        };
      }
    } else {
      // Linux/macOS commands using cp
      const staticCmd = `cp -r "${remotePath}/.next/static" "${remotePath}/.next/standalone/.next/"`;
      const staticResult = await execRemoteCommand(sshConfig, staticCmd);

      if (staticResult.code !== 0) {
        spinner.error({ text: `Failed to copy static files: ${staticResult.stderr}` });
        return {
          success: false,
          duration: Date.now() - startTime,
          error: staticResult.stderr,
        };
      }

      const publicCmd = `cp -r "${remotePath}/public" "${remotePath}/.next/standalone/"`;
      const publicResult = await execRemoteCommand(sshConfig, publicCmd);

      if (publicResult.code !== 0) {
        spinner.error({ text: `Failed to copy public files: ${publicResult.stderr}` });
        return {
          success: false,
          duration: Date.now() - startTime,
          error: publicResult.stderr,
        };
      }
    }

    spinner.success({ text: "Standalone folder prepared (static + public copied)" });

    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.error({ text: `Prepare failed: ${message}` });

    return {
      success: false,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}
