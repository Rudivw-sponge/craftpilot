# Releasing a new version

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a version tag is
pushed. Nothing is built or uploaded by hand.

## Steps

1. **Bump the version in both places.** They must match:
   - `package.json` → `version` (`npm pkg set version=0.3.1`)
   - `plugin/.claude-plugin/plugin.json` → `version`

   Claude Code only updates an installed plugin when this version changes, so a release that
   forgets `plugin.json` never reaches plugin users.
2. **Add an entry at the top of `CHANGELOG.md`.**
3. **If dependencies changed,** regenerate the notices: `node scripts/third-party-notices.js`.
4. **Check locally:**
   ```bash
   node scripts/check-version.js v0.3.1
   npm run dist
   ```
   Then try the new build from `dist/` before publishing it.
5. **Commit, push, then tag:**
   ```bash
   git push origin main
   git tag -a v0.3.1 -m "CraftPilot 0.3.1"
   git push origin v0.3.1
   ```
6. **Watch the build** under the repository's **Actions** tab. It takes about 3 minutes. When it
   succeeds, the installer and the portable exe are attached to a new Release, with notes
   generated from the commits since the previous release.

## What the workflow checks

- `scripts/check-version.js` stops the build if the tag, `package.json` and `plugin.json` don't
  carry the same version.
- `npm run dist` must succeed on a clean `npm ci` install.

## Things to keep

- **`--publish never` in the `dist` script.** On a tag, electron-builder otherwise tries to
  publish to GitHub itself and fails, because it has no token. The workflow's
  `action-gh-release` step does the publishing.
- **The `!node_modules/@anthropic-ai/claude-agent-sdk-*/**` exclusion in `build.files`.** It
  keeps the SDK's own ~260 MB copy of Claude Code out of the app. CraftPilot uses the installed
  Claude Code.
- **`"asarUnpack": ["plugin/**"]`.** The app starts plugin scripts as separate processes and
  passes the plugin folder to Claude Code, and neither works from inside `app.asar`.

## If a build fails

Open the failed run in the **Actions** tab to see the log (it needs a GitHub login). To
reproduce a tag build on your PC, set the same environment variables GitHub sets:

```bash
CI=true GITHUB_ACTIONS=true GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v0.3.1 npm run dist
```

To rebuild the same version after a fix, push the fix and move the tag, as long as nobody has
downloaded the release yet. Otherwise release a new patch version.

```bash
git tag -d v0.3.1 && git push origin :refs/tags/v0.3.1
git tag -a v0.3.1 -m "CraftPilot 0.3.1" && git push origin v0.3.1
```
