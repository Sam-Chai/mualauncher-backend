# MuaLauncher Backend

Next.js App Router + TypeScript project.

## Local development

```powershell
npm run dev
```

Open http://localhost:3000.

## Production on this computer

```powershell
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Stop with Ctrl+C. The background process launched during initial setup is not an auto-start Windows service.

## Install dependencies using the local proxy

```powershell
$env:HTTP_PROXY = 'http://localhost:7897'
$env:HTTPS_PROXY = 'http://localhost:7897'
$env:npm_config_proxy = 'http://localhost:7897'
$env:npm_config_https_proxy = 'http://localhost:7897'
npm ci
```

System fonts are used so builds do not require Google Fonts access.
