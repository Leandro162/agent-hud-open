# Quota panel update channel

The quota panel is independent of the upstream Agent HUD desktop app and uses
only the `quota-panel` branch's `updates/quota-stable.json` manifest. Windows
packages live in immutable `quota-vX.Y.Z` GitHub releases in
`Leandro162/agent-hud-open`.

## User flow

- Launch checks after eight seconds, then every six hours. Checks never install.
- Settings opens a bounded in-window dialog with the running native version and
  a manual check button. It does not increase the main panel height.
- A newer version adds a dot to Settings. The dialog contains plain-text release
  notes and a download/install button. Only that button starts the update.
- The Tauri updater downloads, verifies its signature and signed version, and
  then runs the per-user NSIS installer and restarts the app.
- NSIS receives the current executable directory as its final `/D=` argument.
  This supports the existing portable directory, including paths with spaces.
  Existing external launcher scripts and connection files stay in that folder.
- Failed checks/downloads do not stop the panel or its SSH connection. Errors
  allow retry. A failed signature never reaches the install call.
- A disconnected GitHub channel is an update error, never evidence that the
  app is current. This channel requires outbound HTTPS connectivity.
- The main window defaults to 340 by 500 logical pixels, with a clean ASCII
  title. At startup its bounds are capped to the current monitor work area after
  accounting for display scaling. The window cannot maximize; normal quota and
  balance data fit without scrolling at the default size.

## Release procedure

1. Increment the quota package, Cargo package/lockfile and Tauri configuration
   version together. Push to `quota-panel` and wait for **Quota Windows** to pass.
   CI also exercises the real NSIS updater in a disposable path containing spaces,
   verifying the installed executable and preservation of external files.
2. Download that run's Windows artifact. Rename the installer to
   `agent-hud-quota-X.Y.Z-setup.exe`.
3. From the designated Windows signing account, run:

   ```powershell
   ./src/apps/quota/scripts/Sign-QuotaUpdate.ps1 -Installer <installer> -Version X.Y.Z -Notes '<release notes>'
   ```

   The signer decrypts the designated DPAPI credential only into process memory,
   binds the signature to the release version and independently verifies the
   resulting signature. The private key never enters source control, CI,
   command-line arguments or artifact bundles. `updater.pub` is public.
4. Create the `quota-vX.Y.Z` release at the tested commit and upload the installer,
   `.sig`, portable executable and generated `latest.json`. Do not replace
   already published versioned packages.
5. Download the public installer and verify the signature again. Only then copy
   `latest.json` to `updates/quota-stable.json` and push the manifest commit.
   Verify that the public manifest returns the expected version and download URL.

Changing the embedded public key breaks the update chain for existing users.
Keep the signing credential recoverable in its designated Windows user context.
Never rotate it silently or substitute the unrelated upstream update channel.

## Validation boundaries

`updater-smoke.mjs` tests the UI with mocked native IPC; it covers user consent,
progress, network/verification failure, retry and settings visibility.
`updater.test.mjs` independently exercises signature and signed-version checks.
CI tests the actual Windows installer in a disposable folder. A full end-to-end
desktop upgrade, including restarting the user's SSH-connected panel, still
requires a desktop acceptance test when a newer signed release is available.
