const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// Helper: calculate end date based on duration
const getEndDate = (durationDays) => {
  const d = new Date();
  d.setDate(d.getDate() + durationDays);
  return d.toISOString();
};

// POST /api/invest – create an investment
router.post('/invest', verifyToken, async (req, res) => {
  const { planName, amount, roiPercent, durationDays } = req.body;
  const userId = req.user.id;

  // Validate
  if (!planName || !amount || amount < 10) {
    return res.status(400).json({ message: 'Invalid investment details.' });
  }
  if (!roiPercent || roiPercent < 0) {
    return res.status(400).json({ message: 'Invalid ROI percentage.' });
  }
  if (!durationDays || durationDays < 1) {
    return res.status(400).json({ message: 'Invalid duration.' });
  }

  try {
    // Get user's current balance
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const currentBalance = parseFloat(user.balance || 0);
    if (amount > currentBalance) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    // Deduct amount from balance
    const newBalance = currentBalance - amount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Balance update error:', updateError);
      return res.status(500).json({ message: 'Failed to deduct balance.' });
    }

    // Log investment transaction
    const { error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'investment',
        amount: amount,
        method: 'investment',
        details: { plan: planName, roi: roiPercent, duration: durationDays },
        status: 'completed'
      });

    if (txError) {
      console.error('Transaction log error:', txError);
      // Non-critical, but we rollback balance if we want. We'll just log error.
    }

    // Create investment record
    const endDate = getEndDate(durationDays);
    const { data: investment, error: invError } = await supabaseAdmin
      .from('investments')
      .insert({
        user_id: userId,
        plan_name: planName,
        amount: amount,
        roi_percent: roiPercent,
        duration_days: durationDays,
        start_date: new Date().toISOString(),
        end_date: endDate,
        status: 'active'
      })
      .select('*')
      .single();

    if (invError) {
      // Rollback balance
      await supabaseAdmin
        .from('users')
        .update({ balance: currentBalance })
        .eq('id', userId);
      console.error('Investment creation error:', invError);
      return res.status(500).json({ message: 'Failed to create investment.' });
    }

    res.status(201).json({
      message: 'Investment created successfully.',
      investment: investment,
      newBalance: newBalance
    });
  } catch (err) {
    console.error('Investment error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/investments – get user's investments
router.get('/investments', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { data: investments, error } = await supabaseAdmin
    .from('investments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Fetch investments error:', error);
    return res.status(500).json({ message: 'Failed to fetch investments.' });
  }

  res.json({ investments });
});

module.exports = router;
