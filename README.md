# PXI NextShip

Next.js deployment tool - Build, SSH upload, PM2 restart.

## Installation

```bash
# npm
npm install -g @pxilab/nextship

# bun
bun add -g @pxilab/nextship

# Or run directly
npx @pxilab/nextship ship
bunx @pxilab/nextship ship
```

## Quick Start

1. **Configure your Next.js project for standalone output:**

```js
// next.config.js
module.exports = {
  output: 'standalone',
}
```

2. **Create a config file:**

```bash
cp pxnship.config.example.js pxnship.config.js
```

3. **Deploy:**

```bash
pxnship ship
```

## Usage

```bash
# Full deployment (build → upload → restart)
pxnship ship

# Individual steps
pxnship build      # Build Next.js application
pxnship upload     # Upload files to server
pxnship restart    # Restart PM2 application

# Options
pxnship ship --dry-run      # Preview without making changes
pxnship ship --skip-build   # Skip build step (use existing build)
pxnship ship --verbose      # Enable detailed output
pxnship ship --config ./custom-config.js  # Use custom config file
```

## Configuration

### Config File

Create `pxnship.config.js` in your project root:

```js
export default {
  ssh: {
    host: "server.example.com",
    user: "deploy",
    port: 22,
    privateKeyPath: "~/.ssh/id_ed25519",
  },

  build: {
    command: "bun run build",
    standalone: true,
  },

  upload: {
    remotePath: "/var/www/myapp",
    exclude: [".git", "node_modules", ".env.local"],
  },

  pm2: {
    appName: "myapp",
    reload: true,
  },
};
```

### Environment Variables

PXI NextShip loads environment files in the following order (later files override earlier ones):

1. `.env` - Base environment variables
2. `.env.local` - Local overrides (add to `.gitignore`)

```bash
# .env.local (recommended for local development)
SSH_HOST=server.example.com
SSH_USER=deploy
SSH_PASSWORD=your-password

# Or use SSH key
SSH_KEY_PATH=~/.ssh/id_ed25519
```

**Available Variables:**

```bash
# Required
SSH_HOST=server.example.com
SSH_USER=deploy

# Authentication (use one)
SSH_KEY=<private-key-content>    # Inline private key (for CI/CD)
SSH_KEY_PATH=~/.ssh/id_ed25519   # Path to private key file
SSH_PASSWORD=<password>          # Password auth

# Optional
SSH_PORT=22
REMOTE_PATH=/var/www/myapp
PM2_APP_NAME=myapp
BUILD_COMMAND="bun run build"
```

## GitHub Actions

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - name: Deploy
        run: bunx @pxilab/nextship ship
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
          SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          PM2_APP_NAME: myapp
          REMOTE_PATH: /var/www/myapp
```

## Server Setup

### Directory Structure

```
/var/www/myapp/
├── .next/
│   ├── standalone/
│   └── static/
├── public/
├── package.json
└── ecosystem.config.js  # Optional
```

### PM2 Ecosystem File (Optional)

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'myapp',
    script: '.next/standalone/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
```

### Initial Server Setup

```bash
# Install PM2
npm install -g pm2

# Create directory
mkdir -p /var/www/myapp
chown deploy:deploy /var/www/myapp

# After first deploy
cd /var/www/myapp
pm2 start ecosystem.config.js  # or: pm2 start .next/standalone/server.js --name myapp
pm2 save
pm2 startup
```

## Platform Support

| Platform | Transfer Method | Performance |
|----------|-----------------|-------------|
| Linux / macOS | rsync | Fast (delta transfer) |
| Windows + WSL | rsync via WSL | Fast (delta transfer) |
| Windows (no rsync) | SFTP fallback | Slower (full file transfer) |

### Windows Server Recommendation

For optimal performance on Windows servers, install WSL + rsync:

```powershell
wsl --install -d Ubuntu
wsl sudo apt update && sudo apt install rsync -y
```

Without rsync, the tool automatically falls back to SFTP.

## Programmatic API

```typescript
import { loadConfig, runShip, runBuild, runUpload, runRestart } from '@pxilab/nextship';

const config = await loadConfig();

// Full deployment
await runShip(config);

// Or individual steps
await runBuild(config.build);
await runUpload(config.ssh, config.upload);
await runRestart(config.ssh, config.pm2);
```

## License

MIT
