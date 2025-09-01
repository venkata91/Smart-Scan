Smart Scan — Mobile (Expo + TypeScript)

Summary
- Expo (TypeScript) app with stubs for:
  - Google Sign‑In (AuthSession)
  - Google Drive upload (REST)
  - On‑device OCR (stub; wire to ML Kit / Vision)
  - Client‑side AES‑GCM encryption (shared core)

Setup (high level)
1) Install Expo CLI and dependencies:
   - npm i -g expo
   - cd mobile && npm i
2) Google Cloud:
   - Create OAuth Client (iOS, Android, and Web for Expo dev)
   - Add reverse client IDs (iOS) and SHA certificate fingerprints (Android) as needed
   - Enable Drive API and Sheets API
3) Configure env vars in `mobile/app.config.ts` or `.env`:
   - GOOGLE_EXPO_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_WEB_CLIENT_ID
4) Run:
   - expo start -c

Notes
- OCR: Replace `src/ocr/ocr.ts` stub with ML Kit (expo-mlkit-ocr) or VisionCamera OCR plugin.
- Drive: `src/google/drive.ts` uses REST with bearer token; upload encrypted blobs only.
- Shared core: imports from `../../src/core`. Configure Metro to resolve outside workspace or copy core into a local package.
