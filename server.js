require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import route modules
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const withdrawRoutes = require('./routes/withdraw');
const transactionsRoutes = require('./routes/transactions');
const investRoutes = require('./routes/invest');
const supportRoutes = require('./routes/support');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// FORCE CORS HEADERS – Must be FIRST
// ============================================================
const ALLOWED_ORIGINS = [
  'http://localhost:5500',
  'http://localhost:3000',
  'https://kimzy-cresta-market.netlify.app',   // ✅ YOUR FRONTEND
  'https://fxsmartbull.netlify.app',
  'https://kimzzy-static-site.netlify.app',
  'https://driplord-001-github-io.onrender.com',
  'https://adorable-sprite-692f2f.netlify.app'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow any of our listed origins (or any origin for testing)
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS preflight handled for:', req.url);
    return res.sendStatus(200);
  }
  next();
});

// Also use cors middleware as backup
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    // Allow all origins for now
    callback(null, true);
  },
  credentials: true
}));

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length) {
    console.log('📦 Body:', req.body);
  }
  next();
});

// ============================================================
// DEBUG ENDPOINTS
// ============================================================
app.get('/api/debug', (req, res) => {
  res.json({
    message: 'Kimzy Backend is reachable!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/check-table', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./supabase/client');
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('id')
      .limit(1);
    if (error) return res.json({ exists: false, error: error.message });
    res.json({ exists: true, data });
  } catch (err) {
    res.json({ exists: false, error: err.message });
  }
});

app.get('/api/env-check', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    BREVO_API_KEY: !!process.env.BREVO_API_KEY,
    FRONTEND_URL: process.env.FRONTEND_URL || 'not set'
  });
});

// ============================================================
// ROUTES
// ============================================================
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', withdrawRoutes);
app.use('/api', transactionsRoutes);
app.use('/api', investRoutes);
app.use('/api', supportRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
  console.log('❌ 404:', req.method, req.url);
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Kimzy Server running on port ${PORT}`);
  console.log(`✅ Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`📦 Routes loaded: auth, user, admin, withdraw, transactions, invest, support`);
});
