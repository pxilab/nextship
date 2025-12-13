import { execa } from "execa";
import { existsSync, readdirSync, statSync, createReadStream } from "node:fs";
import { join, basename, dirname, relative } from "node:path";
import { Client } from "ssh2";
import type { SSHConfig, UploadConfig } from "../config/schema.js";

export interface UploadProgress {
  file: string;
  transferred: number;
  total: number;
  percentage: number;
}

export interface UploadResult {
  method: "rsync" | "sftp";
  filesTransferred: number;
  bytesTransferred?: number;
  success: boolean;
  error?: string;
}

/**
 * Check if rsync is available
 */
export async function isRsyncAvailable(): Promise<boolean> {
  try {
    await execa("rsync", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if sshpass is available (for password auth)
 */
export async function isSshpassAvailable(): Promise<boolean> {
  try {
    await execa("sshpass", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload files with rsync
 */
export async function uploadWithRsync(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig,
  cwd: string = process.cwd(),
  onProgress?: (message: string) => void
): Promise<UploadResult> {
  const { remotePath, exclude, include, rsyncOptions } = uploadConfig;
  const { host, user, port, privateKeyPath, privateKey, password } = sshConfig;

  // rsync requires a key file path, it cannot use inline key content
  if (!privateKeyPath && privateKey && !password) {
    throw new Error(
      "rsync requires privateKeyPath. For inline SSH keys, SFTP fallback will be used."
    );
  }

  // Password auth requires sshpass
  const usePassword = Boolean(password) && !privateKeyPath;
  let command = "rsync";
  let commandArgs: string[] = [];

  if (usePassword && password) {
    // Run rsync via sshpass for password auth
    command = "sshpass";
    commandArgs = ["-p", password, "rsync"];
  }

  // Build rsync arguments
  const args: string[] = [...rsyncOptions];

  // SSH command options
  let sshCommand: string;
  if (usePassword) {
    sshCommand = `ssh -p ${port} -o StrictHostKeyChecking=no -o PubkeyAuthentication=no`;
  } else {
    sshCommand = `ssh -p ${port} -i "${privateKeyPath}" -o StrictHostKeyChecking=no`;
  }
  args.push("-e", sshCommand);

  // Exclude patterns
  for (const pattern of exclude) {
    args.push("--exclude", pattern);
  }

  // Use --relative to preserve directory structure (e.g., .next/static/ stays as .next/static/)
  args.push("--relative");

  // Add --stats to get transfer statistics
  args.push("--stats");

  // Include patterns (source files) - use relative paths with --relative flag
  const sources: string[] = [];
  for (const pattern of include) {
    const sourcePath = join(cwd, pattern);
    if (existsSync(sourcePath)) {
      // Use relative path (e.g., ./.next/static/) for --relative flag
      sources.push("./" + pattern.replace(/\/$/, ""));
    }
  }

  if (sources.length === 0) {
    throw new Error("No files to upload. Make sure build output exists.");
  }

  // Destination
  const destination = `${user}@${host}:${remotePath}/`;

  // Final arguments - sources must come before destination
  args.push(...sources, destination);

  // Combine command arguments
  const finalArgs = [...commandArgs, ...args];

  onProgress?.(`Syncing files to ${host}:${remotePath}`);

  try {
    const result = await execa(command, finalArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse rsync stats output
    const stdout = result.stdout;

    // Extract total file count from "Number of files: X" (includes dirs)
    // or count lines that don't start with stats
    const filesMatch = stdout.match(/Number of files:\s*([\d,]+)/);
    let filesTransferred = filesMatch?.[1] ? parseInt(filesMatch[1].replace(/,/g, ""), 10) : 0;

    // Fallback: count non-empty lines that look like file paths (not stats lines)
    if (filesTransferred === 0) {
      const lines = stdout.split("\n").filter((l) => {
        const trimmed = l.trim();
        return trimmed && !trimmed.startsWith("Number") && !trimmed.startsWith("Total")
          && !trimmed.startsWith("sent") && !trimmed.startsWith("File list")
          && !trimmed.startsWith("Matched") && !trimmed.startsWith("Unmatched");
      });
      filesTransferred = lines.length;
    }

    // Extract bytes from "Total sent: X B" or "sent X bytes"
    const bytesMatch = stdout.match(/(?:Total sent|sent):\s*([\d,]+)\s*B?/i)
      || stdout.match(/sent\s+([\d,]+)\s+bytes/i);
    const bytesTransferred = bytesMatch?.[1] ? parseInt(bytesMatch[1].replace(/,/g, ""), 10) : undefined;

    return {
      method: "rsync",
      filesTransferred,
      bytesTransferred,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      method: "rsync",
      filesTransferred: 0,
      success: false,
      error: message,
    };
  }
}

/**
 * List directory contents recursively
 */
function walkDirectory(
  dir: string,
  baseDir: string,
  exclude: string[]
): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(baseDir, fullPath);

    // Check exclude patterns
    const shouldExclude = exclude.some((pattern) => {
      if (pattern.includes("*")) {
        // Simple glob support
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(relativePath);
      }
      return relativePath.startsWith(pattern) || entry.name === pattern;
    });

    if (shouldExclude) continue;

    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath, baseDir, exclude));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * SFTP ile dosyaları yükle (Windows fallback)
 */
export async function uploadWithSFTP(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig,
  cwd: string = process.cwd(),
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const { remotePath, exclude, include } = uploadConfig;

  return new Promise((resolve) => {
    const client = new Client();
    let filesTransferred = 0;
    let currentFileIndex = 0;

    // Find files to upload
    const filesToUpload: { local: string; remote: string }[] = [];

    for (const pattern of include) {
      const sourcePath = join(cwd, pattern);
      if (!existsSync(sourcePath)) continue;

      const stat = statSync(sourcePath);

      if (stat.isDirectory()) {
        const files = walkDirectory(sourcePath, cwd, exclude);
        for (const file of files) {
          const relativePath = relative(cwd, file);
          filesToUpload.push({
            local: file,
            remote: join(remotePath, relativePath),
          });
        }
      } else {
        filesToUpload.push({
          local: sourcePath,
          remote: join(remotePath, pattern),
        });
      }
    }

    if (filesToUpload.length === 0) {
      resolve({
        method: "sftp",
        filesTransferred: 0,
        success: false,
        error: "No files to upload",
      });
      return;
    }

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          resolve({
            method: "sftp",
            filesTransferred: 0,
            success: false,
            error: err.message,
          });
          return;
        }

        // Upload files sequentially
        const uploadNext = () => {
          if (currentFileIndex >= filesToUpload.length) {
            client.end();
            resolve({
              method: "sftp",
              filesTransferred,
              success: true,
            });
            return;
          }

          const file = filesToUpload[currentFileIndex];
          if (!file) {
            currentFileIndex++;
            uploadNext();
            return;
          }

          const { local, remote } = file;
          const remoteDir = dirname(remote);
          const localStat = statSync(local);

          // Create target directory (mkdir -p equivalent)
          const mkdirRecursive = (path: string, callback: () => void) => {
            sftp.mkdir(path, (_err) => {
              // Directory already exists or was created
              callback();
            });
          };

          // Split directory path and create sequentially
          const parts = remoteDir.split("/").filter((p) => p);
          let currentPath = "";
          const createDirs = (index: number, done: () => void) => {
            if (index >= parts.length) {
              done();
              return;
            }
            currentPath += "/" + parts[index];
            mkdirRecursive(currentPath, () => createDirs(index + 1, done));
          };

          createDirs(0, () => {
            // Upload the file
            const readStream = createReadStream(local);
            const writeStream = sftp.createWriteStream(remote);

            let transferred = 0;

            readStream.on("data", (chunk: Buffer | string) => {
              const len = typeof chunk === "string" ? chunk.length : chunk.length;
              transferred += len;
              onProgress?.({
                file: basename(local),
                transferred,
                total: localStat.size,
                percentage: Math.round((transferred / localStat.size) * 100),
              });
            });

            writeStream.on("close", () => {
              filesTransferred++;
              currentFileIndex++;
              uploadNext();
            });

            writeStream.on("error", (_err: Error) => {
              currentFileIndex++;
              uploadNext();
            });

            readStream.pipe(writeStream);
          });
        };

        uploadNext();
      });
    });

    client.on("error", (err) => {
      resolve({
        method: "sftp",
        filesTransferred: 0,
        success: false,
        error: err.message,
      });
    });

    client.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.user,
      privateKey: sshConfig.privateKey,
      password: sshConfig.password,
    });
  });
}

/**
 * Automatically select the best upload method
 */
export async function upload(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig,
  cwd: string = process.cwd(),
  onProgress?: (message: string) => void
): Promise<UploadResult> {
  const rsyncAvailable = await isRsyncAvailable();
  const hasKeyPath = Boolean(sshConfig.privateKeyPath);
  const isPasswordAuth = Boolean(sshConfig.password) && !sshConfig.privateKey && !hasKeyPath;

  // Key-based auth with rsync
  if (uploadConfig.useRsync && rsyncAvailable && hasKeyPath) {
    onProgress?.("Using rsync for file transfer");
    return uploadWithRsync(sshConfig, uploadConfig, cwd, onProgress);
  }

  // Password auth with sshpass + rsync (if sshpass available)
  if (uploadConfig.useRsync && rsyncAvailable && isPasswordAuth) {
    const sshpassAvailable = await isSshpassAvailable();
    if (sshpassAvailable) {
      onProgress?.("Using rsync with sshpass for file transfer");
      return uploadWithRsync(sshConfig, uploadConfig, cwd, onProgress);
    }
  }

  // SFTP fallback
  onProgress?.("Using SFTP for file transfer (rsync not available)");
  return uploadWithSFTP(sshConfig, uploadConfig, cwd, (progress) => {
    onProgress?.(`Uploading ${progress.file} (${progress.percentage}%)`);
  });
}
