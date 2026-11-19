# Publish the game on GitHub Pages

The hackathon requires a **public GitHub repo** and a **working app URL**. GitHub Pages provides both, with real HTTPS. Phones trust that certificate, so the microphone and offline mode both work there. They don't fully work on the test server.

Once set up, every push to `main` builds the game, runs all tests, and publishes it automatically (`.github/workflows/pages.yml`).

## One-time setup (about 10 minutes)

1. **Create a GitHub account** at https://github.com if you don't have one.
2. **Tell Git who you are** (in the Kiro terminal, using your own name and the email of your GitHub account):
   ```powershell
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```
3. **Create an empty public repository** on GitHub: click **New**, name it `ghost-frequency`, choose **Public**, and don't add a README or license (we already have them). Click **Create repository**.
4. **Upload the project** (replace `YOUR-USERNAME`):
   ```powershell
   git init -b main
   git add .
   git commit -m "Ghost Frequency: first playable version"
   git remote add origin https://github.com/YOUR-USERNAME/ghost-frequency.git
   git push -u origin main
   ```
   The first push opens a browser window to sign in to GitHub.
5. **Turn on Pages:** in the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
6. Open the **Actions** tab and wait for the green check (about 2 minutes). Your game is now live at
   `https://YOUR-USERNAME.github.io/ghost-frequency/`
7. In the repo's **About** box (gear icon), paste that URL into Website. Check that the MIT license shows on the repo page (a rule of the hackathon).

> The `.kiro/` folder must be in the repo (the rules require it). It is not in `.gitignore`, so `git add .` includes it.

## Offline test on real devices (R6.4)

1. With Wi-Fi on, open the published URL on **both** devices.
2. On both, tap **📦 Prepare for offline play** and wait for "✓ Ready for offline play".
3. Turn off **Wi-Fi and Bluetooth** on both. Airplane mode works too, as long as Wi-Fi and Bluetooth stay off.
4. **Reload** the page on both. The game must load.
5. Play a full game. Log it in `docs/hardware-log.md`.

If step 2 says "reload this page once while online", do that and tap Prepare again. The first visit installs the offline helper, and it takes control after one reload.
