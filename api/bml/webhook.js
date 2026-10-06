/* POST /api/bml/webhook
   BML calls this whenever a payment changes. We check BML's signature, then
   ask BML directly for the true state before doing anything (BML recommends
   this). Activation itself happens in the database and ignores repeats.   */

const {
  getConfig, isSafeId, verifyWebhookSignature, syncTransaction,
} = require('../_lib/bml');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const cfg = getConfig();
  if (!cfg) return res.status(503).json({ error: 'payments_not_configured' });

  if (!verifyWebhookSignature(cfg, req.headers)) {
    console.warn('BML webhook rejected: signature did not match');
    return res.status(401).json({ error: 'bad_signature' });
  }

  const body = req.body || {};
  if (body.eventType && body.eventType !== 'NOTIFY_TRANSACTION_CHANGE') {
    return res.status(200).json({ received: true, ignored: body.eventType });
  }
  if (!isSafeId(body.transactionId)) {
    return res.status(400).json({ error: 'missing_transaction_id' });
  }

  try {
    const outcome = await syncTransaction(cfg, body.transactionId);
    console.log('BML webhook', body.transactionId, outcome.state, outcome.reason || 'ok');
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('BML webhook processing failed', e);
    // A 500 tells BML something went wrong on our side.
    return res.status(500).json({ error: 'server_error' });
  }
};