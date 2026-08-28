const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../supabase/client');
const axios = require('axios');

// ============================================================
// Brevo Email Helper
// ============================================================
const sendBrevoEmail = async (to, subject, htmlContent) => {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'Cresta Markets <jimmydarts404@gmail.com>';
    const fromAddress = fromEmail.split('<')[1]?.replace('>', '') || fromEmail;

    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'Cresta Markets', email: fromAddress },
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlContent
      },
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.status === 201 || response.status === 200;
  } catch (error) {
    console.error('Brevo email error:', error.response?.data || error.message);
    return false;
  }
};

// ============================================================
// OTP Generation
// ============================================================
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ============================================================
// REGISTER – Step 1: Send OTP
// ============================================================
router.post('/register', async (req, res) => {
  const { email, firstName, lastName, phone, country } = req.body;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ message: 'Email, first name, and last name are required.' });
  }

  // Check if already verified
  const { data: existing, error: checkError } = await supabaseAdmin
    .from('users')
    .select('email, verified')
    .eq('email', email)
    .maybeSingle();

  if (existing && existing.verified) {
    return res.status(409).json({ message: 'Email already registered.' });
  }

  // Generate OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Delete existing OTP
  await supabaseAdmin.from('otp_codes').delete().eq('email', email);

  // Insert new OTP
  const { error: insertError } = await supabaseAdmin
    .from('otp_codes')
    .insert({
      email,
      code: otp,
      expires_at: expiresAt.toISOString()
    });

  if (insertError) {
    console.error('OTP insert error:', insertError);
    return res.status(500).json({ message: 'Failed to generate OTP.' });
  }

  // Send OTP via Brevo
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0A0A0A; color: #3B82F6; padding: 30px; border-radius: 16px; border: 1px solid #3B82F6;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #3B82F6; font-weight: 800; font-size: 28px; letter-spacing: 2px; margin: 0;">Cresta Markets</h1>
        <hr style="border-color: rgba(59,130,246,0.2);" />
      </div>
      <p style="color: #ffffff; font-size: 16px;">Hello ${firstName},</p>
      <p style="color: #ffffff;">Your verification code is:</p>
      <div style="text-align: center; font-size: 40px; font-weight: bold; letter-spacing: 6px; background: rgba(59,130,246,0.08); padding: 18px; border-radius: 12px; border: 1px solid #3B82F6; color: #3B82F6; margin: 20px 0;">
        ${otp}
      </div>
      <p style="color: #ffffff;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="color: #999; font-size: 14px;">If you didn't request this, please ignore this email.</p>
      <hr style="border-color: rgba(59,130,246,0.1);" />
      <p style="color: #666; font-size: 12px; text-align: center;">© 2026 Cresta Markets. All rights reserved.</p>
    </div>
  `;

  const sent = await sendBrevoEmail(email, 'Your Cresta Markets Verification Code', htmlContent);
  if (!sent) {
    return res.status(500).json({ message: 'Failed to send OTP email. Please try again.' });
  }

  res.status(200).json({ message: 'OTP sent to your email.' });
});

// ============================================================
// REGISTER – Step 2: Verify OTP and create account
// ============================================================
router.post('/verify-otp', async (req, res) => {
  const { email, otp, firstName, lastName, phone, country, password } = req.body;

  if (!email || !otp || !firstName || !lastName || !password) {
    return res.status(400).json({ message: 'Email, OTP, first name, last name, and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  // Verify OTP
  const { data: otpRecord, error: otpError } = await supabaseAdmin
    .from('otp_codes')
    .select('*')
    .eq('email', email)
    .eq('code', otp)
    .single();

  if (otpError || !otpRecord) {
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  if (new Date(otpRecord.expires_at) < new Date()) {
    return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
  }

  // Delete OTP after use
  await supabaseAdmin.from('otp_codes').delete().eq('email', email);

  // Check if user already exists (unverified)
  const { data: existingUser, error: userCheckError } = await supabaseAdmin
    .from('users')
    .select('id, verified')
    .eq('email', email)
    .maybeSingle();

  if (existingUser && existingUser.verified) {
    return res.status(409).json({ message: 'Email already registered.' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  let userId;
  if (existingUser && !existingUser.verified) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        country: country || null,
        password_hash: passwordHash,
        verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingUser.id)
      .select('id')
      .single();

    if (updateError || !updated) {
      console.error('Update user error:', updateError);
      return res.status(500).json({ message: 'Failed to update user.' });
    }
    userId = updated.id;
  } else {
    const { data: newUser, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        country: country || null,
        password_hash: passwordHash,
        verified: true,
        balance: 0.00
      })
      .select('id')
      .single();

    if (createError || !newUser) {
      console.error('Create user error:', createError);
      return res.status(500).json({ message: 'Failed to create account.' });
    }
    userId = newUser.id;
  }

  const token = jwt.sign(
    { id: userId, email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    message: 'Account created successfully.',
    token,
    user: { id: userId, email, firstName, lastName }
  });
});

// ============================================================
// LOGIN
// ============================================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, password_hash, verified')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  if (!user.verified) {
    return res.status(401).json({ message: 'Please verify your email first.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    message: 'Login successful.',
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name
    }
  });
});

module.exports = router;
