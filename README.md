Smart HSA Receipt Vault (TypeScript)

Problem
- HSA users want to capture and store medical receipts now, invest HSA funds longer, and reimburse later — with audit‑proof documentation.

MVP Goals
- Frictionless capture (1–2 taps) with on‑device OCR.
- Automatic file naming and Drive foldering.
- Continuous running total of unreimbursed eligible expenses (Sheets/exportable CSV).
- Private‑by‑default with strong encryption and export.
- Cross‑provider (not tied to any one HSA custodian).

Non‑Goals (MVP)
- Direct bank payouts, insurer EOB scraping, multi‑currency.

Architecture (MVP)
- Mobile client performs: capture (camera or file), on‑device OCR, metadata confirmation, encryption, and sync.
- Data model is flat and portable (JSON + encrypted blobs), independent of HSA custodians.
- Sync targets are user‑controlled: Google Drive (files) and Google Sheets (ledger) via OAuth. All payloads are encrypted client‑side before upload.
- No backend required; optional serverless webhook for convenience is deferrable.

Security Model
- End‑to‑end encryption: receipts and metadata encrypted locally using a symmetric key (AES‑GCM). Keys stored in device Keychain/Keystore. Exports wrap the key with a passphrase (Argon2id or PBKDF2‑HMAC‑SHA256 in MVP).
- Zero‑knowledge: providers (Drive/Sheets) only see ciphertext and minimal non‑sensitive folder names.
- Export/Import: Encrypted backup bundle (tar/zip) + key material encrypted with user passphrase.

Data Model (summary)
- Receipt: id, date, merchant/provider, amount, currency, category, notes, reimbursed flag, tags, created/updated timestamps.
- Files: original image/PDF, derived PDF (optional), OCR text, thumbnail — all encrypted.
- Ledger row: normalized row per receipt for Sheets/CSV with computed running total of unreimbursed.

This Repo
- src/core/: TypeScript core used by mobile/web (naming, foldering, ledger mapping, encryption via WebCrypto).
- scripts/: TypeScript demo to exercise core functions locally.
- mobile/: Expo (TypeScript) app scaffold with OCR + Google auth stubs.
- sample/: Example data to drive the demo.

Quick Start (Demo, TypeScript)
1) Ensure Node.js 18+.
2) Install dev deps (offline environments skip to build step): `npm i`
3) Run with ts-node: `npm run demo`
   - Or compile then run: `npm run demo:build`
   - Generates `output/receipts.csv` and `output/summary.txt`.

Mobile App (Expo)
- Auth: `expo-auth-session` for Google sign‑in (Drive/Sheets scopes).
- OCR: replace stub in `mobile/src/ocr/ocr.ts` with ML Kit/Vision integration.
- Encryption: uses shared `src/core/crypto` (AES‑GCM). Encrypt before upload.
- Drive: upload encrypted blobs via `mobile/src/google/drive.ts`.

Next Steps (Product)
- Mobile app (React Native or Flutter):
  - iOS: Vision framework; Android: ML Kit for on‑device OCR.
  - Secure storage: Keychain/Keystore; file storage in app sandbox.
  - Background sync to Drive + Sheets via OAuth; encryption before upload.
- Google Integrations:
  - Drive: Folder structure `/HSA Vault/<Year>/<Provider>/...`; upload encrypted blobs; keep content hashes for dedup.
  - Sheets: Append normalized rows; compute running unreimbursed total in‑app and mirror a ‘Total’ cell in Sheet.
- Export/Import: Create password‑protected archive with encrypted key wrap.

Repository Status
- Core and demo are now in TypeScript. Mobile scaffold is ready for wiring OCR and final Google config.
