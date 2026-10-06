/* ───────────── Shared helpers for the BML card payment functions ─────────────
   Everything here runs on Vercel's servers, never in the customer's browser.

   Secrets come only from Vercel environment variables:
     BML_API_KEY                BML "API Key (secret)" for the API app
     BML_API_BASE               https://api.uat.merchants.bankofmaldives.com.mv  (UAT)
     SUPABASE_URL               your Supabase project URL
     SUPABASE_SERVICE_ROLE_KEY  Supabase service role / secret key
   None of these may ever start with REACT_APP_, because anything with that
   prefix is built into the public website.

   Files in /api whose names start with "_" are not web addresses, so nobody
   can call this file directly.                                              */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function getConfig() {
  const apiKey = process.env.BML_API_KEY;
  const apiBase = (process.env.BML_API_BASE || '').replace(/\/+$/, '');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // If anything is missing the functions refuse to run, rather than half-work.
  // This is also what keeps the live site switched off until we choose.
  if (!apiKey || !apiBase || !supabaseUrl || !serviceKey) return null;
  return { apiKey, apiBase, supabaseUrl, serviceKey };
}

let adminClient = null;
function getAdmin(cfg) {
  if (!adminClient) {
    adminClient = createClient(cfg.supabaseUrl, cfg.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

// Talk to BML. The API key goes in the Authorization header, as BML's docs show.
async function bmlRequest(cfg, method, path, body) {
  const res = await fetch(cfg.apiBase + path, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: cfg.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = new Error(`BML ${method} ${path} failed with ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// The web address this deployment is running at (live site or a preview).
function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

// Who is asking? The app sends the person's Supabase login token; Supabase
// confirms it is real. No valid token, no payment.
// If the check fails, the reason is written to the Vercel log — never the
// token or the secret key itself, only the error, the project address and
// which kind of key was supplied.
async function getUserFromRequest(cfg, req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    console.error('Login check: no Bearer token received');
    return null;
  }
  const { data, error } = await getAdmin(cfg).auth.getUser(match[1]);
  if (error || !data || !data.user) {
    const key = cfg.serviceKey || '';
    const keyType = key.startsWith('sb_secret_') ? 'sb_secret'
      : key.startsWith('sb_publishable_') ? 'PUBLISHABLE (wrong key)'
      : key.startsWith('eyJ') ? 'legacy jwt'
      : 'unknown';
    console.error(
      'Login check failed:',
      error ? `${error.status || ''} ${error.message}` : 'no user returned',
      '| Supabase host:', (cfg.supabaseUrl || '').replace(/^https?:\/\//, ''),
      '| key type:', keyType
    );
    return null;
  }
  return data.user;
}

// Transaction IDs only ever contain letters, numbers, - and _.
const isSafeId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id);

// What we keep as proof of a payment. Deliberately no card details.
function safePayload(tx) {
  return {
    id: tx.id,
    state: tx.state,
    amount: tx.amount,
    currency: tx.currency,
    provider: tx.provider,
    localId: tx.localId,
    updated: tx.updated,
  };
}

// BML's webhook signature: SHA-256 of nonce + timestamp + API key, as hex.
function verifyWebhookSignature(cfg, headers) {
  const nonce = headers['x-signature-nonce'];
  const timestamp = headers['x-signature-timestamp'];
  const signature = headers['x-signature'];
  if (!nonce || !timestamp || !signature) return false;
  const expected = crypto
    .createHash('sha256')
    .update(`${nonce}${timestamp}${cfg.apiKey}`)
    .digest('hex');
  const a = Buffer.from(String(signature).toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* The heart of it. Ask BML for the true state of a transaction — never trust
   what a browser or a webhook claims — then act on it:
     CONFIRMED                    -> bml_confirm_payment (activates the plan;
                                     ignores repeats; refuses a wrong amount)
     CANCELLED / FAILED / VOIDED  -> mark the pending payment, change nothing else
     anything else                -> still in progress, do nothing            */
async function syncTransaction(cfg, transactionId) {
  const tx = await bmlRequest(cfg, 'GET', `/public/transactions/${encodeURIComponent(transactionId)}`);
  if (!tx || !tx.localId) return { handled: false, reason: 'no_local_id' };

  const db = getAdmin(cfg);
  const { data: payment, error } = await db
    .from('payments')
    .select('id, user_id, local_id, amount_laari, status')
    .eq('local_id', tx.localId)
    .eq('provider', 'bml')
    .maybeSingle();
  if (error) throw error;
  if (!payment) return { handled: false, reason: 'unknown_payment', state: tx.state };

  const payload = safePayload(tx);

  if (tx.state === 'CONFIRMED') {
    if (tx.currency !== 'MVR') {
      console.error('BML payment in unexpected currency', tx.id, tx.currency);
      return { handled: false, reason: 'wrong_currency', state: tx.state, payment };
    }
    const { data, error: rpcError } = await db.rpc('bml_confirm_payment', {
      p_local_id: payment.local_id,
      p_provider_txn_id: tx.id,
      p_amount_laari: tx.amount,
      p_payload: payload,
    });
    if (rpcError) throw rpcError;
    if (!data || !data.ok) console.error('bml_confirm_payment refused', tx.id, data);
    return { handled: true, state: tx.state, payment, result: data };
  }

  if (['CANCELLED', 'FAILED', 'VOIDED'].includes(tx.state)) {
    const { error: updateError } = await db
      .from('payments')
      .update({
        status: tx.state === 'FAILED' ? 'failed' : 'cancelled',
        provider_txn_id: tx.id,
        raw_payload: payload,
      })
      .eq('id', payment.id)
      .eq('status', 'pending'); // never touch a payment that is already paid
    if (updateError) throw updateError;
    return { handled: true, state: tx.state, payment };
  }

  return { handled: false, reason: 'not_final', state: tx.state, payment };
}

module.exports = {
  getConfig,
  getAdmin,
  bmlRequest,
  getBaseUrl,
  getUserFromRequest,
  isSafeId,
  verifyWebhookSignature,
  syncTransaction,
};