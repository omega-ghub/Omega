// Packages installers with electron-builder, signing them when credentials exist.
//
//   node scripts/dist.mjs win|mac|linux
//
// Unsigned builds still work (local dev, forks, CI without secrets). When the
// signing secrets below are present in the environment, the same command signs:
//
// Windows: Azure Trusted Signing (Microsoft's cloud signing service).
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   (app registration)
//   AZURE_SIGN_ENDPOINT        e.g. https://eus.codesigning.azure.net/
//   AZURE_SIGN_ACCOUNT         Trusted Signing account name
//   AZURE_SIGN_PROFILE         certificate profile name
//   AZURE_SIGN_PUBLISHER       publisher name, exactly as on the certificate
//
// macOS: Developer ID certificate + Apple notarization.
//   CSC_LINK, CSC_KEY_PASSWORD               base64 .p12 of "Developer ID Application" + password
//   APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER   App Store Connect API key (notarization)
//     (APPLE_API_KEY is a path to the .p8 file; CI writes it from a secret)
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const platform = process.argv[2]
if (!['win', 'mac', 'linux'].includes(platform)) {
  console.error('usage: node scripts/dist.mjs win|mac|linux')
  process.exit(2)
}

const env = { ...process.env }
// CI passes unset secrets as empty strings; electron-builder treats an empty
// CSC_LINK / APPLE_* as "provided" and fails, so drop them entirely.
for (const k of Object.keys(env)) {
  if (/^(CSC_|WIN_CSC_|APPLE_|AZURE_)/.test(k) && env[k].trim() === '') delete env[k]
}
const has = (...keys) => keys.every((k) => env[k] && env[k].trim() !== '')
const args = [`--${platform}`, '--publish', 'never']

if (platform === 'win') {
  const azure = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
    'AZURE_SIGN_ENDPOINT', 'AZURE_SIGN_ACCOUNT', 'AZURE_SIGN_PROFILE', 'AZURE_SIGN_PUBLISHER']
  if (has(...azure)) {
    args.push(
      `-c.win.azureSignOptions.endpoint=${env.AZURE_SIGN_ENDPOINT}`,
      `-c.win.azureSignOptions.codeSigningAccountName=${env.AZURE_SIGN_ACCOUNT}`,
      `-c.win.azureSignOptions.certificateProfileName=${env.AZURE_SIGN_PROFILE}`,
      `-c.win.azureSignOptions.publisherName=${env.AZURE_SIGN_PUBLISHER}`,
    )
    console.log('[dist] Windows: signing with Azure Trusted Signing')
  } else {
    const missing = azure.filter((k) => !has(k))
    console.log(`[dist] Windows: UNSIGNED build (missing ${missing.join(', ')})`)
  }
}

if (platform === 'mac') {
  if (has('CSC_LINK', 'CSC_KEY_PASSWORD')) {
    console.log('[dist] macOS: signing with Developer ID certificate')
    if (has('APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER')) {
      console.log('[dist] macOS: notarizing with App Store Connect API key')
    } else {
      console.log('[dist] macOS: signed but NOT notarized (Gatekeeper will still warn)')
    }
  } else {
    // Without a certificate, stop electron-builder hunting the keychain.
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    console.log('[dist] macOS: UNSIGNED build (missing CSC_LINK / CSC_KEY_PASSWORD)')
  }
}

if (platform !== 'mac' && !has('CSC_LINK')) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

// Run the CLI through node directly (no shell), so values with spaces survive on Windows.
let cli
try {
  cli = createRequire(import.meta.url).resolve('electron-builder/cli.js')
} catch {
  cli = fileURLToPath(new URL('../node_modules/electron-builder/cli.js', import.meta.url))
}
const r = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env })
process.exit(r.status ?? 1)
