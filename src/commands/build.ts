import { execa } from "execa";
import { existsSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BuildConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export interface BuildResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * Build Next.js project
 */
interface LocalPrepareResult {
  success: boolean;
  error?: string;
}

/**
 * Local'de public/ ve .next/static/ klasörlerini .next/standalone/ içine kopyalar
 * Bu sayede sunucuya tek klasör gönderilir
 */
async function runLocalPrepare(cwd: string): Promise<LocalPrepareResult> {
  const spinner = logger.spinner("Preparing standalone folder locally...");
  spinner.start();

  try {
    const standalonePath = join(cwd, ".next", "standalone");
    const publicSrc = join(cwd, "public");
    const publicDest = join(standalonePath, "public");
    const staticSrc = join(cwd, ".next", "static");
    const staticDest = join(standalonePath, ".next", "static");

    // public/ klasörünü kopyala (varsa)
    if (existsSync(publicSrc)) {
      // Önce hedef varsa sil (temiz kopyalama için)
      if (existsSync(publicDest)) {
        rmSync(publicDest, { recursive: true, force: true });
      }
      cpSync(publicSrc, publicDest, { recursive: true });
    }

    // .next/static/ klasörünü kopyala (varsa)
    if (existsSync(staticSrc)) {
      if (existsSync(staticDest)) {
        rmSync(staticDest, { recursive: true, force: true });
      }
      cpSync(staticSrc, staticDest, { recursive: true });
    }

    spinner.success({ text: "Standalone folder prepared locally (static + public copied)" });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.error({ text: `Local prepare failed: ${message}` });
    return { success: false, error: message };
  }
}

/**
 * Build Next.js project
 */
export async function runBuild(
  config: BuildConfig,
  cwd: string = process.cwd()
): Promise<BuildResult> {
  const startTime = Date.now();

  // Skip build if configured
  if (config.skipBuild) {
    logger.info("Skipping build step (skipBuild: true)");
    return {
      success: true,
      duration: Date.now() - startTime,
    };
  }

  const spinner = logger.spinner("Building Next.js application...");
  spinner.start();

  try {
    // Check package.json exists
    const packageJsonPath = join(cwd, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error("package.json not found in current directory");
    }

    // Run build command
    const [runner, ...args] = config.command.split(" ");
    if (!runner) {
      throw new Error("Invalid build command");
    }

    await execa(runner, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });

    // Check standalone output exists
    if (config.standalone) {
      const standalonePath = join(cwd, ".next", "standalone");
      if (!existsSync(standalonePath)) {
        spinner.error({ text: "Build completed but standalone output not found" });
        logger.warn(
          'Add output: "standalone" to next.config.js for optimal deployment'
        );
        return {
          success: true,
          duration: Date.now() - startTime,
        };
      }
    }

    // Check .next directory exists
    const nextDir = join(cwd, ".next");
    if (!existsSync(nextDir)) {
      throw new Error(".next directory not created. Build may have failed.");
    }

    spinner.success({ text: "Build completed successfully" });

    // Local prepare: public/ ve .next/static/ → .next/standalone/ içine kopyala
    if (config.standalone && config.prepareLocally) {
      const localPrepareResult = await runLocalPrepare(cwd);
      if (!localPrepareResult.success) {
        return {
          success: false,
          duration: Date.now() - startTime,
          error: localPrepareResult.error,
        };
      }
    }

    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.error({ text: `Build failed: ${message}` });

    return {
      success: false,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}
