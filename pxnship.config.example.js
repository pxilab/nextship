/**
 * PXI NextShip Configuration (v0.3.0)
 *
 * Copy this file to pxnship.config.js and update with your settings.
 * Environment variables can override these values.
 */

export default {
  // SSH Connection
  ssh: {
    host: process.env.SSH_HOST || "server.example.com",
    user: process.env.SSH_USER || "deploy",
    port: 22,
    // Authentication - use ONE of the following:
    privateKeyPath: "~/.ssh/id_ed25519",
    // privateKey: process.env.SSH_KEY,  // For CI/CD (inline key)
    // password: process.env.SSH_PASSWORD,  // Password auth (uses SFTP for upload)
  },

  // Build Settings
  build: {
    command: "bun run build",  // or: npm run build, yarn build, pnpm build
    standalone: true,          // Requires output: 'standalone' in next.config.js
    skipBuild: false,          // Set to true to skip build step
    prepareLocally: true,      // Copy public/ and static/ into standalone locally (recommended)
  },

  // Upload Settings
  upload: {
    remotePath: "/var/www/myapp",
    exclude: [
      ".git",
      "node_modules",
      ".env.local",
      ".env*.local",
    ],
    // prepareLocally: true (default) - only .next/standalone/ needed
    include: [
      ".next/standalone/",
      // "ecosystem.config.js",  // Add if using PM2 ecosystem file
      // "web.config",           // Add for IIS deployments
    ],
    useRsync: true,  // Falls back to SFTP if rsync not available
  },

  // PM2 Settings
  pm2: {
    appName: "myapp",
    ecosystem: true,  // true = auto-detect, false = don't use, "filename.js" = specific
    reload: true,     // Use reload instead of restart (zero-downtime)
    // port: 3000,    // Used when ecosystem is false

    // Environment variables injected when PM2 starts/reloads
    // env: {
    //   NODE_ENV: "production",
    //   API_BASE_URL: process.env.API_BASE_URL,
    //   DATABASE_URL: process.env.DATABASE_URL,
    // },
  },
};
