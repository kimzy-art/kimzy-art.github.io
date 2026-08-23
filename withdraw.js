const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');
const axios = require('axios');

// ============================================================
// Brevo Email Helper
// ============================================================
const sendBrevoEmail = async (to, subject, htmlContent) => {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'FX SMARTBULL <jimmydarts404@gmail.com>';
    const fromAddress = fromEmail.split('<')[1]?.replace('>', '') || fromEmail;

    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'FX SMARTBULL', email: fromAddress },
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlContent
      },
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.status === 201 || response.status === 200;
  } catch (error) {
    console.error('Brevo email error:', error.response?.data || error.message);
    return false;
  }
};

// ============================================================
// POST /api/withdraw
// ============================================================
router.post('/withdraw', verifyToken, async (req, res) => {
  const { amount, method, details } = req.body;
  const userId = req.user.id;

  if (!amount || amount < 10) {
    return res.status(400).json({ message: 'Invalid amount (minimum $10).' });
  }
  if (!method || !['crypto', 'bank'].includes(method)) {
    return res.status(400).json({ message: 'Invalid withdrawal method.' });
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('balance, email, first_name, last_name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const currentBalance = parseFloat(user.balance || 0);
    if (amount > currentBalance) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    const newBalance = currentBalance - amount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Balance update error:', updateError);
      return res.status(500).json({ message: 'Failed to update balance.' });
    }

    const { data: tx, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdrawal',
        amount: amount,
        method: method,
        details: details,
        status: 'pending'
      })
      .select('id')
      .single();

    if (txError) {
      await supabaseAdmin.from('users').update({ balance: currentBalance }).eq('id', userId);
      console.error('Transaction record error:', txError);
      return res.status(500).json({ message: 'Failed to create withdrawal record.' });
    }

    // --- Build withdrawal receipt email ---
    const methodDisplay = method === 'crypto' ? 'Cryptocurrency' : 'Bank Transfer';
    const detailSummary = method === 'crypto'
      ? `Currency: ${details?.currency || 'BTC'}<br>Wallet: ${details?.walletAddress || 'N/A'}<br>Network: ${details?.network || 'N/A'}`
      : `Bank: ${details?.bankName || 'N/A'}<br>Account: ${details?.accountNumber || 'N/A'}<br>Holder: ${details?.accountHolder || 'N/A'}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0A0A0A; color: #fff; padding: 30px; border-radius: 16px; border: 1px solid #D4AF37;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #D4AF37; font-weight: 800; font-size: 28px; letter-spacing: 2px; margin: 0;">FX SMARTBULL</h1>
          <hr style="border-color: rgba(212,175,55,0.2);" />
        </div>
        <h2 style="color: #D4AF37; margin-top: 0;">Withdrawal Request Received</h2>
        <p style="color: #ddd;">Hello ${user.first_name || 'Trader'},</p>
        <p style="color: #ddd;">We have received your withdrawal request. Details are below:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; color: #fff;">
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Amount</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #D4AF37;">$${amount.toFixed(2)}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Method</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600;">${methodDisplay}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Withdrawal ID</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600;">#${tx.id}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Status</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #f59e0b;">Pending</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Details</td>
            <td style="padding: 8px 0; text-align: right; font-size: 13px; color: #ccc;">${detailSummary}</td>
          </tr>
        </table>
        <p style="color: #ddd;">Your withdrawal is being processed and will be completed within <strong>24 hours</strong>.</p>
        <p style="color: #ddd;">If you did not initiate this withdrawal, please contact our support team immediately.</p>
        <hr style="border-color: rgba(212,175,55,0.1);" />
        <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message. Do not reply.</p>
        <p style="color: #666; font-size: 12px; text-align: center;">© 2026 FX SMARTBULL. All rights reserved.</p>
      </div>
    `;

    const emailSent = await sendBrevoEmail(user.email, 'Withdrawal Request Received – FX SMARTBULL', emailHtml);
    if (!emailSent) {
      console.warn('Withdrawal email failed, but withdrawal was recorded.');
    }

    res.status(201).json({
      message: 'Withdrawal submitted successfully.',
      withdrawalId: tx.id,
      newBalance: newBalance,
      emailSent: emailSent
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
