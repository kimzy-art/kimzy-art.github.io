const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// ============================================================
// GET /me – Current user profile (includes verify_popup_active)
// ============================================================
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, phone, country, balance, verified, created_at, verify_popup_active')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ============================================================
// PUT /me – Update user profile
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

  if (error) {
    console.error('Update error:', error);
    return res.status(500).json({ message: 'Failed to update profile.' });
  }

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

    if (error) {
      console.error('Acknowledge popup error:', error);
      return res.status(500).json({ message: 'Failed to acknowledge.' });
    }

    res.json({ message: 'Popup acknowledged.', user: updated });
  } catch (err) {
    console.error('Acknowledge popup error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
