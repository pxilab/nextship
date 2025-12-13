import { upload } from "../lib/rsync.js";
import type { SSHConfig, UploadConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export interface UploadCommandResult {
  success: boolean;
  method: "rsync" | "sftp";
  filesTransferred: number;
  duration: number;
  error?: string;
}

/**
 * Dosyaları sunucuya yükle
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

    spinner.success({
      text: `Upload completed (${result.filesTransferred} files via ${result.method})`,
    });

    return {
      success: true,
      method: result.method,
      filesTransferred: result.filesTransferred,
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
