# Shair Landing Page

Landing page + Netlify Function that handles form submission, Firebase lead creation, Meta CAPI, and handbook email delivery.

---

## Repo structure

```
shair-landing/
├── index.html                        # Landing page (Pixel, UTM capture, form)
├── netlify.toml                      # Netlify build config
├── package.json                      # firebase-admin dependency
├── .env.example                      # Environment variable template
├── .gitignore
├── assets/
│   └── shair-handbook.pdf            # ← DROP YOUR PDF HERE
└── netlify/
    └── functions/
        └── submit-lead.js            # Core function — does everything
```

---

## Before you deploy

### 1. Firebase Service Account Key
1. Go to console.firebase.google.com → shair-sales project
2. Gear icon → Project Settings → Service Accounts
3. Generate New Private Key → download JSON
4. You'll paste the entire JSON (stringified) as an env var

### 2. Meta Pixel ID + CAPI Token
- Pixel ID: Meta Business → Events Manager → your Pixel → Settings
- CAPI Token: Events Manager → your Pixel → Settings → Generate Access Token

### 3. Resend
1. Sign up at resend.com
2. Domains → Add Domain → shairgroup.com (or shair.co.uk)
3. Add the DNS records they give you → Verify
4. API Keys → Create API Key → copy it

### 4. Handbook PDF
- Drop `shair-handbook.pdf` into the `/assets/` folder
- In `submit-lead.js` update the `handbookUrl` to point to your hosted PDF URL
  (e.g. `https://partners.shairgroup.com/assets/shair-handbook.pdf`)

### 5. Update the Pixel ID in index.html
- Search for `YOUR_PIXEL_ID` in `index.html` (appears twice)
- Replace both with your actual Pixel ID

---

## Deploy to Netlify

### Step 1 — Push to GitHub
```bash
cd shair-landing
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/shair-landing.git
git push -u origin main
```

### Step 2 — Connect to Netlify
1. Netlify dashboard → Add new site → Import an existing project
2. Connect GitHub → select `shair-landing`
3. Build settings: leave blank (no build command, publish directory is `.`)
4. Deploy site

### Step 3 — Set environment variables
Netlify → Site Settings → Environment Variables → Add:

| Key | Value |
|-----|-------|
| `FIREBASE_DATABASE_URL` | `your_firebase_database_url_here` |
| `FIREBASE_SERVICE_ACCOUNT` | Paste the entire service account JSON as a single-line string |
| `META_PIXEL_ID` | Your Pixel ID |
| `META_CAPI_TOKEN` | Your CAPI access token |
| `RESEND_API_KEY` | Your Resend API key |

### Step 4 — Redeploy
Netlify → Deploys → Trigger deploy

### Step 5 — Test
1. Visit your Netlify URL
2. Submit the form with a test email
3. Check:
   - Lead appears in the Shair Sales App
   - Handbook email arrives at the test email
   - Notification email arrives at dominic@shairgroup.com
   - Meta Events Manager → Test Events → verify Lead event fires

---

## Making changes via Claude Code

Point Claude Code at this repo and just describe what you want:
- "Add a field asking for the salon's Instagram handle"
- "Change the email subject line"
- "Update the handbook URL"
- "Add a Slack notification when a lead comes in"

Claude Code will make the changes, you review and push. Netlify auto-deploys.

---

## How it works

```
Prospect clicks Meta ad
        ↓
Landing page loads
  → Pixel fires PageView
  → UTMs captured from URL into hidden fields
  → Unique eventId generated for CAPI dedup
        ↓
Prospect submits form
  → Pixel fires Lead (browser-side, eventId attached)
  → POST to /.netlify/functions/submit-lead
        ↓
Netlify Function runs
  1. Writes lead to Firebase (shair/pr/{pid})
  2. Fires Lead event to Meta CAPI (server-side, same eventId)
  3. Sends handbook email to prospect via Resend
  4. Sends notification to Dom + Josh via Resend
        ↓
Prospect sees success screen
Sales App shows new lead with source "Meta ad" and UTM notes
```
