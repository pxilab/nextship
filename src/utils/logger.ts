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
 * Verbose modu ayarla
 */
export function setVerbose(value: boolean): void {
  verboseMode = value;
}

/**
 * Logger oluştur
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
 * Banner göster
 */
export function showBanner(): void {
  console.log();
  console.log(pc.cyan(pc.bold("  PXI NextShip")));
  console.log(pc.gray("  Next.js deployment made easy"));
  console.log();
}

/**
 * Deployment özeti göster
 */
export function showSummary(options: {
  host: string;
  remotePath: string;
  appName: string;
  duration: number;
}): void {
  const { host, remotePath, appName, duration } = options;

  console.log();
  console.log(pc.green(pc.bold("  Deployment Complete!")));
  console.log();
  console.log(`  ${pc.gray("Server:")}     ${host}`);
  console.log(`  ${pc.gray("Path:")}       ${remotePath}`);
  console.log(`  ${pc.gray("PM2 App:")}    ${appName}`);
  console.log(`  ${pc.gray("Duration:")}   ${(duration / 1000).toFixed(1)}s`);
  console.log();
}

/**
 * Hata detaylarını göster
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
