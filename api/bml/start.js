/* POST /api/bml/start   body: { tier, cycle }
   Called when a signed-in customer presses Subscribe.
   1. Checks who they are.
   2. Creates the pending payment in our database (price from plan_limits).
   3. Asks BML to create the payment and returns BML's payment page address. */

const {
  getConfig, getAdmin, bmlRequest, getBaseUrl, getUserFromRequest,
} = require('../_lib/bml');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const cfg = getConfig();
  if (!cfg) return res.status(503).json({ error: 'payments_not_configured' });

  try {
    const user = await getUserFromRequest(cfg, req);
    if (!user) return res.status(401).json({ error: 'not_signed_in' });

    const { tier, cycle } = req.body || {};
    const db = getAdmin(cfg);

    // Our own record first. The database decides the price and the rules
    // (for example, downgrades wait until the paid period ends).
    const { data: started, error } = await db.rpc('bml_start_payment', {
      p_user_id: user.id,
      p_tier: tier,
      p_billing_cycle: cycle,
    });
    if (error) throw error;
    if (!started || !started.ok) {
      return res.status(400).json({ error: (started && started.reason) || 'could_not_start', details: started });
    }

    const base = getBaseUrl(req);
    let webhook = `${base}/api/bml/webhook`;
    // Preview links are password-protected by Vercel. This lets BML's
    // notifications through on previews only; the live site never needs it.
    const bypass = process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) webhook += `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}`;

    const markFailed = async (detail) => {
      await db.from('payments')
        .update({ status: 'failed', raw_payload: { stage: 'create', ...detail } })
        .eq('local_id', started.local_id)
        .eq('status', 'pending');
    };

    let tx;
    try {
      tx = await bmlRequest(cfg, 'POST', '/public/v2/transactions', {
        amount: started.amount_laari,
        currency: 'USD', // TEMPORARY diagnostic - change back to MVR
        localId: started.local_id,
        customerReference: `Easy Duty Rota ${tier} ${cycle}`,
        redirectUrl: `${base}/`,
        webhook,
      });
    } catch (bmlError) {
      console.error('BML create transaction failed', bmlError.status, bmlError.data);
      await markFailed({ status: bmlError.status || null, error: bmlError.data || bmlError.message });
      return res.status(502).json({ error: 'gateway_unavailable' });
    }

    if (!tx || !tx.url || !tx.id) {
      console.error('BML create transaction returned no url/id', tx);
      await markFailed({ error: 'no_url_in_response' });
      return res.status(502).json({ error: 'gateway_unavailable' });
    }

    // Remember BML's id for this payment, so it can be traced either way.
    await db.from('payments').update({ provider_txn_id: tx.id }).eq('local_id', started.local_id);

    return res.status(200).json({
      url: tx.url,
      localId: started.local_id,
      amountLaari: started.amount_laari,
      currency: 'MVR',
    });
  } catch (e) {
    console.error('start payment error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};