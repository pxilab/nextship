import { createSSHConnection, type SSHConnection } from "./ssh.js";
import type { SSHConfig, PM2Config } from "../config/schema.js";

/**
 * Escape shell value for safe command execution
 * Handles quotes, spaces, and special characters
 */
function escapeShellValue(value: string): string {
  if (/[\s&|<>^"'`$\\]/.test(value)) {
    // Escape double quotes and wrap in quotes
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Build environment variable prefix for shell commands
 * @param env Record of environment variables
 * @param isWindows Whether target is Windows (uses set command)
 * @returns Prefix string like "set VAR=val && " (Windows) or "VAR=val " (Linux)
 */
function buildEnvPrefix(env: Record<string, string> | undefined, isWindows: boolean): string {
  if (!env || Object.keys(env).length === 0) {
    return "";
  }

  const entries = Object.entries(env);

  if (isWindows) {
    // Windows CMD format: set VAR1=value1 && set VAR2=value2 &&
    return entries.map(([k, v]) => `set ${k}=${escapeShellValue(v)}`).join(" && ") + " && ";
  }
  // Linux/Unix format: VAR1=value1 VAR2=value2
  return entries.map(([k, v]) => `${k}=${escapeShellValue(v)}`).join(" ") + " ";
}

export interface PM2Result {
  success: boolean;
  status?: string;
  error?: string;
}

/**
 * Reload PM2 app or start if not exists
 * Based on ecosystem setting:
 *   true | "auto" = auto-detect ecosystem.config.js
 *   false = don't use ecosystem, start with standalone server.js
 *   "filename.js" = use specified ecosystem file
 */
export async function reloadApp(
  sshConfig: SSHConfig,
  pm2Config: PM2Config,
  remotePath?: string
): Promise<PM2Result> {
  const { appName, ecosystem, reload, port, env } = pm2Config;
  let conn: SSHConnection | null = null;

  try {
    conn = await createSSHConnection(sshConfig);

    // Convert WSL path to Windows path and detect Windows target
    const isWindows = remotePath?.startsWith("/mnt/") ?? false;
    const winPath = remotePath
      ? remotePath.replace(/^\/mnt\/([a-z])\//, "$1:\\\\").replace(/\//g, "\\")
      : "";

    // Build environment variable prefix
    const envPrefix = buildEnvPrefix(env, isWindows);

    // Determine ecosystem file based on config
    let ecosystemFile: string | null = null;

    if (ecosystem === false) {
      // Explicitly disabled - don't use ecosystem
      ecosystemFile = null;
    } else if (typeof ecosystem === "string" && ecosystem !== "auto") {
      // Specific file provided
      ecosystemFile = ecosystem;
    } else if ((ecosystem === true || ecosystem === "auto") && remotePath) {
      // Auto-detect: check if ecosystem.config.js exists
      const checkEcosystem = await conn.exec(`if exist "${winPath}\\ecosystem.config.js" echo EXISTS`);
      if (checkEcosystem.stdout.includes("EXISTS")) {
        ecosystemFile = "ecosystem.config.js";
      }
    }

    // Check if app exists in PM2
    const checkResult = await conn.exec(`pm2 jlist`);
    let appExists = false;

    if (checkResult.code === 0) {
      try {
        const apps = JSON.parse(checkResult.stdout) as Array<{ name: string }>;
        appExists = apps.some((a) => a.name === appName);
      } catch {
        appExists = false;
      }
    }

    let command: string;

    if (appExists) {
      // Reload or restart command - prepend env vars if provided
      const action = reload ? "reload" : "restart";
      command = `${envPrefix}pm2 ${action} ${appName} --update-env`;
    } else {
      // App doesn't exist, start it
      if (!remotePath) {
        return {
          success: false,
          error: `App "${appName}" not found and no remotePath provided to start it`,
        };
      }

      if (ecosystemFile) {
        // Use ecosystem file to start - env vars prepended
        command = `cd /d "${winPath}" && ${envPrefix}pm2 start ${ecosystemFile} --only ${appName}`;
      } else {
        // Standalone mode: merge PORT into env if provided
        const envWithPort = port ? { PORT: String(port), ...env } : env;
        const standaloneEnvPrefix = buildEnvPrefix(envWithPort, isWindows);
        command = `cd /d "${winPath}" && ${standaloneEnvPrefix}pm2 start .next\\standalone\\server.js --name ${appName}`;
      }
    }

    const result = await conn.exec(command);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || result.stdout || `PM2 command failed with code ${result.code}`,
      };
    }

    // Save PM2 process list
    await conn.exec("pm2 save");

    return {
      success: true,
      status: appExists
        ? "PM2 reload completed"
        : `PM2 app started${ecosystemFile ? " (using ecosystem.config.js)" : ""}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    conn?.close();
  }
}

/**
 * Check PM2 app status
 */
export async function getAppStatus(
  sshConfig: SSHConfig,
  appName: string
): Promise<PM2Result> {
  let conn: SSHConnection | null = null;

  try {
    conn = await createSSHConnection(sshConfig);

    const result = await conn.exec(`pm2 jlist`);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || "Failed to get PM2 status",
      };
    }

    try {
      const apps = JSON.parse(result.stdout) as Array<{
        name: string;
        pm2_env: { status: string };
      }>;
      const app = apps.find((a) => a.name === appName);

      if (!app) {
        return {
          success: false,
          error: `App "${appName}" not found in PM2`,
        };
      }

      return {
        success: true,
        status: app.pm2_env.status,
      };
    } catch {
      return {
        success: false,
        error: "Failed to parse PM2 output",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    conn?.close();
  }
}

/**
 * Verify PM2 app is running
 */
export async function verifyAppRunning(
  sshConfig: SSHConfig,
  appName: string,
  retries: number = 3,
  delayMs: number = 2000
): Promise<PM2Result> {
  for (let i = 0; i < retries; i++) {
    const status = await getAppStatus(sshConfig, appName);

    if (status.success && status.status === "online") {
      return {
        success: true,
        status: "Application is running",
      };
    }

    // Wait before next retry
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    success: false,
    error: `Application did not start within ${retries} retries`,
  };
}

/**
 * Start PM2 app (for initial deploy)
 */
export async function startApp(
  sshConfig: SSHConfig,
  pm2Config: PM2Config,
  cwd: string
): Promise<PM2Result> {
  const { appName, ecosystem, port, env } = pm2Config;
  let conn: SSHConnection | null = null;

  try {
    conn = await createSSHConnection(sshConfig);

    // Build environment variable prefix (Linux format for startApp)
    const envPrefix = buildEnvPrefix(env, false);

    let command: string;

    if (ecosystem) {
      // Start with ecosystem file - env vars prepended
      command = `cd ${cwd} && ${envPrefix}pm2 start ${ecosystem}`;
    } else {
      // Standalone mode: merge PORT into env if provided
      const envWithPort = port ? { PORT: String(port), ...env } : env;
      const standaloneEnvPrefix = buildEnvPrefix(envWithPort, false);
      command = `cd ${cwd} && ${standaloneEnvPrefix}pm2 start .next/standalone/server.js --name ${appName}`;
    }

    const result = await conn.exec(command);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || `PM2 start failed with code ${result.code}`,
      };
    }

    // Save PM2 process list
    await conn.exec("pm2 save");

    return {
      success: true,
      status: "PM2 app started successfully",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    conn?.close();
  }
}
