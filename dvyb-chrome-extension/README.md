# DVYB Chrome Extension

Save ads from Meta Ad Library to your DVYB account.

## Build and load in Chrome

URLs for the backend API and frontend (OAuth) are set at **build time** so you can build for local testing or for production (Chrome Web Store).

**Option A – Use a `.env` file (recommended)**  
Create a `.env` file in `dvyb-chrome-extension/` (copy from `.env.example`):

- **Local testing** (default if you don’t create `.env`):
  - `DVYB_API_BASE=http://localhost:3001`
  - `DVYB_FRONTEND_URL=http://localhost:3005`
- **Production** (when publishing to Chrome Web Store): set your live API and app URLs in `.env`.

**Option B – Pass URLs via CLI**  
```bash
# Local
npm run build

# Production (example)
DVYB_API_BASE=https://api.dvyb.ai DVYB_FRONTEND_URL=https://app.dvyb.ai npm run build
```

The build script generates `manifest.generated.json` with the correct `host_permissions` for the URLs you set, so the extension is allowed to call your backend and open the frontend for sign-in.

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Build the extension**:
   ```bash
   npm run build
   ```
   This compiles TypeScript and copies assets into the `dist/` folder.

3. **Load the extension in Chrome**:
   - Open `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - Click **Load unpacked**
   - **Select the `dist` folder** (e.g. `dvyb-chrome-extension/dist`), **not** the project root

   If you select the project root, the popup will be missing or outdated because Chrome needs the built files from `dist/`.

4. **After code changes**: Run `npm run build` again, then go to `chrome://extensions` and click the **reload** icon on the DVYB extension.

## Development

- `npm run dev` — watch mode; rebuilds on file changes. After rebuilding, reload the extension in Chrome.
