import { defineCommand, runMain } from "citty";
import { loadConfig } from "./config/index.js";
import { runBuild } from "./commands/build.js";
import { runUpload } from "./commands/upload.js";
import { runRestart } from "./commands/restart.js";
import { runShip } from "./commands/ship.js";
import { showBanner, showError, setVerbose } from "./utils/logger.js";

const buildCommand = defineCommand({
  meta: {
    name: "build",
    description: "Build the Next.js application",
  },
  args: {
    config: {
      type: "string",
      alias: "c",
      description: "Path to config file",
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Enable verbose output",
      default: false,
    },
  },
  async run({ args }) {
    setVerbose(args.verbose);
    showBanner();

    try {
      const config = await loadConfig({ configPath: args.config });
      const result = await runBuild(config.build);

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error(String(error)), args.verbose);
      process.exit(1);
    }
  },
});

const uploadCommand = defineCommand({
  meta: {
    name: "upload",
    description: "Upload build files to the server via rsync/SFTP",
  },
  args: {
    config: {
      type: "string",
      alias: "c",
      description: "Path to config file",
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Enable verbose output",
      default: false,
    },
  },
  async run({ args }) {
    setVerbose(args.verbose);
    showBanner();

    try {
      const config = await loadConfig({ configPath: args.config });
      const result = await runUpload(config.ssh, config.upload);

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error(String(error)), args.verbose);
      process.exit(1);
    }
  },
});

const restartCommand = defineCommand({
  meta: {
    name: "restart",
    description: "Restart the PM2 application on the server",
  },
  args: {
    config: {
      type: "string",
      alias: "c",
      description: "Path to config file",
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Enable verbose output",
      default: false,
    },
  },
  async run({ args }) {
    setVerbose(args.verbose);
    showBanner();

    try {
      const config = await loadConfig({ configPath: args.config });
      const result = await runRestart(config.ssh, config.pm2);

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error(String(error)), args.verbose);
      process.exit(1);
    }
  },
});

const shipCommand = defineCommand({
  meta: {
    name: "ship",
    description: "Build, upload, and restart - full deployment",
  },
  args: {
    config: {
      type: "string",
      alias: "c",
      description: "Path to config file",
    },
    "skip-build": {
      type: "boolean",
      description: "Skip the build step",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would happen without making changes",
      default: false,
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Enable verbose output",
      default: false,
    },
  },
  async run({ args }) {
    setVerbose(args.verbose);
    showBanner();

    try {
      const config = await loadConfig({ configPath: args.config });
      const result = await runShip(config, {
        skipBuild: args["skip-build"],
        dryRun: args["dry-run"],
        verbose: args.verbose,
      });

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error(String(error)), args.verbose);
      process.exit(1);
    }
  },
});

const main = defineCommand({
  meta: {
    name: "pxnship",
    version: "0.1.0",
    description: "Next.js deployment tool - Build, SSH upload, PM2 restart",
  },
  subCommands: {
    build: buildCommand,
    upload: uploadCommand,
    restart: restartCommand,
    ship: shipCommand,
  },
});

runMain(main);
