/**
 * submit-lead.js
 * Shair Landing Page — Lead Submission Handler
 *
 * On every form submission this function:
 *   1. Validates required fields
 *   2. Writes the lead to Firebase Realtime Database (shair/pr/{pid})
 *   3. Fires a server-side Lead event to Meta CAPI (deduped with browser pixel)
 *   4. Sends the Shair Handbook email to the prospect via Resend
 *   5. Sends an internal notification email to dominic@shairgroup.com
 *
 * Environment variables required (set in Netlify UI → Site Settings → Environment):
 *   FIREBASE_DATABASE_URL   — your_firebase_database_url_here
 *   FIREBASE_SERVICE_ACCOUNT — full JSON string of the service account key (stringify the downloaded JSON)
 *   META_PIXEL_ID           — your Meta Pixel ID
 *   META_CAPI_TOKEN         — your CAPI access token from Events Manager
 *   RESEND_API_KEY          — your Resend API key
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import crypto from 'crypto';

// ── Firebase init (singleton — avoids re-init on warm lambdas) ───────────────
function getFirebaseDb() {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  return getDatabase();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function localISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/\//g, '-');
}

function hash(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  // Convert UK 07... → 447...
  if (digits.startsWith('0')) return '44' + digits.slice(1);
  return digits;
}

// ── Meta CAPI ─────────────────────────────────────────────────────────────────
async function fireCapiEvent({ eventId, email, phone, name, clientIp, clientUserAgent, sourceUrl, utms }) {
  const pixelId = process.env.META_PIXEL_ID;
  const token   = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return { skipped: true, reason: 'No CAPI credentials' };

  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,           // deduped against browser pixel
      event_source_url: sourceUrl,
      action_source: 'website',
      user_data: {
        em:  [hash(email)],
        ph:  [hash(normPhone(phone))],
        fn:  [hash(firstName)],
        ln:  [hash(lastName)],
        client_ip_address: clientIp,
        client_user_agent: clientUserAgent,
      },
      custom_data: {
        utm_source:   utms.utm_source   || '',
        utm_medium:   utms.utm_medium   || '',
        utm_campaign: utms.utm_campaign || '',
        utm_content:  utms.utm_content  || '',
      },
    }],
  };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const data = await res.json();
  return data;
}

// ── Resend email ──────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true, reason: 'No Resend key' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      from: 'Dominic at Shair <dominic@shairgroup.com>',
      to,
      subject,
      html,
    }),
  });
  return res.json();
}

// ── Email templates ───────────────────────────────────────────────────────────
function handbookEmailHtml({ firstName, handbookUrl }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden">
        <!-- Header -->
        <tr>
          <td style="background:#2c1810;padding:32px 40px">
            <p style="margin:0;color:#c4a882;font-family:Georgia,serif;font-size:13px;letter-spacing:0.15em;text-transform:uppercase">Shair</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px">
            <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#2c1810">
              Hi ${firstName},
            </p>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#2c1810">
              Thanks for getting in touch. Here's the Shair handbook — it covers exactly how our partnership model works, what we take on for you, and what salons typically see in the first 90 days.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:32px 0">
              <tr>
                <td style="background:#2c1810;border-radius:3px">
                  <a href="${handbookUrl}" style="display:inline-block;padding:14px 32px;color:#f5f0e8;font-family:Georgia,serif;font-size:14px;text-decoration:none;letter-spacing:0.05em">
                    Download the Shair Handbook →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#2c1810">
              I'll be in touch personally within 24 hours to find a time to talk. No hard sell — just a conversation to see if it's a fit.
            </p>
            <p style="margin:0;font-size:16px;line-height:1.7;color:#2c1810">
              Dom
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #ede8e0">
            <p style="margin:0;font-size:12px;color:#999;line-height:1.6">
              Shair Services Ltd · Cheltenham, UK<br>
              You're receiving this because you submitted your details at partners.shairgroup.com
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function notificationEmailHtml({ name, owner, email, phone, teamCount, annualTurnover, utms, sourceUrl }) {
  const utmLine = Object.entries(utms)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || 'Direct / no UTM';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px 20px;background:#0a0a0a;font-family:'Courier New',monospace">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td>
      <p style="margin:0 0 8px;color:#c8f55a;font-size:18px;font-weight:bold">New Shair lead</p>
      <p style="margin:0 0 32px;color:#555;font-size:12px">${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}</p>

      <table cellpadding="0" cellspacing="0" style="width:100%;max-width:480px">
        ${row('Salon', name)}
        ${row('Owner', owner)}
        ${row('Email', email)}
        ${row('Phone', phone)}
        ${row('Team size', teamCount)}
        ${row('Turnover', annualTurnover)}
        ${row('Source', utmLine)}
        ${row('Page', sourceUrl)}
      </table>

      <p style="margin:32px 0 0;color:#555;font-size:11px">
        Lead is live in the Sales App. Handbook email sent automatically.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function row(label, value) {
  return `<tr>
    <td style="padding:6px 0;color:#888;font-size:12px;width:100px;vertical-align:top">${label}</td>
    <td style="padding:6px 0;color:#f0f0f0;font-size:13px;font-weight:bold">${value || '—'}</td>
  </tr>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    owner,          // "Name" field on form
    name,           // "Salon Name"
    email,
    phone,
    teamCount,
    annualTurnover,
    eventId,        // generated client-side for CAPI dedup
    sourceUrl,      // window.location.href
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
  } = body;

  // Basic validation
  if (!name || !email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Salon name and email are required' }),
    };
  }

  const utms = { utm_source, utm_medium, utm_campaign, utm_content };
  const pid  = 'p' + Date.now();
  const now  = new Date().toISOString();
  const iso  = localISO();

  // UTM info stored in notes for visibility in Sales App
  const utmNote = Object.entries(utms)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(' | ');

  // ── 1. Write to Firebase Realtime Database ────────────────────────────────
  let firebaseResult = 'skipped';
  try {
    const db   = getFirebaseDb();
    const ref  = db.ref(`shair/pr/${pid}`);
    const lead = {
      id: pid,
      name: name || '',
      owner: owner || '',
      email: email || '',
      phone: phone || '',
      teamCount: teamCount || '',
      approxTurnover: annualTurnover || '',
      location: '',
      website: '',
      biggestProblem: '',
      goal: '',
      source: 'Meta ad',
      status: 'prospects',
      nextAction: 'Call to introduce Shair',
      nextActionDate: iso,
      notes: utmNote ? `Landing page submission. ${utmNote}` : 'Landing page submission.',
      outreach: [],
      stageHistory: [{ stage: 'prospects', dateISO: iso, timestamp: Date.now() }],
      createdAt: now,
      landingPage: true,
    };
    await ref.set(lead);
    firebaseResult = 'ok';
  } catch (err) {
    console.error('Firebase error:', err);
    firebaseResult = err.message;
  }

  // ── 2. Meta CAPI ──────────────────────────────────────────────────────────
  let capiResult = 'skipped';
  try {
    capiResult = await fireCapiEvent({
      eventId,
      email,
      phone,
      name: owner,
      clientIp: event.headers['x-forwarded-for'] || '',
      clientUserAgent: event.headers['user-agent'] || '',
      sourceUrl,
      utms,
    });
  } catch (err) {
    console.error('CAPI error:', err);
    capiResult = err.message;
  }

  // ── 3. Handbook email to prospect ─────────────────────────────────────────
  const firstName = (owner || '').trim().split(/\s+/)[0] || 'there';
  const handbookUrl = 'https://partners.shairgroup.com/assets/shair-handbook.pdf';

  let handbookResult = 'skipped';
  try {
    handbookResult = await sendEmail({
      to: email,
      subject: 'Your Shair Handbook',
      html: handbookEmailHtml({ firstName, handbookUrl }),
    });
  } catch (err) {
    console.error('Handbook email error:', err);
    handbookResult = err.message;
  }

  // ── 4. Internal notification to Dom ───────────────────────────────────────
  let notifyResult = 'skipped';
  try {
    notifyResult = await sendEmail({
      to: 'dominic@shairgroup.com',
      subject: `New Shair lead: ${name}`,
      html: notificationEmailHtml({ name, owner, email, phone, teamCount, annualTurnover, utms, sourceUrl }),
    });
  } catch (err) {
    console.error('Notify email error:', err);
    notifyResult = err.message;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      pid,
      firebase: firebaseResult,
      capi: capiResult,
      handbook: handbookResult,
      notify: notifyResult,
    }),
  };
};
