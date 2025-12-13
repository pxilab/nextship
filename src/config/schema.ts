import { z } from "zod";

/**
 * SSH bağlantı ayarları
 */
export const sshConfigSchema = z.object({
  host: z.string().min(1, "SSH host is required"),
  user: z.string().min(1, "SSH user is required"),
  port: z.number().int().positive().default(22),
  privateKeyPath: z.string().optional(),
  privateKey: z.string().optional(),
  password: z.string().optional(),
}).refine(
  (data) => data.privateKeyPath || data.privateKey || data.password,
  { message: "Either privateKeyPath, privateKey, or password must be provided" }
);

/**
 * Build ayarları
 */
export const buildConfigSchema = z.object({
  command: z.string().default("npm run build"),
  standalone: z.boolean().default(true),
  skipBuild: z.boolean().default(false),
});

/**
 * Upload ayarları
 */
export const uploadConfigSchema = z.object({
  remotePath: z.string().min(1, "Remote path is required"),
  exclude: z.array(z.string()).default([
    ".git",
    "node_modules",
    ".env.local",
    ".env*.local",
  ]),
  include: z.array(z.string()).default([
    ".next/standalone/",
    ".next/static/",
    "public/",
    "package.json",
  ]),
  useRsync: z.boolean().default(true),
  rsyncOptions: z.array(z.string()).default(["-avz", "--delete"]),
});

/**
 * PM2 ayarları
 */
export const pm2ConfigSchema = z.object({
  appName: z.string().min(1, "PM2 app name is required"),
  ecosystem: z.string().optional(),
  reload: z.boolean().default(true),
});

/**
 * Ana config schema
 */
export const configSchema = z.object({
  ssh: sshConfigSchema,
  build: buildConfigSchema.default({}),
  upload: uploadConfigSchema,
  pm2: pm2ConfigSchema,
});

export type SSHConfig = z.infer<typeof sshConfigSchema>;
export type BuildConfig = z.infer<typeof buildConfigSchema>;
export type UploadConfig = z.infer<typeof uploadConfigSchema>;
export type PM2Config = z.infer<typeof pm2ConfigSchema>;
export type Config = z.infer<typeof configSchema>;

/**
 * Partial config (env variables ile merge edilecek)
 */
export type PartialConfig = {
  ssh?: Partial<z.input<typeof sshConfigSchema>>;
  build?: Partial<z.input<typeof buildConfigSchema>>;
  upload?: Partial<z.input<typeof uploadConfigSchema>>;
  pm2?: Partial<z.input<typeof pm2ConfigSchema>>;
};
