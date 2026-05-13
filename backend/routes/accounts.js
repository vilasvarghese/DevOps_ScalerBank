const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, saveDb } = require('../models/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get all accounts for user
router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at", [req.user.id]);
  if (!result.length) return res.json([]);
  const accounts = result[0].values.map(row => {
    const obj = {};
    result[0].columns.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
  res.json(accounts);
});

// Get single account with recent ledger entries
router.get('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM accounts WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Account not found' });

  const cols = result[0].columns;
  const account = {};
  cols.forEach((c, i) => account[c] = result[0].values[0][i]);

  const ledger = db.exec(
    "SELECT * FROM ledger_entries WHERE account_id = ? ORDER BY created_at DESC LIMIT 50",
    [req.params.id]
  );
  account.ledger = ledger.length ? ledger[0].values.map(row => {
    const obj = {};
    ledger[0].columns.forEach((c, i) => obj[c] = row[i]);
    return obj;
  }) : [];

  res.json(account);
});

// Create new account (multi-currency)
router.post('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { currency = 'INR', accountType = 'savings' } = req.body;
  const openingBalance = currency === 'USD' ? 500 : 50000;
  
  const accountId = uuidv4();
  const accountNumber = 'SB' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
  
  db.run(
    "INSERT INTO accounts (id, user_id, account_number, account_type, currency, balance) VALUES (?, ?, ?, ?, ?, ?)",
    [accountId, req.user.id, accountNumber, accountType, currency, openingBalance]
  );
  saveDb();
  
  res.status(201).json({ id: accountId, account_number: accountNumber, currency, balance: openingBalance });
});

module.exports = router;
