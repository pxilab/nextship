import { upload } from "../lib/rsync.js";
import type { SSHConfig, UploadConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export interface UploadCommandResult {
  success: boolean;
  method: "rsync" | "sftp";
  filesTransferred: number;
  bytesTransferred?: number;
  duration: number;
  error?: string;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Upload files to server
 */
export async function runUpload(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig,
  cwd: string = process.cwd()
): Promise<UploadCommandResult> {
  const startTime = Date.now();

  const spinner = logger.spinner(
    `Uploading files to ${sshConfig.host}:${uploadConfig.remotePath}...`
  );
  spinner.start();

  try {
    const result = await upload(sshConfig, uploadConfig, cwd, (message) => {
      spinner.update({ text: message });
    });

    if (!result.success) {
      spinner.error({ text: `Upload failed: ${result.error}` });
      return {
        success: false,
        method: result.method,
        filesTransferred: result.filesTransferred,
        duration: Date.now() - startTime,
        error: result.error,
      };
    }

    const sizeInfo = result.bytesTransferred
      ? `, ${formatBytes(result.bytesTransferred)}`
      : "";

    spinner.success({
      text: `Upload completed (${result.filesTransferred} files${sizeInfo} via ${result.method})`,
    });

    return {
      success: true,
      method: result.method,
      filesTransferred: result.filesTransferred,
      bytesTransferred: result.bytesTransferred,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.error({ text: `Upload failed: ${message}` });

    return {
      success: false,
      method: "sftp",
      filesTransferred: 0,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}
