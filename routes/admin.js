const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');
const axios = require('axios');

// ============================================================
// Admin Middleware
// ============================================================
const isAdmin = async (req, res, next) => {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (error || !user) return res.status(403).json({ message: 'Access denied.' });
  if (user.email === 'admin@gmail.com' || user.email === 'katejackson00001@gmail.com') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required.' });
  }
};

// ============================================================
// GET /admin/users
// ============================================================
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const { data: users, error } = await supabaseAdmin
      .from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const usersWithStatus = users.map(user => ({
      ...user,
      online: user.last_active ? new Date(user.last_active) > fiveMinutesAgo : false
    }));
    res.json({ users: usersWithStatus });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
});

// ============================================================
// GET /admin/otps
// ============================================================
router.get('/otps', verifyToken, isAdmin, async (req, res) => {
  try {
    const { data: otps, error } = await supabaseAdmin
      .from('otp_codes').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ otps });
  } catch (err) {
    console.error('Admin OTPs error:', err);
    res.status(500).json({ message: 'Failed to fetch OTPs.' });
  }
});

// ============================================================
// PATCH /admin/users/:userId/balance
// ============================================================
router.patch('/users/:userId/balance', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;

  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ message: 'Valid amount is required.' });
  }

  const newBalance = parseFloat(amount);
  try {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users').select('balance').eq('id', userId).single();
    if (fetchError || !user) return res.status(404).json({ message: 'User not found.' });

    const oldBalance = parseFloat(user.balance || 0);
    const difference = newBalance - oldBalance;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('id', userId).select('id, email, balance').single();
    if (updateError) throw updateError;

    if (difference !== 0) {
      await supabaseAdmin.from('transactions').insert({
        user_id: userId,
        type: difference > 0 ? 'deposit' : 'withdrawal',
        amount: Math.abs(difference),
        method: 'admin',
        details: { note: `Balance adjusted by admin from ${oldBalance.toFixed(2)} to ${newBalance.toFixed(2)}` },
        status: 'completed'
      });
    }

    res.json({
      message: `Balance updated successfully (${difference > 0 ? '+' : ''}${difference.toFixed(2)}).`,
      user: updated
    });
  } catch (err) {
    console.error('Balance update error:', err);
    res.status(500).json({ message: 'Failed to update balance.' });
  }
});

// ============================================================
// GET /admin/transactions/all
// ============================================================
router.get('/transactions/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*, users(email, first_name, last_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ transactions: data });
  } catch (err) {
    console.error('Fetch all transactions error:', err);
    res.status(500).json({ message: 'Failed to fetch transactions.' });
  }
});

// ============================================================
// EMAIL HELPER – sends status email via Brevo
// ============================================================
const sendTransactionStatusEmail = async (transaction) => {
  console.log('════════════════════════════════════════════');
  console.log('📧 sendTransactionStatusEmail START');
  console.log('📧 Transaction ID:', transaction.id);
  console.log('📧 Status:', transaction.status);

  try {
    const user = transaction.users;
    const { amount, method, status, id, admin_notes, details } = transaction;

    console.log('📧 User email:', user?.email);
    console.log('📧 Amount:', amount);
    console.log('📧 Method:', method);

    if (!user || !user.email) {
      console.log('❌ No user email found');
      return false;
    }

    const statusMessages = {
      pending: {
        subject: '⏳ Withdrawal Pending Review – FXSmartbull',
        color: '#f59e0b',
        icon: '⏳',
        title: 'Withdrawal Pending Review',
        intro: 'Your withdrawal request is now pending admin review.',
        action: 'We will notify you as soon as your withdrawal is processed.'
      },
      completed: {
        subject: '✅ Withdrawal Completed – FXSmartbull',
        color: '#00C853',
        icon: '✅',
        title: 'Withdrawal Completed',
        intro: 'Your withdrawal has been successfully processed and funds have been sent to your account.',
        action: 'You can view the transaction in your dashboard.'
      },
      failed: {
        subject: '❌ Withdrawal Failed – FXSmartbull',
        color: '#FF3D57',
        icon: '❌',
        title: 'Withdrawal Failed',
        intro: 'Your withdrawal request could not be processed. Please contact support for assistance.',
        action: 'Please reach out to our support team if you need help resolving this.'
      },
      cancelled: {
        subject: '🚫 Withdrawal Cancelled – FXSmartbull',
        color: '#f59e0b',
        icon: '🚫',
        title: 'Withdrawal Cancelled',
        intro: 'Your withdrawal request has been cancelled.',
        action: 'If you have any questions, please contact our support team.'
      },
      refunded: {
        subject: '💸 Withdrawal Refunded – Account Verification Required | FXSmartbull',
        color: '#D4AF37',
        icon: '💸',
        title: 'Withdrawal Refunded',
        intro: 'Your recent withdrawal request has been <strong style="color:#D4AF37;">refunded to your account</strong>.',
        action: 'Our records show that your account has <strong style="color:#D4AF37;">not yet been verified</strong>. For security and regulatory compliance, we can only process withdrawals from fully verified accounts. Please complete your account verification by submitting the required identification documents in your dashboard.'
      }
    };

    const statusInfo = statusMessages[status];
    if (!statusInfo) {
      console.log('❌ No status message found for:', status);
      return false;
    }

    const methodDisplay = method === 'crypto' ? 'Cryptocurrency' : 'Bank Transfer';
    const detailSummary = method === 'crypto'
      ? `Currency: ${details?.currency || 'BTC'}<br>Wallet: ${details?.walletAddress || 'N/A'}<br>Network: ${details?.network || 'N/A'}`
      : `Bank: ${details?.bankName || 'N/A'}<br>Account: ${details?.accountNumber || 'N/A'}<br>Holder: ${details?.accountHolder || 'N/A'}`;

    const emailHtml = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #0A0A0A; color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid rgba(212,175,55,0.2);">
        <div style="background: linear-gradient(135deg, #B8962E, #D4AF37, #E8C84A); padding: 28px 30px; text-align: center;">
          <h1 style="color: #0A0A0A; font-weight: 800; font-size: 24px; letter-spacing: 3px; margin: 0;">FXSMARTBULL</h1>
        </div>
        <div style="padding: 36px 32px 28px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; padding: 8px 22px; background: rgba(212,175,55,0.08); border: 1px solid ${statusInfo.color}; border-radius: 30px;">
              <span style="color: ${statusInfo.color}; font-size: 14px; font-weight: 700; letter-spacing: 0.5px;">${statusInfo.icon} ${statusInfo.title}</span>
            </div>
          </div>
          <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
            Dear <strong style="color: #D4AF37;">${user?.first_name || 'Trader'}</strong>,
          </p>
          <p style="color: #cccccc; font-size: 15px; line-height: 1.7; margin: 0 0 20px 0;">
            ${statusInfo.intro}
          </p>
          <div style="background: rgba(212,175,55,0.05); border-left: 4px solid ${statusInfo.color}; padding: 18px 22px; border-radius: 8px; margin: 24px 0;">
            <p style="color: #d4d4d4; font-size: 14px; line-height: 1.7; margin: 0;">
              ${statusInfo.action}
            </p>
          </div>
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 22px; margin: 24px 0;">
            <h3 style="color: #D4AF37; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 14px 0;">
              Transaction Details
            </h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 9px 0; color: #999; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05);">Amount</td>
                <td style="padding: 9px 0; color: ${statusInfo.color}; font-size: 15px; font-weight: 700; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.05);">$${parseFloat(amount).toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 9px 0; color: #999; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05);">Method</td>
                <td style="padding: 9px 0; color: #ffffff; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.05);">${methodDisplay}</td>
              </tr>
              <tr>
                <td style="padding: 9px 0; color: #999; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05);">Transaction ID</td>
                <td style="padding: 9px 0; color: #ffffff; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.05);">#${id}</td>
              </tr>
              <tr>
                <td style="padding: 9px 0; color: #999; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05);">Status</td>
                <td style="padding: 9px 0; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.05);">
                  <span style="background: rgba(212,175,55,0.1); color: ${statusInfo.color}; padding: 3px 14px; border-radius: 20px; font-size: 12px; font-weight: 700;">${status.toUpperCase()}</span>
                </td>
              </tr>
              ${admin_notes ? `
              <tr>
                <td style="padding: 9px 0; color: #999; font-size: 14px;">Notes</td>
                <td style="padding: 9px 0; color: #f59e0b; font-size: 13px; text-align: right;">${admin_notes}</td>
              </tr>` : ''}
            </table>
          </div>
          <div style="text-align: center; margin: 28px 0 0 0;">
            <a href="https://kimzy-cresta-market.netlify.app/client.html" style="display: inline-block; padding: 13px 36px; background: linear-gradient(135deg, #B8962E, #D4AF37); color: #0A0A0A; font-weight: 700; font-size: 14px; text-decoration: none; border-radius: 30px; letter-spacing: 0.5px;">
              Go to Dashboard →
            </a>
          </div>
        </div>
        <div style="background: rgba(0,0,0,0.4); padding: 22px 32px; text-align: center; border-top: 1px solid rgba(212,175,55,0.1);">
          <p style="color: #666; font-size: 12px; margin: 0 0 6px 0;">This is an automated message. Please do not reply directly.</p>
          <p style="color: #444; font-size: 11px; margin: 0;">© ${new Date().getFullYear()} FXSmartbull. All rights reserved.</p>
        </div>
      </div>
    `;

    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'FXSmartbull <jimmydarts404@gmail.com>';
    const fromAddress = fromEmail.split('<')[1]?.replace('>', '') || fromEmail;

    console.log('📧 Brevo API Key set:', !!apiKey);
    console.log('📧 From address:', fromAddress);
    console.log('📧 Sending to:', user.email);
    console.log('📧 Subject:', statusInfo.subject);

    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'FXSmartbull', email: fromAddress },
        to: [{ email: user.email }],
        subject: statusInfo.subject,
        htmlContent: emailHtml
      },
      { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } }
    );

    console.log('✅ Brevo response status:', response.status);
    console.log('✅ Brevo response data:', JSON.stringify(response.data));
    console.log('════════════════════════════════════════════');
    return true;
  } catch (error) {
    console.log('❌ Email error name:', error.name);
    console.log('❌ Email error message:', error.message);
    console.log('❌ Email error response:', JSON.stringify(error.response?.data));
    console.log('❌ Email error status:', error.response?.status);
    console.log('════════════════════════════════════════════');
    return false;
  }
};

// ============================================================
// PATCH /admin/transactions/:id/status – Update & send email
// ============================================================
router.patch('/transactions/:transactionId/status', verifyToken, isAdmin, async (req, res) => {
  console.log('════════════════════════════════════════════');
  console.log('📥 PATCH /admin/transactions/:id/status');
  console.log('📦 Transaction ID:', req.params.transactionId);
  console.log('📦 Body:', req.body);

  const { transactionId } = req.params;
  const { status, admin_notes } = req.body;

  const validStatuses = ['pending', 'completed', 'failed', 'cancelled', 'draft', 'refunded'];
  if (!status || !validStatuses.includes(status)) {
    console.log('❌ Invalid status');
    return res.status(400).json({ message: 'Invalid status.' });
  }

  try {
    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('transactions')
      .select('*, users(email, first_name, last_name)')
      .eq('id', transactionId)
      .single();

    if (fetchError || !transaction) {
      console.log('❌ Transaction not found:', fetchError);
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    console.log('✅ Found transaction for:', transaction.users?.email);

    const updates = {
      status,
      updated_at: new Date().toISOString(),
      admin_notes: admin_notes || transaction.admin_notes || null
    };

    if (['completed', 'failed', 'cancelled', 'refunded'].includes(status)) {
      updates.processed_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('transactions')
      .update(updates)
      .eq('id', transactionId)
      .select('*, users(email, first_name, last_name)')
      .single();

    if (updateError) {
      console.log('❌ Update error:', updateError);
      return res.status(500).json({ message: 'Failed to update. Error: ' + updateError.message });
    }

    console.log('✅ Transaction status updated to:', status);

    // Send email for all statuses except draft
    let emailSent = false;
    if (status !== 'draft') {
      console.log('📧 Triggering email for status:', status);
      emailSent = await sendTransactionStatusEmail(updated);
      console.log('📧 Email sent result:', emailSent);
    } else {
      console.log('⏭️ Draft status – no email');
    }

    // Append to emails_sent log
    if (emailSent) {
      const currentLog = Array.isArray(transaction.emails_sent) ? transaction.emails_sent : [];
      currentLog.push({ status, sent_at: new Date().toISOString() });

      const { data: final } = await supabaseAdmin
        .from('transactions')
        .update({ emails_sent: currentLog })
        .eq('id', transactionId)
        .select('*, users(email, first_name, last_name)')
        .single();

      console.log('✅ Email log updated in DB');
      return res.json({
        message: `Status updated to ${status} & email sent`,
        email_sent: true,
        transaction: final
      });
    }

    console.log('⚠️ Response sent – email not sent');
    res.json({
      message: `Status updated to ${status}`,
      email_sent: false,
      transaction: updated
    });
  } catch (err) {
    console.log('❌ Catch error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
