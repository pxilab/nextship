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
  success: boolean;
  error?: string;
}

/**
 * rsync mevcut mu kontrol et
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
 * rsync ile dosyaları yükle
 */
export async function uploadWithRsync(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig,
  cwd: string = process.cwd(),
  onProgress?: (message: string) => void
): Promise<UploadResult> {
  const { remotePath, exclude, include, rsyncOptions } = uploadConfig;
  const { host, user, port, privateKeyPath, privateKey } = sshConfig;

  // SSH key için geçici dosya yoksa privateKeyPath kullan
  // Not: rsync direkt key içeriği alamaz, dosya yolu gerekli
  if (!privateKeyPath && privateKey) {
    throw new Error(
      "rsync requires privateKeyPath. For inline SSH keys, SFTP fallback will be used."
    );
  }

  // rsync argümanlarını oluştur
  const args: string[] = [...rsyncOptions];

  // SSH options
  const sshCommand = `ssh -p ${port} -i "${privateKeyPath}" -o StrictHostKeyChecking=no`;
  args.push("-e", sshCommand);

  // Exclude patterns
  for (const pattern of exclude) {
    args.push("--exclude", pattern);
  }

  // Include patterns (kaynak dosyalar)
  const sources: string[] = [];
  for (const pattern of include) {
    const sourcePath = join(cwd, pattern);
    if (existsSync(sourcePath)) {
      sources.push(sourcePath);
    }
  }

  if (sources.length === 0) {
    throw new Error("No files to upload. Make sure build output exists.");
  }

  // Hedef
  const destination = `${user}@${host}:${remotePath}/`;

  // Son argümanlar
  args.push(...sources, destination);

  onProgress?.(`Syncing files to ${host}:${remotePath}`);

  try {
    const result = await execa("rsync", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Aktarılan dosya sayısını tahmin et (basit)
    const lines = result.stdout.split("\n").filter((l) => l.trim());
    const filesTransferred = lines.length;

    return {
      method: "rsync",
      filesTransferred,
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
 * Dizin içeriğini recursive olarak listele
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

    // Exclude kontrolü
    const shouldExclude = exclude.some((pattern) => {
      if (pattern.includes("*")) {
        // Basit glob desteği
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

    // Yüklenecek dosyaları bul
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

        // Sırayla dosyaları yükle
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

          // Hedef dizini oluştur (mkdir -p benzeri)
          const mkdirRecursive = (path: string, callback: () => void) => {
            sftp.mkdir(path, (_err) => {
              // Dizin zaten var veya oluşturuldu
              callback();
            });
          };

          // Dizin yollarını parçala ve sırayla oluştur
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
            // Dosyayı yükle
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
    });
  });
}

/**
 * Otomatik olarak en iyi yükleme yöntemini seç
 */
export async function upload(
  sshConfig: SSHConfig,
  uploadConfig: UploadConfig,
  cwd: string = process.cwd(),
  onProgress?: (message: string) => void
): Promise<UploadResult> {
  // rsync mevcut mu ve privateKeyPath var mı kontrol et
  const rsyncAvailable = await isRsyncAvailable();
  const hasKeyPath = Boolean(sshConfig.privateKeyPath);

  if (uploadConfig.useRsync && rsyncAvailable && hasKeyPath) {
    onProgress?.("Using rsync for file transfer");
    return uploadWithRsync(sshConfig, uploadConfig, cwd, onProgress);
  }

  // SFTP fallback
  onProgress?.("Using SFTP for file transfer (rsync not available)");
  return uploadWithSFTP(sshConfig, uploadConfig, cwd, (progress) => {
    onProgress?.(`Uploading ${progress.file} (${progress.percentage}%)`);
  });
}
