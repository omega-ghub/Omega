# Signing the installers

Unsigned installers trigger **Windows SmartScreen** ("Windows protected your PC") and
**macOS Gatekeeper** ("cannot be opened because the developer cannot be verified").
Only a code-signing certificate tied to a verified identity removes them. CI is already
wired: `scripts/dist.mjs` signs automatically when the secrets below exist, and builds
unsigned when they don't, so nothing breaks before you have certificates.

Linux (AppImage / .deb) shows no equivalent warning and needs nothing.

## Windows — Azure Trusted Signing (~US$10/month)

1. Create an Azure account and subscription, then a **Trusted Signing account** in the
   Azure portal. Pick the region closest to you and note its endpoint
   (e.g. `https://eus.codesigning.azure.net/` for East US).
2. Complete **identity validation** (Individual or Organization). Individuals need a
   government photo ID and matching proof of address; Microsoft limits which countries
   are eligible, so check the current list in the portal.
3. Create a **Public Trust certificate profile**.
4. In Entra ID, create an **app registration** and a client secret. Give it the
   *Trusted Signing Certificate Profile Signer* role on the signing account.
5. In GitHub → Settings → Secrets and variables → Actions, add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `AZURE_TENANT_ID` | Directory (tenant) ID |
   | Secret | `AZURE_CLIENT_ID` | Application (client) ID |
   | Secret | `AZURE_CLIENT_SECRET` | the client secret value |
   | Variable | `AZURE_SIGN_ENDPOINT` | region endpoint from step 1 |
   | Variable | `AZURE_SIGN_ACCOUNT` | Trusted Signing account name |
   | Variable | `AZURE_SIGN_PROFILE` | certificate profile name |
   | Variable | `AZURE_SIGN_PUBLISHER` | publisher name exactly as on the certificate |

SmartScreen also uses download reputation, so the very first signed releases can still
show a prompt for a short time. It stops as people download and run them.

## macOS — Apple Developer Program (US$99/year)

1. Enroll at developer.apple.com (as an individual or an organization, which needs a D-U-N-S number).
2. Create a **Developer ID Application** certificate, export it from Keychain as a
   `.p12` with a password, and base64 it: `base64 -i cert.p12 | pbcopy`.
3. In App Store Connect → Users and Access → Integrations, create an **API key**
   (Developer role). Download the `.p8` and note the Key ID and Issuer ID.
4. Add GitHub secrets:

   | Secret | Value |
   | --- | --- |
   | `MAC_CSC_LINK` | base64 of the `.p12` |
   | `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
   | `APPLE_API_KEY_P8` | full text of the `.p8` file |
   | `APPLE_API_KEY_ID` | Key ID |
   | `APPLE_API_ISSUER` | Issuer ID |

With these set, the next CI run signs **and** notarizes the `.dmg`.

## Checking a build

The build log prints one line per platform, e.g.
`[dist] Windows: signing with Azure Trusted Signing` or
`[dist] Windows: UNSIGNED build (missing …)`, and that line says which secrets are missing.

Never paste certificates, passwords or keys into chat or commit them. They only go
into GitHub secrets.
