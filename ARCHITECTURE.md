# PXI NextShip - Architecture Document

Next.js deployment tool that builds, uploads via SSH, and restarts PM2.

## Naming

| Usage | Name |
|-------|------|
| **Project** | PXI NextShip |
| **Repo** | `nextship` |
| **npm Package** | `@pxilab/nextship` |
| **CLI Command** | `pxnship` |

## Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PXI NextShip Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   [Local/CI]                                         [Production]       │
│                                                                         │
│   ┌─────────┐     ┌──────────┐     ┌────────┐      ┌─────────────┐     │
│   │  Build  │────▶│  Upload  │────▶│  SSH   │─────▶│   Server    │     │
│   │ Next.js │     │ (rsync)  │     │        │      │  (PM2)      │     │
│   └─────────┘     └──────────┘     └────────┘      └─────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tool Distribution

PXI NextShip will be distributed via **GitHub Packages npm registry**:

```bash
# Install (npm)
npm install -g @pxilab/nextship

# Install (bun)
bun add -g @pxilab/nextship

# Or run directly
npx @pxilab/nextship ship
bunx @pxilab/nextship ship
```

---

## Usage Scenarios

### 1. CLI Script (Local/CI Deployment)
```bash
# Run all steps at once
npx @pxilab/nextship ship   # npm
bunx @pxilab/nextship ship  # bun

# Or after global installation
pxnship ship

# Individual steps
pxnship build
pxnship upload
pxnship restart
```

### 2. GitHub Actions
```yaml
- name: Deploy
  run: npx @pxilab/nextship ship
  env:
    SSH_HOST: ${{ secrets.SSH_HOST }}
    SSH_USER: ${{ secrets.SSH_USER }}
    SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
    PM2_APP_NAME: myapp
```

---

## Architecture

### Project Structure

```
nextship/
├── src/
│   ├── index.ts              # Main entry point
│   ├── cli.ts                # CLI commands
│   ├── commands/
│   │   ├── build.ts          # next build
│   │   ├── upload.ts         # rsync/scp
│   │   ├── restart.ts        # pm2 reload
│   │   └── ship.ts           # Run all commands
│   ├── lib/
│   │   ├── ssh.ts            # SSH connection handler
│   │   ├── rsync.ts          # Rsync wrapper
│   │   └── pm2.ts            # PM2 remote commands
│   ├── config/
│   │   ├── loader.ts         # Config file reader
│   │   └── schema.ts         # Zod validation
│   └── utils/
│       ├── logger.ts         # Console output
│       └── spinner.ts        # Progress indicator
│
├── package.json
├── tsconfig.json
├── tsup.config.ts            # Build config
└── README.md
```

---

## Deployment Flow (Detailed)

### Step 1: Build
```typescript
// commands/build.ts
async function build(config: Config): Promise<void> {
  // 1. Check if build script exists in package.json
  // 2. Run npm run build / yarn build / pnpm build / bun run build
  // 3. Verify .next folder was created
  // 4. Check standalone mode (recommended)
}
```

**Next.js Standalone Mode (Recommended)**
```javascript
// next.config.js
module.exports = {
  output: 'standalone',
}
```
- Smaller deploy size
- No node_modules needed
- Only required files

### Step 2: Upload (rsync)
```typescript
// commands/upload.ts
async function upload(config: Config): Promise<void> {
  // Transfer files with rsync
  // -avz --delete --exclude='.git' --exclude='node_modules'

  const filesToUpload = [
    '.next/standalone/',
    '.next/static/',
    'public/',
    'package.json',
  ];
}
```

**Rsync Advantages:**
- Delta transfer (only changed files)
- Compression
- --delete removes old files

### Platform Support

| Target Platform | Transfer Method | Speed |
|-----------------|-----------------|-------|
| Linux/macOS | rsync | ✅ Fast (delta transfer) |
| Windows + WSL | rsync via WSL | ✅ Fast (delta transfer) |
| Windows (no rsync) | SFTP fallback | ⚠️ Slower (full file transfer) |

**Windows Server Note:**
For optimal performance on Windows targets, WSL + rsync is **recommended**:

```powershell
# Install WSL and rsync on Windows Server
wsl --install -d Ubuntu
wsl sudo apt update && sudo apt install rsync -y
```

Without rsync, the tool will automatically fall back to SFTP which works but transfers entire files instead of just changes.

### Step 3: PM2 Restart
```typescript
// commands/restart.ts
async function restart(config: Config): Promise<void> {
  // Connect via SSH
  // pm2 reload <app-name> --update-env
  // Health check (optional)
}
```

---

## Configuration

### pxnship.config.js (or .pxnshiprc)
```javascript
module.exports = {
  // SSH Connection
  ssh: {
    host: process.env.SSH_HOST,
    user: process.env.SSH_USER,
    port: 22,
    privateKeyPath: '~/.ssh/id_ed25519', // or SSH_KEY env
  },

  // Build
  build: {
    command: 'bun run build',        // or npm/yarn/pnpm
    standalone: true,                 // use standalone mode
  },

  // Upload
  upload: {
    remotePath: '/var/www/myapp',
    exclude: [
      '.git',
      'node_modules',
      '.env.local',
    ],
  },

  // PM2
  pm2: {
    appName: 'myapp',
    // or ecosystem file
    ecosystem: 'ecosystem.config.js',
  },
};
```

### Environment Variables (for CI/CD)
```bash
# Required
SSH_HOST=server.example.com
SSH_USER=deploy
SSH_KEY=<private-key-content>    # or SSH_KEY_PATH

# Optional
SSH_PORT=22
REMOTE_PATH=/var/www/myapp
PM2_APP_NAME=myapp
```

---

## CLI Commands

```bash
# Run all steps (build → upload → restart)
pxnship ship

# Build only
pxnship build

# Upload only (pre-built project)
pxnship upload

# PM2 restart only
pxnship restart

# Dry-run (show what would happen)
pxnship ship --dry-run

# Verbose output
pxnship ship --verbose

# Custom config file
pxnship ship --config ./deploy.config.js
```

---

## GitHub Actions Workflow Examples

### .github/workflows/deploy.yml (bun)
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Deploy with PXI NextShip
        run: bunx @pxilab/nextship ship
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
          SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          PM2_APP_NAME: myapp
          REMOTE_PATH: /var/www/myapp
```

### .github/workflows/deploy.yml (npm)
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Deploy with PXI NextShip
        run: npx @pxilab/nextship ship
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
          SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          PM2_APP_NAME: myapp
          REMOTE_PATH: /var/www/myapp
```

---

## Publishing to GitHub Packages

### package.json
```json
{
  "name": "@pxilab/nextship",
  "version": "0.1.0",
  "description": "Next.js deployment tool - Build, SSH upload, PM2 restart",
  "bin": {
    "pxnship": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/pxilab/nextship.git"
  }
}
```

### Publish Workflow
```yaml
# .github/workflows/publish.yml
name: Publish Package

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'

      - run: bun install
      - run: bun run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Installing the Package
```bash
# .npmrc (project root)
@pxilab:registry=https://npm.pkg.github.com

# Install (npm)
npm install -g @pxilab/nextship

# Install (bun)
bun add -g @pxilab/nextship
```

---

## Server-Side Setup

### Recommended Directory Structure
```
/var/www/myapp/
├── .next/
│   ├── standalone/
│   └── static/
├── public/
├── package.json
└── ecosystem.config.js
```

### ecosystem.config.js (PM2)
```javascript
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

### Initial Setup (on server)
```bash
# Install PM2 globally
npm install -g pm2

# Create app directory
mkdir -p /var/www/myapp
chown deploy:deploy /var/www/myapp

# Start PM2 (after first deploy)
cd /var/www/myapp
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",      // CLI framework
    "ssh2": "^1.15.0",           // SSH connection
    "ora": "^8.0.0",             // Spinner
    "chalk": "^5.3.0",           // Colored output
    "zod": "^3.22.0",            // Config validation
    "execa": "^8.0.0",           // Shell commands
    "dotenv": "^16.3.0"          // Env loading
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsup": "^8.0.0",            // Build tool
    "@types/ssh2": "^1.11.0",
    "@types/node": "^20.0.0"
  }
}
```

---

## Security

1. **SSH Key**
   - Ed25519 key recommended
   - No passphrase (for CI) or use ssh-agent
   - Store securely in GitHub Secrets

2. **Server Access**
   - Dedicated deploy user
   - Write permissions only in required directories
   - SSH key-only authentication

3. **Sensitive Data**
   - .env files in upload exclude list
   - Manage separately on server

---

## Development Roadmap

### Phase 1: Core (MVP)
- [x] CLI scaffolding (citty)
- [x] Config loader (Zod validation + env support)
- [x] Build command (execa with bun/npm run build)
- [x] SSH connection (ssh2 with key + password auth)
- [x] Upload command (rsync + SFTP fallback)
- [x] PM2 restart command

### Phase 2: Polish
- [x] Dry-run mode
- [x] Verbose logging
- [x] Error handling
- [x] Health check (verifyAppRunning)
- [ ] Rollback on failure

### Phase 3: Publish
- [x] TypeScript build setup (tsup)
- [x] GitHub Packages publish workflow
- [x] README & documentation

### Phase 4: Extras
- [ ] Zero-downtime (symlink strategy)
- [ ] Rollback command
- [ ] Notifications (Slack/Discord webhook)
- [ ] Multiple environment support (staging/prod)

---

## Example Usage Flow

```bash
# 1. Install the tool
bun add -g @pxilab/nextship   # or npm install -g

# 2. Add config to project
# create pxnship.config.js

# 3. Deploy
pxnship ship

# Output:
# ✔ Building Next.js application...
# ✔ Connecting to server.example.com...
# ✔ Uploading files (234 MB → 45 MB compressed)...
# ✔ Restarting PM2 process 'myapp'...
# ✔ Deployment complete!
```
