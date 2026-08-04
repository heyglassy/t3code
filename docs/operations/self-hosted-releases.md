# Self-hosted releases

This fork releases only the macOS desktop app, the iOS mobile app, and the T3 server package. It does not deploy T3 Connect or the marketing site.

## Identities

- GitHub: `heyglassy/t3code`
- Expo: `@heyglassy/glassycode`
- Expo project ID: `db3acf67-23d1-4dcc-b1b4-cc6ab94a2efc`
- Apple team: `GB5QY3D3Y5`
- iOS bundle ID: `com.heyglassy.glassycode`
- macOS bundle ID: `com.heyglassy.glassycode`
- npm package: `@heyglassy/t3` (the installed command remains `t3`)

## GitHub configuration

Create a GitHub Environment named `releases`. Put release credentials in that environment so pull-request workflows cannot read them.

Environment secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CSC_LINK`: base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD`: password for the `.p12`
- `APPLE_API_KEY`: App Store Connect API `.p8` contents
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `EXPO_TOKEN`
- `NPM_TOKEN`: needed only to bootstrap the first npm publication; remove it after npm trusted publishing is configured

Environment variables:

- `AWS_REGION=auto`
- `AWS_ENDPOINT_URL_S3=https://t3.storage.dev`
- `APPLE_TEAM_ID=GB5QY3D3Y5`
- `DESKTOP_UPDATE_BUCKET=cgt3code`
- `DESKTOP_UPDATE_PREFIX=desktop`
- `DESKTOP_UPDATE_BASE_URL`: the bucket's public HTTPS URL ending in `/desktop`

The Tigris key needs read and write access to `cgt3code/desktop`. Credentials are used only by GitHub Actions and must never be compiled into an app.

## Desktop releases

Run **Glassycode Desktop Release** from GitHub Actions.

- `build` creates an Apple Silicon application, signs and notarizes it, uploads immutable artifacts to S3, archives its update manifest under `releases/<version>/`, and points the selected channel at it.
- `promote` copies an archived manifest back to the mutable channel without rebuilding. This is the rollback/version-swap operation.
- `production` uses `latest-mac.yml`.
- `candidate` uses `nightly-mac.yml` internally. The desktop settings UI presents these as Production and Candidate.

After a successful `build`, the workflow automatically appends the shipped
desktop version to `release-catalog.json` on `main`. The catalog entry records
the built version, source commit, source branch, channel, desktop platform,
build ID, and update ID. The update is schema-validated, deduplicated by its
derived ID, sorted newest-first, and committed with a fetch/retry loop so
parallel releases do not overwrite one another. A `promote` action only moves
the mutable update-channel manifest and does not create a new catalog entry.

The catalog publisher can also be run locally for a verified backfill or
repair:

```bash
node scripts/update-release-catalog.ts \
  --version 1.2.3 \
  --commit-sha <full-commit-sha> \
  --channel stable \
  --build-id desktop-1.2.3 \
  --update-id stable-1.2.3 \
  --platform desktop \
  --branch main \
  --generated-at 2026-08-04T02:20:49.000Z
```

The `desktop` prefix must be readable over HTTPS so Electron can fetch its manifests and artifacts. Give immutable artifacts a long cache lifetime and leave channel manifests uncached; the workflow sets appropriate object cache headers.

## Mobile releases

The production EAS profile creates a private ad-hoc iOS build. Install it from the EAS internal-distribution link after registering the iPhone with Expo.

Run **Mobile EAS Production** from GitHub Actions:

- `build` starts a private iOS EAS build.
- `update` publishes a compatible OTA to either `production` or `candidate`.
- `rollback` republishes the update preceding the supplied latest update-group ID.

In the production app, open Settings → App → Release Channel to switch between Production and Candidate. Expo persists the request-header override across launches. OTA updates remain constrained to a matching native runtime fingerprint; native dependency or entitlement changes require a new build.

## Server releases

Run **Glassycode Server Release** from GitHub Actions. Production publishes the npm `latest` tag and candidate publishes the npm `candidate` tag.

```bash
npx @heyglassy/t3
npx @heyglassy/t3@candidate
npx @heyglassy/t3@1.2.3
```

After the first token-authenticated publication, configure npm trusted publishing for `heyglassy/t3code`, workflow `server-release.yml`, and environment `releases`. Then delete the `NPM_TOKEN` GitHub secret and revoke its npm token.
