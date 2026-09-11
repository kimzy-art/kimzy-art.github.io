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
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('❌ User fetch error:', userError);
      return res.status(404).json({ message: 'User not found.' });
    }

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
      console.error('❌ Insert error:', JSON.stringify(error, null, 2));
      return res.status(500).json({ 
        message: 'Failed to send message.', 
        error: error.message,
        code: error.code,
        details: error.details
      });
    }

    console.log('✅ Message inserted, ID:', data.id);
    res.status(201).json({ message: 'Message sent successfully.', data });
  } catch (err) {
    console.error('❌ Send error:', err);
    res.status(500).json({ message: 'Internal server error: ' + err.message });
  }
});

// ============================================================
// USER: Get user's own support messages
// ============================================================
router.get('/support/my-messages', verifyToken, async (req, res) => {
  const userId = req.user.id;
  console.log(`📥 Fetching messages for user ${userId}`);

  try {
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Fetch error:', JSON.stringify(error, null, 2));
      return res.status(500).json({ message: 'Failed to fetch messages.', error: error.message });
    }

    await supabaseAdmin
      .from('support_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    console.log(`✅ Found ${data.length} messages for user ${userId}`);
    res.json({ messages: data });
  } catch (err) {
    console.error('❌ Fetch error:', err);
    res.status(500).json({ message: 'Internal server error: ' + err.message });
  }
});

// ============================================================
// ADMIN: Get all support messages
// ============================================================
router.get('/admin/support/messages', verifyToken, async (req, res) => {
  console.log('📥 Admin fetching all support messages');
  console.log('👤 Requesting user ID:', req.user.id);

  try {
    // Step 1: Verify admin
    const { data: user, error: adminCheck } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', req.user.id)
      .single();

    if (adminCheck) {
      console.error('❌ Admin check error:', JSON.stringify(adminCheck, null, 2));
      return res.status(403).json({ message: 'Admin access required.', error: adminCheck.message });
    }

    if (!user) {
      return res.status(403).json({ message: 'Admin access required.' });
    }

    console.log('👤 User email:', user.email);

    const adminEmails = ['admin@gmail.com', 'katejackson00001@gmail.com'];
    if (!adminEmails.includes(user.email)) {
      console.log('❌ Admin access denied for:', user.email);
      return res.status(403).json({ message: 'Admin access required.' });
    }

    console.log('✅ Admin access granted');

    // Step 2: Fetch all messages
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Admin fetch error:', JSON.stringify(error, null, 2));
      return res.status(500).json({ 
        message: 'Failed to fetch messages.', 
        error: error.message,
        code: error.code,
        hint: error.hint
      });
    }

    console.log(`✅ Found ${data.length} total messages`);

    // Step 3: Fetch user names
    const userIds = [...new Set(data.map(m => m.user_id).filter(Boolean))];
    console.log('📋 Unique user IDs:', userIds.length);

    let userMap = {};
    if (userIds.length > 0) {
      const { data: users, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', userIds);

      if (userError) {
        console.error('❌ User details fetch error:', JSON.stringify(userError, null, 2));
      } else if (users) {
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
    console.error('❌ Admin fetch error:', err);
    res.status(500).json({ message: 'Internal server error: ' + err.message });
  }
});

// ============================================================
// ADMIN: Reply to a support message
// ============================================================
router.post('/admin/support/reply', verifyToken, async (req, res) => {
  console.log('📩 Admin reply request');
  const { messageId, reply } = req.body;

  try {
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
      console.error('❌ Reply error:', JSON.stringify(error, null, 2));
      return res.status(500).json({ message: 'Failed to send reply.', error: error.message });
    }

    console.log('✅ Reply sent for message ID:', messageId);
    res.json({ message: 'Reply sent successfully.', data });
  } catch (err) {
    console.error('❌ Reply error:', err);
    res.status(500).json({ message: 'Internal server error: ' + err.message });
  }
});

module.exports = router;
