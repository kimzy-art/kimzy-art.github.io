const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// ============================================================
// USER: Send a support message
// ============================================================
router.post('/support/send', verifyToken, async (req, res) => {
  console.log('📩 User sending support message');
  const { message } = req.body;
  const userId = req.user.id;

  if (!message || message.trim().length < 3) {
    return res.status(400).json({ message: 'Message must be at least 3 characters.' });
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // ✅ Insert as a NEW row with sender_type = 'user'
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .insert({
        user_id: userId,
        email: user.email,
        message: message.trim(),
        sender_type: 'user',
        is_read: false
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('❌ Insert error:', error);
      return res.status(500).json({ message: 'Failed to send message.', error: error.message });
    }

    console.log('✅ User message inserted:', data.id);
    res.status(201).json({ message: 'Message sent successfully.', data });
  } catch (err) {
    console.error('❌ Send error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// USER: Get all messages in their thread
// ============================================================
router.get('/support/my-messages', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ message: 'Failed to fetch messages.', error: error.message });
    }

    // Mark admin messages as read
    await supabaseAdmin
      .from('support_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('sender_type', 'admin')
      .eq('is_read', false);

    res.json({ messages: data });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// ADMIN: Get all support messages (flat list)
// ============================================================
router.get('/admin/support/messages', verifyToken, async (req, res) => {
  try {
    // Admin check
    const { data: user, error: adminCheck } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', req.user.id)
      .single();

    if (adminCheck || !user) {
      return res.status(403).json({ message: 'Admin access required.' });
    }

    const adminEmails = ['admin@gmail.com', 'katejackson00001@gmail.com'];
    if (!adminEmails.includes(user.email)) {
      return res.status(403).json({ message: 'Admin access required.' });
    }

    // Get all messages
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ message: 'Failed to fetch.', error: error.message });
    }

    // Fetch user details
    const userIds = [...new Set(data.map(m => m.user_id).filter(Boolean))];
    let userMap = {};

    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', userIds);

      if (users) {
        users.forEach(u => {
          userMap[u.id] = `${u.first_name || ''} ${u.last_name || ''} (${u.email})`.trim();
        });
      }
    }

    const messagesWithUser = data.map(m => ({
      ...m,
      userDisplay: userMap[m.user_id] || m.email || 'Unknown User'
    }));

    res.json({ messages: messagesWithUser });
  } catch (err) {
    console.error('Admin fetch error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// ADMIN: Send a reply (inserts a NEW row, doesn't overwrite)
// ============================================================
router.post('/admin/support/reply', verifyToken, async (req, res) => {
  console.log('📩 Admin reply request');
  const { userId, reply } = req.body;

  try {
    // Admin check
    const { data: user, error: adminCheck } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', req.user.id)
      .single();

    if (adminCheck || !user) {
      return res.status(403).json({ message: 'Admin access required.' });
    }

    const adminEmails = ['admin@gmail.com', 'katejackson00001@gmail.com'];
    if (!adminEmails.includes(user.email)) {
      return res.status(403).json({ message: 'Admin access required.' });
    }

    if (!userId || !reply || reply.trim().length < 1) {
      return res.status(400).json({ message: 'userId and reply are required.' });
    }

    // Get target user's email
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      return res.status(404).json({ message: 'Target user not found.' });
    }

    // ✅ Insert admin reply as a NEW row
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .insert({
        user_id: userId,
        email: targetUser.email,
        message: reply.trim(),
        sender_type: 'admin',
        is_read: false
      })
      .select('id, user_id, email, message, sender_type, created_at')
      .single();

    if (error) {
      console.error('❌ Reply error:', error);
      return res.status(500).json({ message: 'Failed to send reply.', error: error.message });
    }

    console.log('✅ Admin reply inserted:', data.id);
    res.json({ message: 'Reply sent successfully.', data });
  } catch (err) {
    console.error('Reply error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
