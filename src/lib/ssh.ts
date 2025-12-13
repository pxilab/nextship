import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import type { SSHConfig } from "../config/schema.js";

export interface SSHConnection {
  client: Client;
  exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>;
  close: () => void;
}

/**
 * SSH bağlantısı oluştur
 */
export async function createSSHConnection(config: SSHConfig): Promise<SSHConnection> {
  const client = new Client();

  const connectConfig: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.user,
    privateKey: config.privateKey,
  };

  return new Promise((resolve, reject) => {
    client.on("ready", () => {
      resolve({
        client,
        exec: (command: string) => execCommand(client, command),
        close: () => client.end(),
      });
    });

    client.on("error", (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    client.connect(connectConfig);
  });
}

/**
 * SSH üzerinden komut çalıştır
 */
function execCommand(
  client: Client,
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        reject(new Error(`SSH exec failed: ${err.message}`));
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("close", (code: number) => {
        resolve({ stdout, stderr, code: code ?? 0 });
      });

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    });
  });
}

/**
 * SSH bağlantısını test et
 */
export async function testConnection(config: SSHConfig): Promise<boolean> {
  try {
    const conn = await createSSHConnection(config);
    const result = await conn.exec("echo 'Connection successful'");
    conn.close();
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Uzak sunucuda komut çalıştır (tek seferlik)
 */
export async function execRemoteCommand(
  config: SSHConfig,
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const conn = await createSSHConnection(config);
  try {
    return await conn.exec(command);
  } finally {
    conn.close();
  }
}
