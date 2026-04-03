import { createWriteStream, statSync } from "node:fs";
import { relative, join } from "node:path";
import archiver from "archiver";
import type { Config } from "../config/schema.js";
import { runBuild } from "./build.js";
import { collectFiles } from "../lib/rsync.js";
import { logger } from "../utils/logger.js";

export interface PackResult {
  success: boolean;
  outputPath: string;
  fileCount: number;
  size: number;
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

export interface PackOptions {
  skipBuild?: boolean;
  outputPath?: string;
}

/**
 * Build edip dosyaları zipleyip local'e kaydet
 */
export async function runPack(
  config: Config,
  cwd: string = process.cwd(),
  options: PackOptions = {}
): Promise<PackResult> {
  const { exclude, include } = config.upload;
  const outFile = options.outputPath ?? join(cwd, "nextship-pack.zip");

  try {
    // Step 1: Build
    if (!options.skipBuild) {
      const buildConfig = { ...config.build };
      const buildResult = await runBuild(buildConfig, cwd, config.pm2.env);

      if (!buildResult.success) {
        return { success: false, outputPath: outFile, fileCount: 0, size: 0, error: buildResult.error };
      }
    }

    // Step 2: Pack
    const spinner = logger.spinner("Collecting files...");
    spinner.start();

    const files = collectFiles(include, exclude, cwd);

    if (files.length === 0) {
      spinner.error({ text: "No files found to pack" });
      return { success: false, outputPath: outFile, fileCount: 0, size: 0, error: "No files found" };
    }

    spinner.update({ text: `Packing ${files.length} files...` });

    const archive = archiver("zip", { zlib: { level: 9 } });
    const output = createWriteStream(outFile);

    const done = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
    });

    archive.pipe(output);

    for (const file of files) {
      const relativePath = relative(cwd, file);
      archive.file(file, { name: relativePath });
    }

    await archive.finalize();
    await done;

    const size = statSync(outFile).size;

    spinner.success({
      text: `Packed ${files.length} files → ${outFile} (${formatBytes(size)})`,
    });

    return { success: true, outputPath: outFile, fileCount: files.length, size };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, outputPath: outFile, fileCount: 0, size: 0, error: message };
  }
}
