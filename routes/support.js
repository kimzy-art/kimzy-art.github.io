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
    console.log('❌ Message too short');
    return res.status(400).json({ message: 'Message must be at least 3 characters.' });
  }

  // Get user email
  console.log(`👤 Fetching user ${userId} email`);
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    console.error('❌ User fetch error:', userError);
    return res.status(404).json({ message: 'User not found.' });
  }

  console.log(`✅ User found: ${user.email}`);

  // Insert message
  console.log('💾 Inserting support message');
  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .insert({
      user_id: userId,
      email: user.email,
      message: message.trim(),
      is_read: false
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('❌ Insert error:', error);
    return res.status(500).json({ message: 'Failed to send message. Database error: ' + error.message });
  }

  console.log('✅ Message inserted, ID:', data.id);
  res.status(201).json({ message: 'Message sent successfully.', data });
});

// ============================================================
// USER: Get user's own support messages (with replies)
// ============================================================
router.get('/support/my-messages', verifyToken, async (req, res) => {
  const userId = req.user.id;
  console.log(`📥 Fetching messages for user ${userId}`);

  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch messages.' });
  }

  // Mark messages as read when user views them
  await supabaseAdmin
    .from('support_messages')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  res.json({ messages: data });
});

// ============================================================
// ADMIN: Get all support messages (with user details)
// ============================================================
router.get('/admin/support/messages', verifyToken, async (req, res) => {
  // Verify admin
  const { data: user, error: adminCheck } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (adminCheck || !user || user.email !== 'admin@gmail.com') {
    console.log('❌ Admin access denied');
    return res.status(403).json({ message: 'Admin access required.' });
  }

  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Admin fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch messages.' });
  }

  // Fetch user names for each message
  const userIds = [...new Set(data.map(m => m.user_id))];
  const { data: users, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, first_name, last_name, email')
    .in('id', userIds);

  const userMap = {};
  if (!userError && users) {
    users.forEach(u => {
      userMap[u.id] = `${u.first_name} ${u.last_name} (${u.email})`;
    });
  }

  const messagesWithUser = data.map(m => ({
    ...m,
    userDisplay: userMap[m.user_id] || m.email
  }));

  res.json({ messages: messagesWithUser });
});

// ============================================================
// ADMIN: Reply to a support message
// ============================================================
router.post('/admin/support/reply', verifyToken, async (req, res) => {
  const { messageId, reply } = req.body;

  // Verify admin
  const { data: user, error: adminCheck } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (adminCheck || !user || user.email !== 'admin@gmail.com') {
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
});

module.exports = router;
