import pc from "picocolors";
import { createSpinner, type Spinner } from "nanospinner";

export interface Logger {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
  spinner: (message: string) => Spinner;
}

let verboseMode = false;

/**
 * Set verbose mode
 */
export function setVerbose(value: boolean): void {
  verboseMode = value;
}

/**
 * Create logger
 */
export function createLogger(): Logger {
  return {
    info: (message: string) => {
      console.log(pc.blue("ℹ"), message);
    },

    success: (message: string) => {
      console.log(pc.green("✔"), message);
    },

    error: (message: string) => {
      console.error(pc.red("✖"), message);
    },

    warn: (message: string) => {
      console.warn(pc.yellow("⚠"), message);
    },

    debug: (message: string) => {
      if (verboseMode) {
        console.log(pc.gray("◦"), pc.gray(message));
      }
    },

    spinner: (message: string) => {
      return createSpinner(message, {
        color: "cyan",
      });
    },
  };
}

/**
 * Show banner
 */
export function showBanner(): void {
  console.log();
  console.log(pc.cyan(pc.bold("  PXI NextShip")));
  console.log(pc.gray("  Next.js deployment made easy"));
  console.log();
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
 * Format duration in seconds
 */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Show deployment summary
 */
export function showSummary(options: {
  host: string;
  remotePath: string;
  appName: string;
  duration: number;
  bytesTransferred?: number;
  buildDuration?: number;
  uploadDuration?: number;
}): void {
  const { host, remotePath, appName, duration, bytesTransferred, buildDuration, uploadDuration } = options;

  console.log();
  console.log(pc.green(pc.bold("  Deployment Complete!")));
  console.log();
  console.log(`  ${pc.gray("Server:")}     ${host}`);
  console.log(`  ${pc.gray("Path:")}       ${remotePath}`);
  console.log(`  ${pc.gray("PM2 App:")}    ${appName}`);
  if (bytesTransferred) {
    console.log(`  ${pc.gray("Uploaded:")}   ${formatBytes(bytesTransferred)}`);
  }
  if (buildDuration !== undefined) {
    console.log(`  ${pc.gray("Build:")}     ${formatDuration(buildDuration)}`);
  }
  if (uploadDuration !== undefined) {
    console.log(`  ${pc.gray("Upload:")}    ${formatDuration(uploadDuration)}`);
  }
  console.log(`  ${pc.gray("Total:")}     ${formatDuration(duration)}`);
  console.log();
}

/**
 * Show error details
 */
export function showError(error: Error | string, verbose?: boolean): void {
  const message = error instanceof Error ? error.message : error;

  console.error();
  console.error(pc.red(pc.bold("  Deployment Failed")));
  console.error();
  console.error(`  ${pc.red("Error:")} ${message}`);

  if (verbose && error instanceof Error && error.stack) {
    console.error();
    console.error(pc.gray(error.stack));
  }

  console.error();
}

export const logger = createLogger();
