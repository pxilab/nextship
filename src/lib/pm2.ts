import { createSSHConnection, type SSHConnection } from "./ssh.js";
import type { SSHConfig, PM2Config } from "../config/schema.js";

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
  const { appName, ecosystem, reload, port } = pm2Config;
  let conn: SSHConnection | null = null;

  try {
    conn = await createSSHConnection(sshConfig);

    // Convert WSL path to Windows path
    const winPath = remotePath
      ? remotePath.replace(/^\/mnt\/([a-z])\//, "$1:\\\\").replace(/\//g, "\\")
      : "";

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
      // Reload or restart command
      const action = reload ? "reload" : "restart";
      const target = ecosystemFile || appName;
      command = `pm2 ${action} ${target} --update-env`;
    } else {
      // App doesn't exist, start it
      if (!remotePath) {
        return {
          success: false,
          error: `App "${appName}" not found and no remotePath provided to start it`,
        };
      }

      if (ecosystemFile) {
        // Use ecosystem file to start
        command = `cd /d "${winPath}" && pm2 start ${ecosystemFile} --only ${appName}`;
      } else {
        // Fallback to standalone server.js with optional port
        const portEnv = port ? ` --env PORT=${port}` : "";
        command = `cd /d "${winPath}" && pm2 start .next\\standalone\\server.js --name ${appName}${portEnv}`;
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
  const { appName, ecosystem, port } = pm2Config;
  let conn: SSHConnection | null = null;

  try {
    conn = await createSSHConnection(sshConfig);

    let command: string;

    if (ecosystem) {
      // Start with ecosystem file
      command = `cd ${cwd} && pm2 start ${ecosystem}`;
    } else {
      // Start with standalone server with optional port
      const portEnv = port ? ` --env PORT=${port}` : "";
      command = `cd ${cwd} && pm2 start .next/standalone/server.js --name ${appName}${portEnv}`;
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
