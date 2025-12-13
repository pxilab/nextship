import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { configSchema, type Config, type PartialConfig } from "./schema.js";

// .env dosyasını yükle
loadEnv();

const CONFIG_FILES = [
  "pxnship.config.js",
  "pxnship.config.mjs",
  "pxnship.config.ts",
  ".pxnshiprc",
  ".pxnshiprc.json",
];

/**
 * ~ karakterini home directory ile değiştir
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    return join(homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Config dosyasını bul
 */
function findConfigFile(cwd: string): string | null {
  for (const file of CONFIG_FILES) {
    const filePath = join(cwd, file);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Config dosyasını oku ve parse et
 */
async function loadConfigFile(filePath: string): Promise<PartialConfig> {
  const ext = filePath.split(".").pop();

  if (ext === "json" || filePath.endsWith("rc")) {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as PartialConfig;
  }

  // JS/MJS/TS dosyaları için dynamic import
  const fileUrl = pathToFileURL(resolve(filePath)).href;
  const module = await import(fileUrl);
  return (module.default || module) as PartialConfig;
}

/**
 * Environment variable'lardan config oluştur
 */
function getEnvConfig(): PartialConfig {
  const env = process.env;

  // SSH key'i oku (SSH_KEY veya SSH_KEY_PATH)
  let privateKey: string | undefined;
  let privateKeyPath: string | undefined;

  if (env.SSH_KEY) {
    privateKey = env.SSH_KEY;
  } else if (env.SSH_KEY_PATH) {
    privateKeyPath = expandTilde(env.SSH_KEY_PATH);
  } else if (env.SSH_PRIVATE_KEY) {
    // GitHub Actions compatibility
    privateKey = env.SSH_PRIVATE_KEY;
  }

  return {
    ssh: {
      host: env.SSH_HOST,
      user: env.SSH_USER,
      port: env.SSH_PORT ? Number.parseInt(env.SSH_PORT, 10) : undefined,
      privateKey,
      privateKeyPath,
    },
    build: {
      command: env.BUILD_COMMAND,
      standalone: env.STANDALONE !== "false",
      skipBuild: env.SKIP_BUILD === "true",
    },
    upload: {
      remotePath: env.REMOTE_PATH,
    },
    pm2: {
      appName: env.PM2_APP_NAME,
      ecosystem: env.PM2_ECOSYSTEM,
    },
  };
}

/**
 * İki config objesini deep merge et
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue === undefined || sourceValue === null) {
      continue;
    }

    if (
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Undefined değerleri filtrele
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const filtered = filterUndefined(value as Record<string, unknown>);
      if (Object.keys(filtered).length > 0) {
        result[key as keyof T] = filtered as T[keyof T];
      }
    } else {
      result[key as keyof T] = value as T[keyof T];
    }
  }

  return result;
}

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
}

/**
 * Config'i yükle ve validate et
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<Config> {
  const cwd = options.cwd || process.cwd();
  let fileConfig: PartialConfig = {};

  // Config dosyasını bul ve yükle
  const configPath = options.configPath || findConfigFile(cwd);

  if (configPath && existsSync(configPath)) {
    try {
      fileConfig = await loadConfigFile(configPath);
    } catch (error) {
      throw new Error(
        `Failed to load config file: ${configPath}\n${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Env config'i al
  const envConfig = filterUndefined(getEnvConfig()) as PartialConfig;

  // Merge: file config + env config (env öncelikli)
  const mergedConfig = deepMerge(
    fileConfig as Record<string, unknown>,
    envConfig as Record<string, unknown>
  ) as PartialConfig;

  // SSH key path'i genişlet
  if (mergedConfig.ssh?.privateKeyPath) {
    mergedConfig.ssh.privateKeyPath = expandTilde(mergedConfig.ssh.privateKeyPath);
  }

  // Private key'i dosyadan oku (eğer path verilmişse)
  if (mergedConfig.ssh?.privateKeyPath && !mergedConfig.ssh?.privateKey) {
    const keyPath = mergedConfig.ssh.privateKeyPath;
    if (existsSync(keyPath)) {
      mergedConfig.ssh.privateKey = readFileSync(keyPath, "utf-8");
    } else {
      throw new Error(`SSH private key file not found: ${keyPath}`);
    }
  }

  // Zod ile validate et
  const result = configSchema.safeParse(mergedConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}

/**
 * Config dosyası var mı kontrol et
 */
export function hasConfigFile(cwd: string = process.cwd()): boolean {
  return findConfigFile(cwd) !== null;
}
