/**
 * PXI NextShip Configuration
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
    // Use one of the following:
    privateKeyPath: "~/.ssh/id_ed25519",
    // privateKey: process.env.SSH_KEY,  // For CI/CD (inline key)
  },

  // Build Settings
  build: {
    command: "bun run build",  // or: npm run build, yarn build, pnpm build
    standalone: true,          // Requires output: 'standalone' in next.config.js
    skipBuild: false,          // Set to true to skip build step
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
    include: [
      ".next/standalone/",
      ".next/static/",
      "public/",
      "package.json",
    ],
    useRsync: true,  // Falls back to SFTP if rsync not available
  },

  // PM2 Settings
  pm2: {
    appName: "myapp",
    // ecosystem: "ecosystem.config.js",  // Optional: use ecosystem file
    reload: true,  // Use reload instead of restart (zero-downtime)
  },
};
