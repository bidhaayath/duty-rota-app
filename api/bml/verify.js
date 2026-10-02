/* POST /api/bml/verify   body: { transactionId }
   Called by the app when the customer lands back on easydutyrota.com after
   paying, so they see the result straight away instead of waiting for the
   webhook. Does exactly the same check as the webhook, so the two can never
   activate a plan twice. Only tells a person about their own payment.   */

const {
  getConfig, getUserFromRequest, isSafeId, syncTransaction,
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

    const { transactionId } = req.body || {};
    if (!isSafeId(transactionId)) return res.status(400).json({ error: 'missing_transaction_id' });

    const outcome = await syncTransaction(cfg, transactionId);
    if (!outcome.payment || outcome.payment.user_id !== user.id) {
      return res.status(404).json({ error: 'not_found' });
    }

    const result = outcome.result || {};
    return res.status(200).json({
      state: outcome.state,
      activated: result.ok === true,
      alreadyActive: result.already_paid === true,
      paidUntil: result.paid_until || null,
      kind: result.kind || null,
    });
  } catch (e) {
    console.error('verify payment error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};