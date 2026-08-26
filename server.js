require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import all route modules
const authRoutes = require('./routes/auth');          // login, register, verify-otp
const userRoutes = require('./routes/user');          // /me, /update-profile
const adminRoutes = require('./routes/admin');        // admin users, otps, balance update
const withdrawRoutes = require('./routes/withdraw');  // /withdraw
const transactionsRoutes = require('./routes/transactions');
const investRoutes = require('./routes/invest');
const supportRoutes = require('./routes/support');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CORS CONFIGURATION – Allow your frontend domains
// ============================================================
const allowedOrigins = [
  'http://localhost:5500',
  'http://localhost:3000',
  'https://resplendent-platypus-de88a4.netlify.app',
  'https://precious-cobbler-0a0716.netlify.app',
  'https://driplord-001-github-io.onrender.com',
  'https://adorable-sprite-692f2f.netlify.app',
  'https://kimzzy-static-site.netlify.app',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// ============================================================
// ROUTES – Mount everything under /api
// ============================================================
app.use('/api', authRoutes);          // /api/login, /api/register, /api/verify-otp
app.use('/api', userRoutes);          // /api/me, /api/update-profile
app.use('/api/admin', adminRoutes);   // /api/admin/users, /api/admin/otps, /api/admin/users/:id/balance
app.use('/api', withdrawRoutes);      // /api/withdraw
app.use('/api', transactionsRoutes);  // /api/transactions
app.use('/api', investRoutes);        // /api/invest, /api/investments
app.use('/api', supportRoutes);       // /api/support/*, /api/admin/support/*

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ============================================================
// CATCH‑ALL FOR UNDEFINED ROUTES
// ============================================================
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`📦 Routes loaded: auth, user, admin, withdraw, transactions, invest, support`);
});
