'use strict';
// Password hashing, session tokens and input validation.
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KEYLEN = 64;

async function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

async function verifyPassword(password, hashHex, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Burn the same CPU time when the user does not exist, so response time does not reveal which IDs are registered.
const DUMMY = { hash: '00'.repeat(KEYLEN), salt: '00'.repeat(16) };
const burnTime = password => verifyPassword(password, DUMMY.hash, DUMMY.salt);

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

// "+91 98221-44832" and "+919822144832" are the same account; Health IDs are case-insensitive.
const normaliseLoginId = raw => String(raw || '').trim().replace(/[\s-]+/g, '').toLowerCase();

function validateRegistration({ name, phone, password }) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  const cleanPhone = String(phone || '').trim();
  const loginId = normaliseLoginId(phone);
  if (cleanName.length < 2 || cleanName.length > 80) return { error: 'Please enter your full name (2-80 characters).' };
  if (!/^\+?[a-z0-9]{4,32}$/.test(loginId)) return { error: 'Enter a valid mobile number or Health ID (4-32 letters/digits).' };
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) return { error: 'Password / PIN must be at least 6 characters.' };
  return { name: cleanName, phone: cleanPhone.slice(0, 40), loginId };
}

module.exports = { SESSION_TTL_MS, hashPassword, verifyPassword, burnTime, newToken, hashToken, normaliseLoginId, validateRegistration };
