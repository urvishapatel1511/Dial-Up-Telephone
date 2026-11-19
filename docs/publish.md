# Publishing (GitHub Pages)

- Repository: https://github.com/urvishapatel1511/Ghost_frequency (public, MIT license)
- App URL: https://urvishapatel1511.github.io/Ghost_frequency/

The site is live. Every push to `main` runs `.github/workflows/pages.yml`, which installs, builds, runs every automated test, and publishes `dist/`. A failing test stops the publish.

GitHub Pages provides real HTTPS that phones trust, so the microphone and offline mode work there. The local test server (`npm.cmd run dev:https`) uses a self-signed certificate, so offline mode does not work on it.

## Publishing a new version (you do this; the assistant never pushes)

```powershell
npm.cmd run check        # typecheck, build, all automated tests
git add -A
git commit -m "Describe the change"
git push
```

Then open the repository's **Actions** tab and wait for the green check (about 1–2 minutes). Reload the app URL. If a device was prepared for offline play, tap **📦 Prepare for offline play** again to cache the new version.

> The `.kiro/` folder must stay in the repository (hackathon rule). It is not in `.gitignore`.

## Offline test on real devices

1. With Wi-Fi on, open the app URL on **both** devices.
2. On both, tap **📦 Prepare for offline play** and wait for "✓ Ready for offline play". If it says "reload this page once while online", do that and tap Prepare again. The first visit installs the offline helper, and it takes control after one reload.
3. Turn off **Wi-Fi and Bluetooth** on both.
4. **Reload** the page on both. The game must load.
5. Play a full game (`docs/hardware-test.md`) and log it in `docs/hardware-log.md`.
