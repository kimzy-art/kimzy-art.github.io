const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// ============================================================
// GET /me – current user
// ============================================================
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, phone, country, balance, verified, created_at, verify_popup_active, withdrawal_otp_active, withdrawal_otp_sent_at')
      .eq('id', req.user.id)
      .single();

    if (error || !user) return res.status(404).json({ message: 'User not found.' });
    res.json({ user });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ============================================================
// PUT /me – update profile
// ============================================================
router.put('/me', verifyToken, async (req, res) => {
  const { first_name, last_name, phone, country } = req.body;
  const updates = {};
  if (first_name) updates.first_name = first_name;
  if (last_name) updates.last_name = last_name;
  if (phone) updates.phone = phone;
  if (country) updates.country = country;
  updates.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select('id, email, first_name, last_name, phone, country, balance')
    .single();

  if (error) return res.status(500).json({ message: 'Failed to update profile.' });
  res.json({ user: updated });
});

// ============================================================
// POST /me/verify-popup/acknowledge
// ============================================================
router.post('/me/verify-popup/acknowledge', verifyToken, async (req, res) => {
  try {
    const { data: updated, error } = await supabaseAdmin
      .from('users')
      .update({
        verify_popup_active: false,
        verify_popup_acknowledged_at: new Date().toISOString()
      })
      .eq('id', req.user.id)
      .select('id, verify_popup_active')
      .single();

    if (error) return res.status(500).json({ message: 'Failed to acknowledge.' });
    res.json({ message: 'Popup acknowledged.', user: updated });
  } catch (err) {
    console.error('Acknowledge popup error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ============================================================
// POST /me/withdrawal-otp/verify
// User submits the OTP to complete withdrawal
// ============================================================
router.post('/me/withdrawal-otp/verify', verifyToken, async (req, res) => {
  const { otp } = req.body;

  if (!otp || otp.trim().length !== 6) {
    return res.status(400).json({ message: 'Please enter a valid 6-digit OTP.' });
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, withdrawal_otp, withdrawal_otp_active')
      .eq('id', req.user.id)
      .single();

    if (error || !user) return res.status(404).json({ message: 'User not found.' });

    if (!user.withdrawal_otp_active) {
      return res.status(400).json({ message: 'No active OTP request for your account.' });
    }

    if (user.withdrawal_otp !== otp.trim()) {
      return res.status(400).json({ message: 'Invalid OTP. Please check and try again.' });
    }

    // Mark as verified and deactivate popup
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('users')
      .update({
        withdrawal_otp_active: false,
        withdrawal_otp_verified_at: new Date().toISOString()
      })
      .eq('id', req.user.id)
      .select('id, withdrawal_otp_active, withdrawal_otp_verified_at')
      .single();

    if (updateErr) return res.status(500).json({ message: 'Failed to verify OTP.' });

    console.log(`✅ Withdrawal OTP verified for user ${req.user.id}`);
    res.json({ message: 'OTP verified successfully.', user: updated });
  } catch (err) {
    console.error('Verify withdrawal OTP error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
