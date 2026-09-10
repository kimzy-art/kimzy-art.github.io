const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// ============================================================
// USER: Send a support message
// ============================================================
router.post('/support/send', verifyToken, async (req, res) => {
  console.log('📩 Received support message request');
  const { message } = req.body;
  const userId = req.user.id;

  if (!message || message.trim().length < 3) {
    return res.status(400).json({ message: 'Message must be at least 3 characters.' });
  }

  try {
    // Get user email
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('❌ User fetch error:', userError);
      return res.status(404).json({ message: 'User not found.' });
    }

    // Insert message
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .insert({
        user_id: userId,
        email: user.email,
        message: message.trim(),
        is_read: false,
        status: 'open',
        priority: 'normal'
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('❌ Insert error:', error);
      return res.status(500).json({ message: 'Failed to send message. Error: ' + error.message });
    }

    console.log('✅ Message inserted, ID:', data.id);
    res.status(201).json({ message: 'Message sent successfully.', data });
  } catch (err) {
    console.error('❌ Support send error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// USER: Get user's own support messages (with replies)
// ============================================================
router.get('/support/my-messages', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(100); // ✅ Limit to 100 messages

    if (error) {
      console.error('❌ Fetch error:', error);
      return res.status(500).json({ message: 'Failed to fetch messages.' });
    }

    // ✅ Only update is_read if there are unread messages
    const hasUnread = data.some(m => !m.is_read);
    if (hasUnread) {
      await supabaseAdmin
        .from('support_messages')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);
    }

    res.json({ messages: data });
  } catch (err) {
    console.error('❌ Fetch messages error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// ADMIN: Get all support messages (with user details – single query)
// ============================================================
router.get('/admin/support/messages', verifyToken, async (req, res) => {
  try {
    // Verify admin
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

    // ✅ Single query with join to users table
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select(`
        *,
        users (first_name, last_name, email)
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('❌ Admin fetch error:', error);
      return res.status(500).json({ message: 'Failed to fetch messages.' });
    }

    // Build display name
    const messagesWithUser = data.map(m => ({
      ...m,
      userDisplay: m.users
        ? `${m.users.first_name} ${m.users.last_name} (${m.users.email})`
        : m.email
    }));

    res.json({ messages: messagesWithUser });
  } catch (err) {
    console.error('❌ Admin support messages error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// ADMIN: Reply to a support message
// ============================================================
router.post('/admin/support/reply', verifyToken, async (req, res) => {
  const { messageId, reply } = req.body;

  try {
    // Verify admin
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

    if (!messageId || !reply || reply.trim().length < 1) {
      return res.status(400).json({ message: 'Reply is required.' });
    }

    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .update({
        reply: reply.trim(),
        updated_at: new Date().toISOString(),
        is_read: true
      })
      .eq('id', messageId)
      .select('id, user_id, email, message, reply')
      .single();

    if (error) {
      console.error('❌ Reply error:', error);
      return res.status(500).json({ message: 'Failed to send reply.' });
    }

    res.json({ message: 'Reply sent successfully.', data });
  } catch (err) {
    console.error('❌ Reply error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
