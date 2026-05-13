const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb, saveDb } = require('../models/database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const db = await getDb();
    const { email, password, firstName, lastName, phone } = req.body;
    
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = db.exec("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const userId = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    const colors = ['#1a5c3a', '#8b1c1c', '#2a7d6e', '#c4841d', '#1a5c3a', '#a33030', '#3d6b8e'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    db.run(
      "INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, email, hash, firstName, lastName, phone || null, avatarColor]
    );

    // Create default INR savings account
    const accountId = uuidv4();
    const accountNumber = 'SB' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
    db.run(
      "INSERT INTO accounts (id, user_id, account_number, account_type, currency, balance) VALUES (?, ?, ?, ?, ?, ?)",
      [accountId, userId, accountNumber, 'savings', 'INR', 50000.00]
    );

    // Create USD account
    const usdAccountId = uuidv4();
    const usdAccountNumber = 'SB' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000) + 'USD';
    db.run(
      "INSERT INTO accounts (id, user_id, account_number, account_type, currency, balance) VALUES (?, ?, ?, ?, ?, ?)",
      [usdAccountId, userId, usdAccountNumber, 'savings', 'USD', 500.00]
    );

    // Seed some initial transactions for analytics
    seedInitialTransactions(db, accountId, userId);

    // Welcome notification
    const notifId = uuidv4();
    db.run(
      "INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)",
      [notifId, userId, 'Welcome to ScalerBank!', 'Your account has been created. Complete KYC to unlock all features.', 'info']
    );

    saveDb();

    const token = jwt.sign({ id: userId, email, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: userId, email, firstName, lastName, avatarColor } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const db = await getDb();
    const { email, password } = req.body;

    const result = db.exec("SELECT * FROM users WHERE email = ?", [email]);
    if (!result.length || !result[0].values.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const cols = result[0].columns;
    const row = result[0].values[0];
    const user = {};
    cols.forEach((c, i) => user[c] = row[i]);

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Audit log
    db.run("INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)",
      [uuidv4(), user.id, 'LOGIN', 'User logged in']);
    saveDb();

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, firstName: user.first_name,
        lastName: user.last_name, phone: user.phone, avatarColor: user.avatar_color,
        kycStatus: user.kyc_status, mfaEnabled: user.mfa_enabled
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get profile
router.get('/profile', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!result.length) return res.status(404).json({ error: 'User not found' });
  
  const cols = result[0].columns;
  const row = result[0].values[0];
  const user = {};
  cols.forEach((c, i) => user[c] = row[i]);
  
  delete user.password_hash;
  delete user.mfa_secret;
  res.json(user);
});

// Update KYC
router.post('/kyc', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { aadhaar, pan } = req.body;
  db.run("UPDATE users SET kyc_status = 'verified', kyc_aadhaar = ?, kyc_pan = ?, updated_at = datetime('now') WHERE id = ?",
    [aadhaar, pan, req.user.id]);
  
  db.run("INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)",
    [uuidv4(), req.user.id, 'KYC Verified', 'Your identity has been verified successfully.', 'success']);
  saveDb();
  res.json({ status: 'verified' });
});

// Toggle MFA
router.post('/mfa/toggle', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT mfa_enabled FROM users WHERE id = ?", [req.user.id]);
  const current = result[0].values[0][0];
  db.run("UPDATE users SET mfa_enabled = ? WHERE id = ?", [current ? 0 : 1, req.user.id]);
  saveDb();
  res.json({ mfaEnabled: !current });
});

function seedInitialTransactions(db, accountId, userId) {
  const categories = ['food', 'shopping', 'transport', 'entertainment', 'bills', 'health', 'travel', 'education'];
  const descriptions = {
    food: ['Swiggy Order', 'Zomato Dinner', 'BigBasket Groceries', 'Starbucks Coffee', 'Dominos Pizza'],
    shopping: ['Amazon Purchase', 'Flipkart Order', 'Myntra Fashion', 'Croma Electronics'],
    transport: ['Uber Ride', 'Ola Auto', 'Metro Recharge', 'Fuel Station'],
    entertainment: ['Netflix Subscription', 'BookMyShow Tickets', 'Spotify Premium', 'Hotstar'],
    bills: ['Electricity Bill', 'Water Bill', 'Internet Bill', 'Phone Recharge', 'Gas Bill'],
    health: ['Apollo Pharmacy', 'Gym Membership', 'Doctor Visit', 'Practo Consult'],
    travel: ['MakeMyTrip Hotel', 'IRCTC Ticket', 'Flight Booking'],
    education: ['Udemy Course', 'Book Purchase', 'Coursera Sub']
  };

  let balance = 50000;
  const now = new Date();

  for (let i = 60; i >= 0; i--) {
    const txCount = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < txCount; j++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const descs = descriptions[cat];
      const desc = descs[Math.floor(Math.random() * descs.length)];
      const amount = Math.round((Math.random() * 2000 + 50) * 100) / 100;
      const isCredit = Math.random() > 0.8;
      
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(Math.floor(Math.random() * 14) + 8);
      date.setMinutes(Math.floor(Math.random() * 60));
      const dateStr = date.toISOString().replace('T', ' ').slice(0, 19);

      const txId = uuidv4();
      const ledgerId = uuidv4();

      if (isCredit) {
        balance += amount;
        db.run("INSERT INTO transactions (id, to_account_id, amount, type, status, description, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [txId, accountId, amount, 'credit', 'completed', 'Salary Credit', 'income', dateStr]);
        db.run("INSERT INTO ledger_entries (id, account_id, type, amount, reference_id, description, category, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [ledgerId, accountId, 'CREDIT', amount, txId, 'Salary Credit', 'income', balance, dateStr]);
      } else {
        const minBalance = 50000;
        const maxDebit = Math.max(0, balance - minBalance);
        if (maxDebit < 0.01) continue;
        const debitAmount = Math.min(amount, maxDebit);
        balance -= debitAmount;
        db.run("INSERT INTO transactions (id, from_account_id, amount, type, status, description, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [txId, accountId, debitAmount, 'debit', 'completed', desc, cat, dateStr]);
        db.run("INSERT INTO ledger_entries (id, account_id, type, amount, reference_id, description, category, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [ledgerId, accountId, 'DEBIT', debitAmount, txId, desc, cat, balance, dateStr]);
      }
    }
  }

  // Ensure opening balance never drops below onboarding credit (synthetic history cannot overdraw)
  balance = Math.max(50000, Math.round(balance * 100) / 100);
  db.run("UPDATE accounts SET balance = ? WHERE id = ?", [balance, accountId]);
}

module.exports = router;
