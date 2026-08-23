const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// GET /api/transactions – fetch user transactions (optionally limited)
router.get('/transactions', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { limit } = req.query;

  let query = supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (limit) query = query.limit(parseInt(limit));

  const { data, error } = await query;
  if (error) {
    console.error('Transactions fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch transactions' });
  }
  res.json({ transactions: data });
});

module.exports = router;
