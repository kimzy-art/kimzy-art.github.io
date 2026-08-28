const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// Admin middleware – checks for admin@gmail.com
const isAdmin = async (req, res, next) => {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (error || !user) return res.status(403).json({ message: 'Access denied.' });
  if (user.email === 'admin@gmail.com') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required.' });
  }
};

// GET /admin/users – all users with online status
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ message: 'Failed to fetch users.' });
  }

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const usersWithStatus = users.map(user => ({
    ...user,
    online: user.last_active ? new Date(user.last_active) > fiveMinutesAgo : false
  }));

  res.json({ users: usersWithStatus });
});

// GET /admin/otps – all OTP records
router.get('/otps', verifyToken, isAdmin, async (req, res) => {
  const { data: otps, error } = await supabaseAdmin
    .from('otp_codes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin OTPs error:', error);
    return res.status(500).json({ message: 'Failed to fetch OTPs.' });
  }

  res.json({ otps });
});

// PATCH /admin/users/:userId/balance – update user balance
router.patch('/users/:userId/balance', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;

  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ message: 'Valid amount is required.' });
  }

  const newBalance = parseFloat(amount);

  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', userId)
    .single();

  if (fetchError || !user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const oldBalance = parseFloat(user.balance || 0);
  const difference = newBalance - oldBalance;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('users')
    .update({ 
      balance: newBalance, 
      updated_at: new Date().toISOString() 
    })
    .eq('id', userId)
    .select('id, email, balance')
    .single();

  if (updateError) {
    console.error('Balance update error:', updateError);
    return res.status(500).json({ message: 'Failed to update balance.' });
  }

  if (difference !== 0) {
    const { error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: difference > 0 ? 'deposit' : 'withdrawal',
        amount: Math.abs(difference),
        method: 'admin',
        details: { note: `Balance adjusted by admin from ${oldBalance.toFixed(2)} to ${newBalance.toFixed(2)}` },
        status: 'completed'
      });

    if (txError) {
      console.error('Transaction log error:', txError);
    }
  }

  res.json({
    message: `Balance updated successfully (${difference > 0 ? '+' : ''}${difference.toFixed(2)}).`,
    user: updated
  });
});

module.exports = router;
