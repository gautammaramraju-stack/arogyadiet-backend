/**
 * Arogyadiet Backend API
 * Meal Subscription Order Management & Auto Driver Assignment.
 * Uses JSON file for persistence. Replace with MySQL when ready.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');
const IST_TZ = 'Asia/Kolkata';

function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: IST_TZ }));
}

function toISTDateStr(d) {
  return new Date(d).toLocaleString('en-CA', { timeZone: IST_TZ }).slice(0, 10);
}

function isBeforeDailyCutoff() {
  const now = nowIST();
  return now.getHours() < 17 || (now.getHours() === 17 && now.getMinutes() === 0);
}

function isAfterAssignTime() {
  const now = nowIST();
  return now.getHours() > 17 || (now.getHours() === 17 && now.getMinutes() >= 30);
}

function getDeliveryStartDate(subscribedAt) {
  const t = new Date(subscribedAt);
  const ist = new Date(t.toLocaleString('en-US', { timeZone: IST_TZ }));
  if (ist.getHours() < 17) {
    ist.setDate(ist.getDate() + 1);
  } else {
    ist.setDate(ist.getDate() + 2);
  }
  return ist.toLocaleString('en-CA', { timeZone: IST_TZ }).slice(0, 10);
}

function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      users: d.users || {},
      franchises: d.franchises || [],
      customers: d.customers || [],
      subscriptions: d.subscriptions || [],
      drivers: d.drivers || [],
      deliveries: d.deliveries || [],
      orders: d.orders || [],
      driverPincodeMappings: d.driverPincodeMappings || [],
      driverLocationLog: d.driverLocationLog || [],
      notifications: d.notifications || []
    };
  } catch (e) {
    return { users: {}, franchises: [], customers: [], subscriptions: [], drivers: [], deliveries: [], orders: [], driverPincodeMappings: [], driverLocationLog: [], notifications: [] };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// Role-based access: read user from headers (X-User-Email, X-User-Role, X-User-Franchise-Id, X-User-Driver-Id)
function getReqUser(req) {
  return {
    email: (req.get('X-User-Email') || '').trim().toLowerCase(),
    role: req.get('X-User-Role') || '',
    franchiseId: req.get('X-User-Franchise-Id') ? parseInt(req.get('X-User-Franchise-Id'), 10) : null,
    driverId: req.get('X-User-Driver-Id') ? parseInt(req.get('X-User-Driver-Id'), 10) : null
  };
}
function canAccessCustomer(requester, targetEmail) {
  if (!targetEmail) return false;
  const te = String(targetEmail).trim().toLowerCase();
  if (requester.role === 'master') return true;
  if (requester.role === 'admin' && requester.franchiseId) {
    data = loadData();
    const sub = (data.subscriptions || []).find(s => (s.email || '').toLowerCase() === te);
    const cust = (data.customers || []).find(c => (c.email || '').toLowerCase() === te);
    const fid = sub ? sub.franchiseId : (cust ? cust.franchiseId : null);
    return fid === requester.franchiseId;
  }
  if (requester.role === 'customer') return requester.email === te;
  return false;
}
function canAccessDriver(requester, targetDriverId) {
  if (requester.role === 'master') return true;
  if (requester.role === 'admin' && requester.franchiseId) {
    data = loadData();
    const d = (data.drivers || []).find(x => x.id === targetDriverId);
    return d && d.franchiseId === requester.franchiseId;
  }
  if (requester.role === 'driver') return requester.driverId === targetDriverId;
  return false;
}

// Blocked demo emails — these must never be allowed to login
const BLOCKED_EMAILS = new Set([
  'customer1@demo.com', 'customer2@demo.com', 'customer3@demo.com',
  'driver1@demo.com', 'driver2@demo.com', 'driver3@demo.com',
  'admin1@demo.com', 'admin2@demo.com', 'master@demo.com'
]);

// Auth: POST /api/auth/login — returns user with franchiseId (admin), driverId (driver)
app.post('/api/auth/login', (req, res) => {
  data = loadData();
  const users = data.users || {};
  const { email, password, role } = req.body || {};
  const emailKey = (email || '').toString().trim().toLowerCase();
  if (BLOCKED_EMAILS.has(emailKey)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const u = users[emailKey];
  if (!u || u.password !== password || (role && u.role !== role)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const { password: _, ...user } = u;
  user.email = emailKey;
  if (user.role === 'driver' && !user.driverId) {
    const dr = (data.drivers || []).find(d => (d.email || '').toLowerCase() === user.email);
    if (dr) user.driverId = dr.id;
  }
  if (user.role === 'admin' && user.franchiseId == null) user.franchiseId = 1;
  res.json({ token: 'demo-token-' + Date.now(), user });
});

// Register: POST /api/auth/register (single user: role, email, password, name; admin may send franchiseId)
app.post('/api/auth/register', (req, res) => {
  data = loadData();
  if (!data.users) data.users = {};
  const { role, email, password, name, franchiseId, franchiseName } = req.body || {};
  const emailKey = (email || '').toString().trim().toLowerCase();
  if (!emailKey || !password || !role) {
    return res.status(400).json({ error: 'Missing email, password, or role' });
  }
  if (data.users[emailKey]) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  const base = { role, password, name: (name || emailKey).toString().trim() };
  if (role === 'admin') {
    base.franchiseId = franchiseId || 1;
    base.franchiseName = franchiseName || 'Jubilee Hills';
  }
  if (role === 'customer') base.userId = Object.keys(data.users).filter(e => data.users[e].role === 'customer').length + 1;
  if (role === 'driver') {
    const drivers = data.drivers || [];
    const nextId = drivers.length ? Math.max(...drivers.map(d => d.id)) + 1 : 1;
    base.driverId = nextId;
    drivers.push({ id: nextId, name: base.name, email: emailKey, phone: '', vehicle: 'Bike', franchiseId: 1, franchiseName: 'Jubilee Hills', status: 'active', createdAt: new Date().toISOString() });
    data.drivers = drivers;
  }
  data.users[emailKey] = base;
  saveData(data);
  res.status(201).json({ message: 'Account created', email: emailKey });
});

// Franchises list (from data.json)
app.get('/api/franchises', (req, res) => {
  data = loadData();
  const franchises = data.franchises && data.franchises.length ? data.franchises : [
    { id: 1, code: 'JHL001', name: 'Jubilee Hills', location: 'Hyderabad', customers: 0, activeSubs: 0, revenue: 0 },
    { id: 2, code: 'MDP001', name: 'Madhapur', location: 'Hyderabad', customers: 0, activeSubs: 0, revenue: 0 }
  ];
  res.json(franchises);
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Stats: GET /api/stats — role-based (customer: email; admin: franchiseId; master: all)
app.get('/api/stats', (req, res) => {
  data = loadData();
  const ru = getReqUser(req);
  const subs = data.subscriptions || [];
  const orders = data.orders || [];
  const deliveries = data.deliveries || [];
  const customers = data.customers || [];
  const drivers = data.drivers || [];
  const today = toISTDateStr(new Date());
  let activeSubs = 0, pausedSubs = 0, expiringSoon = 0, totalRevenue = 0, totalCustomers = 0, todayOrders = 0, todayDelivered = 0;
  let customerMealsDelivered = 0, customerActiveDays = 0, customerBufferDays = 7;
  if (ru.role === 'customer' && ru.email) {
    const email = ru.email.toLowerCase();
    const mySubs = subs.filter(s => (s.email || '').toLowerCase() === email);
    const myOrders = orders.filter(o => (o.email || '').toLowerCase() === email);
    customerMealsDelivered = myOrders.filter(o => o.status === 'delivered').length;
    activeSubs = mySubs.filter(s => s.status === 'active').length;
    pausedSubs = mySubs.filter(s => s.status === 'paused').length;
    const active = mySubs.find(s => s.status === 'active');
    if (active) {
      const todayD = new Date(today);
      const start = new Date(active.startDate);
      const end = new Date(active.endDate);
      customerActiveDays = Math.max(0, Math.floor((todayD - start) / 86400000)) + 1;
      if (todayD > end) customerActiveDays = Math.floor((end - start) / 86400000) + 1;
      customerBufferDays = active.bufferDays || 7;
    }
    res.json({ activeSubs, pausedSubs, customerMealsDelivered, customerActiveDays, customerBufferDays });
    return;
  }
  if (ru.role === 'admin' && ru.franchiseId) {
    const fid = ru.franchiseId;
    activeSubs = subs.filter(s => s.franchiseId === fid && s.status === 'active').length;
    pausedSubs = subs.filter(s => s.franchiseId === fid && s.status === 'paused').length;
    const end3 = new Date(today); end3.setDate(end3.getDate() + 3);
    expiringSoon = subs.filter(s => s.franchiseId === fid && s.status === 'active' && new Date(s.endDate) <= end3 && new Date(s.endDate) >= new Date(today)).length;
    todayOrders = orders.filter(o => o.franchiseId === fid && o.delivery_date === today).length;
    todayDelivered = orders.filter(o => o.franchiseId === fid && o.delivery_date === today && o.status === 'delivered').length;
    const todayDel = deliveries.filter(d => d.franchiseId === fid && d.scheduledDate === today);
    todayOrders += todayDel.length;
    todayDelivered += todayDel.filter(d => d.status === 'delivered').length;
    res.json({ activeSubs, pausedSubs, expiringSoon, todayOrders, todayDelivered });
    return;
  }
  if (ru.role === 'master') {
    activeSubs = subs.filter(s => s.status === 'active').length;
    pausedSubs = subs.filter(s => s.status === 'paused').length;
    totalRevenue = subs.reduce((sum, s) => sum + (parseInt(s.price, 10) || 0), 0);
    totalCustomers = new Set([...subs.map(s => (s.email || '').toLowerCase()), ...customers.map(c => (c.email || '').toLowerCase())].filter(Boolean)).size;
    todayOrders = orders.filter(o => o.delivery_date === today).length;
    todayDelivered = orders.filter(o => o.delivery_date === today && o.status === 'delivered').length;
    const todayDel = deliveries.filter(d => d.scheduledDate === today);
    todayOrders += todayDel.length;
    todayDelivered += todayDel.filter(d => d.status === 'delivered').length;
    const franchiseStats = (data.franchises || []).map(f => {
      const fid = f.id;
      const fSubs = subs.filter(s => s.franchiseId === fid);
      const fCust = new Set(fSubs.map(s => (s.email || '').toLowerCase()).filter(Boolean)).size;
      const fRev = fSubs.reduce((s, x) => s + (parseInt(x.price, 10) || 0), 0);
      return { id: fid, name: f.name, admins: 0, customers: fCust, activeSubs: fSubs.filter(s => s.status === 'active').length, revenue: fRev };
    });
    res.json({ activeSubs, pausedSubs, totalRevenue, totalCustomers, todayOrders, todayDelivered, franchiseStats });
    return;
  }
  res.json({});
});

// Customers: GET /api/customers/me — customer's own profile (from customers or first subscription)
app.get('/api/customers/me', (req, res) => {
  data = loadData();
  const ru = getReqUser(req);
  if (ru.role !== 'customer' || !ru.email) return res.status(403).json({ error: 'Access denied' });
  const email = ru.email.toLowerCase();
  let cust = (data.customers || []).find(c => (c.email || '').toLowerCase() === email);
  if (!cust) {
    const sub = (data.subscriptions || []).find(s => (s.email || '').toLowerCase() === email);
    if (sub) cust = { name: sub.customerName || sub.email, email: sub.email, phone: sub.phone, address: sub.address, location: '' };
    else cust = { name: ru.email.split('@')[0], email: ru.email, phone: '', address: '', location: '' };
  }
  res.json(cust);
});

// Customers: PATCH /api/customers/me — customer update own profile
app.patch('/api/customers/me', (req, res) => {
  data = loadData();
  const ru = getReqUser(req);
  if (ru.role !== 'customer' || !ru.email) return res.status(403).json({ error: 'Access denied' });
  const email = ru.email.toLowerCase();
  let customers = data.customers || [];
  let idx = customers.findIndex(c => (c.email || '').toLowerCase() === email);
  const updates = req.body || {};
  if (idx < 0) {
    const sub = (data.subscriptions || []).find(s => (s.email || '').toLowerCase() === email);
    const id = customers.length ? Math.max(...customers.map(x => x.id)) + 1 : 1;
    customers.push({
      id, name: updates.name || sub?.customerName || email, email, phone: updates.phone || sub?.phone || '',
      address: updates.address || sub?.address || '', location: updates.location || '', franchiseId: sub?.franchiseId || 1, franchiseName: sub?.franchiseName || 'Jubilee Hills',
      status: 'active', createdAt: new Date().toISOString()
    });
    idx = customers.length - 1;
  } else {
    if (updates.name !== undefined) customers[idx].name = updates.name;
    if (updates.phone !== undefined) customers[idx].phone = updates.phone;
    if (updates.address !== undefined) customers[idx].address = updates.address;
    if (updates.location !== undefined) customers[idx].location = updates.location;
  }
  data.customers = customers;
  saveData(data);
  res.json(customers[idx]);
});

// Customers: GET /api/customers?franchiseId=1
app.get('/api/customers', (req, res) => {
  data = loadData();
  let customers = data.customers || [];
  const ru = getReqUser(req);
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  if (ru.role === 'admin') {
    customers = customers.filter(c => c.franchiseId === ru.franchiseId);
  } else if (ru.role === 'master') {
    if (franchiseId) customers = customers.filter(c => c.franchiseId === franchiseId);
  } else if (ru.role === 'customer') {
    return res.status(403).json({ error: 'Access denied' });
  } else if (franchiseId) {
    customers = customers.filter(c => c.franchiseId === franchiseId);
  }
  res.json(customers);
});

// Customers: POST /api/customers
app.post('/api/customers', (req, res) => {
  data = loadData();
  const customers = data.customers || [];
  const c = req.body || {};
  const id = customers.length ? Math.max(...customers.map(x => x.id)) + 1 : 1;
  const customer = {
    id,
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || '',
    altPhone: c.altPhone || '',
    location: c.location || '',
    address: c.address || '',
    foodPreference: c.foodPreference || {}, // { monday: 'Veg', tuesday: 'Non-Veg', ... }
    dietReasons: Array.isArray(c.dietReasons) ? c.dietReasons : (c.dietReasons ? [c.dietReasons] : []),
    startDate: c.startDate || '',
    noOfDays: parseInt(c.noOfDays, 10) || 30,
    franchiseId: c.franchiseId || 1,
    franchiseName: c.franchiseName || 'Jubilee Hills',
    status: 'active',
    createdAt: new Date().toISOString()
  };
  customers.push(customer);
  data.customers = customers;
  saveData(data);
  res.status(201).json(customer);
});

// Customers: POST /api/customers/import (Excel - base64 in body)
app.post('/api/customers/import', (req, res) => {
  data = loadData();
  const customers = data.customers || [];
  const { base64, franchiseId = 1, franchiseName = 'Jubilee Hills' } = req.body || {};
  if (!base64) return res.status(400).json({ error: 'Missing base64 Excel data' });
  try {
    const buf = Buffer.from(base64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]] || wb.Sheets['Sheet1'];
    if (!ws) return res.status(400).json({ error: 'No sheet found' });
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) return res.json({ imported: 0, message: 'No data rows' });
    const headers = rows[0];
    const dayCols = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const dayIdx = headers.findIndex(h => (h || '').toString().toLowerCase().includes('monday'));
    const monIdx = dayIdx >= 0 ? dayIdx : 1; // customer database.xlsx: col 1 = Monday
    // Map columns: customer database.xlsx has Timestamp, Mon-Sun pref, Address, Name, Reason, StartDate, Phone, Location, AltPhone, NoOfDays, Email
    const findCol = (pred, fallback) => { const i = headers.findIndex(pred); return i >= 0 ? i : fallback; };
    const colMap = {
      name: findCol(h => /^name$/i.test((h || '').toString().trim()), 9),
      email: findCol(h => (h || '').toString().toLowerCase().includes('email'), 16),
      phone: findCol(h => (h || '').toString().toLowerCase().includes('phone') && !(h || '').toString().toLowerCase().includes('alternative'), 12),
      altPhone: findCol(h => (h || '').toString().toLowerCase().includes('alternative'), 14),
      address: findCol(h => (h || '').toString().toLowerCase().match(/house|apartment|villa|community|flat/), 8),
      location: findCol(h => (h || '').toString().toLowerCase() === 'location', 13),
      dietReasons: findCol(h => (h || '').toString().toLowerCase().includes('reason'), 10),
      startDate: findCol(h => (h || '').toString().toLowerCase().includes('start date'), 11),
      noOfDays: findCol(h => (h || '').toString().toLowerCase().includes('no of days'), 15)
    };
    let nextId = customers.length ? Math.max(...customers.map(x => x.id)) + 1 : 1;
    const imported = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const email = (r[colMap.email] || '').toString().trim();
      const name = (r[colMap.name] || '').toString().trim();
      if (!email && !name) continue;
      const foodPref = {};
      for (let d = 0; d < 7; d++) {
        const val = (r[monIdx + d] || '').toString().trim();
        if (val) foodPref[dayCols[d]] = val;
      }
      const customer = {
        id: nextId++,
        name: name || email,
        email: email || `imported-${nextId}@temp.local`,
        phone: (r[colMap.phone] || '').toString().trim(),
        altPhone: (r[colMap.altPhone] || '').toString().trim(),
        location: (r[colMap.location] || '').toString().trim(),
        address: (r[colMap.address] || '').toString().trim(),
        foodPreference: foodPref,
        dietReasons: (r[colMap.dietReasons] || '').toString().split(/[,;|]/).map(s => s.trim()).filter(Boolean),
        startDate: (r[colMap.startDate] || '').toString().trim(),
        noOfDays: parseInt(r[colMap.noOfDays], 10) || 30,
        franchiseId,
        franchiseName,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      customers.push(customer);
      imported.push(customer);
    }
    data.customers = customers;
    saveData(data);
    res.json({ imported: imported.length, customers: imported });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// Drivers: GET /api/drivers?franchiseId=1
app.get('/api/drivers', (req, res) => {
  data = loadData();
  let drivers = data.drivers || [];
  const ru = getReqUser(req);
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  if (ru.role === 'admin') {
    drivers = drivers.filter(d => d.franchiseId === ru.franchiseId);
  } else if (ru.role === 'master') {
    if (franchiseId) drivers = drivers.filter(d => d.franchiseId === franchiseId);
  } else if (ru.role === 'driver') {
    const did = ru.driverId ? parseInt(ru.driverId, 10) : null;
    if (did) drivers = drivers.filter(d => d.id === did);
    else drivers = [];
  } else if (franchiseId) {
    drivers = drivers.filter(d => d.franchiseId === franchiseId);
  }
  res.json(drivers);
});

// Drivers: POST /api/drivers
app.post('/api/drivers', (req, res) => {
  data = loadData();
  const drivers = data.drivers || [];
  const d = req.body || {};
  const id = drivers.length ? Math.max(...drivers.map(x => x.id)) + 1 : 1;
  const driver = {
    id,
    name: d.name || '',
    phone: d.phone || '',
    email: d.email || '',
    vehicle: d.vehicle || 'Bike',
    franchiseId: d.franchiseId || 1,
    franchiseName: d.franchiseName || 'Jubilee Hills',
    assignedPincodes: Array.isArray(d.assignedPincodes) ? d.assignedPincodes : (d.assignedPincodes ? [d.assignedPincodes] : []),
    currentLat: null,
    currentLng: null,
    lastLocationAt: null,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  drivers.push(driver);
  data.drivers = drivers;
  saveData(data);
  res.status(201).json(driver);
});

// Drivers: PATCH /api/drivers/:id — driver updates own profile (name, phone, vehicle)
app.patch('/api/drivers/:id', (req, res) => {
  data = loadData();
  const drivers = data.drivers || [];
  const id = parseInt(req.params.id, 10);
  const idx = drivers.findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Driver not found' });
  const ru = getReqUser(req);
  if (ru.role === 'driver' && ru.driverId !== id) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'admin' && !canAccessDriver(ru, id)) return res.status(403).json({ error: 'Access denied' });
  const updates = req.body || {};
  if (updates.name !== undefined) drivers[idx].name = updates.name;
  if (updates.phone !== undefined) drivers[idx].phone = updates.phone;
  if (updates.vehicle !== undefined) drivers[idx].vehicle = updates.vehicle;
  data.drivers = drivers;
  saveData(data);
  res.json(drivers[idx]);
});

// Deliveries: GET /api/deliveries?franchiseId=1&driverId=1&status=assigned
app.get('/api/deliveries', (req, res) => {
  data = loadData();
  let deliveries = data.deliveries || [];
  const ru = getReqUser(req);
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  const driverId = req.query.driverId ? parseInt(req.query.driverId, 10) : null;
  const status = req.query.status || null;
  if (ru.role === 'admin') {
    deliveries = deliveries.filter(d => d.franchiseId === ru.franchiseId);
  } else if (ru.role === 'master') {
    if (franchiseId) deliveries = deliveries.filter(d => d.franchiseId === franchiseId);
  } else if (ru.role === 'driver') {
    if (ru.driverId) deliveries = deliveries.filter(d => d.driverId === ru.driverId);
    else deliveries = [];
  } else {
    if (franchiseId) deliveries = deliveries.filter(d => d.franchiseId === franchiseId);
  }
  if (driverId) deliveries = deliveries.filter(d => d.driverId === driverId);
  if (status) deliveries = deliveries.filter(d => d.status === status);
  res.json(deliveries);
});

// Deliveries: POST /api/deliveries (create delivery)
app.post('/api/deliveries', (req, res) => {
  data = loadData();
  const deliveries = data.deliveries || [];
  const d = req.body || {};
  const id = deliveries.length ? Math.max(...deliveries.map(x => x.id)) + 1 : 1;
  const franchiseId = d.franchiseId || 1;
  const scheduledDate = d.scheduledDate || new Date().toISOString().split('T')[0];
  const drivers = data.drivers || [];
  const franchiseDrivers = drivers.filter(dr => (dr.franchiseId || 1) == franchiseId && (dr.status || 'active') === 'active');
  const todayDeliveries = deliveries.filter(del => del.scheduledDate === scheduledDate && del.driverId);
  const driverCounts = {};
  todayDeliveries.forEach(del => { driverCounts[del.driverId] = (driverCounts[del.driverId] || 0) + 1; });
  let driverId = d.driverId || null, driverName = d.driverName || '', driverPhone = '';
  if (!driverId && franchiseDrivers.length) {
    const sorted = franchiseDrivers.map(dr => ({ ...dr, count: driverCounts[dr.id] || 0 })).sort((a, b) => a.count - b.count);
    const chosen = sorted[0];
    driverId = chosen.id; driverName = chosen.name || ''; driverPhone = chosen.phone || '';
  }
  const delivery = {
    id,
    customerId: d.customerId || null,
    customerName: d.customerName || '',
    customerPhone: d.customerPhone || '',
    address: d.address || '',
    lat: d.lat || null,
    lng: d.lng || null,
    type: d.type || 'meals', // 'meals' | 'kit'
    items: d.items || [], // kit order items: [{ name, price, quantity }]
    driverId,
    driverName,
    driverPhone,
    pickupTime: d.pickupTime || null,
    deliveredAt: d.deliveredAt || null,
    status: driverId ? 'assigned' : 'pending',
    franchiseId,
    franchiseName: d.franchiseName || 'Jubilee Hills',
    scheduledDate,
    createdAt: new Date().toISOString()
  };
  deliveries.push(delivery);
  data.deliveries = deliveries;
  saveData(data);
  res.status(201).json(delivery);
});

// Deliveries: PATCH /api/deliveries/:id (assign driver, update status, pickup/delivery times)
app.patch('/api/deliveries/:id', (req, res) => {
  data = loadData();
  const deliveries = data.deliveries || [];
  const id = parseInt(req.params.id, 10);
  const idx = deliveries.findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Delivery not found' });
  const updates = req.body || {};
  if (updates.driverId !== undefined) {
    deliveries[idx].driverId = updates.driverId;
    deliveries[idx].driverName = updates.driverName || '';
    deliveries[idx].driverPhone = updates.driverPhone || null;
    deliveries[idx].status = 'assigned';
  }
  if (updates.status) deliveries[idx].status = updates.status;
  if (updates.pickupTime) deliveries[idx].pickupTime = updates.pickupTime;
  if (updates.deliveredAt) deliveries[idx].deliveredAt = updates.deliveredAt;
  data.deliveries = deliveries;
  saveData(data);
  res.json(deliveries[idx]);
});

// Subscriptions: GET /api/subscriptions?franchiseId=1&customerId=1&email=x&viewAs=x&status=active
app.get('/api/subscriptions', (req, res) => {
  data = loadData();
  let subs = data.subscriptions || [];
  const ru = getReqUser(req);
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  const customerId = req.query.customerId ? parseInt(req.query.customerId, 10) : null;
  let email = req.query.email || null;
  const viewAs = req.query.viewAs ? req.query.viewAs.trim().toLowerCase() : null;
  const status = req.query.status || null;
  if (ru.role === 'customer') {
    email = ru.email || email;
    if (email && viewAs && viewAs !== ru.email) return res.status(403).json({ error: 'Access denied' });
    if (email) subs = subs.filter(s => (s.email || '').toLowerCase() === email.toLowerCase());
  } else if (ru.role === 'admin') {
    if (viewAs) {
      if (!canAccessCustomer(ru, viewAs)) return res.status(403).json({ error: 'Access denied to this customer' });
      subs = subs.filter(s => (s.email || '').toLowerCase() === viewAs);
    } else if (franchiseId != null && franchiseId === ru.franchiseId) {
      subs = subs.filter(s => s.franchiseId === franchiseId);
    } else if (!franchiseId) {
      subs = subs.filter(s => s.franchiseId === ru.franchiseId);
    }
  } else if (ru.role === 'master') {
    if (viewAs) subs = subs.filter(s => (s.email || '').toLowerCase() === viewAs);
    else if (franchiseId) subs = subs.filter(s => s.franchiseId === franchiseId);
  } else {
    if (franchiseId) subs = subs.filter(s => s.franchiseId === franchiseId);
    if (customerId) subs = subs.filter(s => s.customerId === customerId);
    if (email) subs = subs.filter(s => (s.email || '').toLowerCase() === email.toLowerCase());
  }
  if (status) subs = subs.filter(s => s.status === status);
  res.json(subs);
});

// Subscriptions: POST /api/subscriptions (computes delivery_start_date from subscription time IST)
app.post('/api/subscriptions', (req, res) => {
  data = loadData();
  const subs = data.subscriptions || [];
  const orders = data.orders || [];
  const s = req.body || {};
  const noOfDays = parseInt(s.noOfDays, 10) || 30;
  const subscribedAt = new Date().toISOString();
  const deliveryStartDate = getDeliveryStartDate(subscribedAt);
  const start = new Date(deliveryStartDate);
  const end = new Date(start);
  end.setDate(end.getDate() + noOfDays);
  const endDate = end.toISOString().split('T')[0];
  const id = subs.length ? Math.max(...subs.map(x => x.id)) + 1 : 1;
  const skipMealDates = Array.isArray(s.skipMealDates) ? s.skipMealDates : [];
  const pauseDates = Array.isArray(s.pauseDates) ? s.pauseDates : [];
  const pauseRanges = Array.isArray(s.pauseRanges) ? s.pauseRanges : [];
  const pauseSet = new Set(pauseDates);
  pauseRanges.forEach(r => {
    if (r.from && r.to) {
      const from = new Date(r.from);
      const to = new Date(r.to);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) pauseSet.add(d.toISOString().split('T')[0]);
    }
  });
  const sub = {
    id,
    customerId: s.customerId || null,
    customerName: s.customerName || '',
    email: (s.email || '').trim().toLowerCase(),
    phone: s.phone || '',
    address: s.address || '',
    pincode: (s.pincode || '').toString().trim() || null,
    plan: s.plan || 'veg',
    noOfDays,
    price: parseInt(s.price, 10) || 26250,
    startDate: deliveryStartDate,
    endDate,
    delivery_start_date: deliveryStartDate,
    bufferDays: 7,
    status: s.status || 'active',
    foodPreference: s.foodPreference || {},
    dietReasons: Array.isArray(s.dietReasons) ? s.dietReasons : (s.dietReasons ? [s.dietReasons] : []),
    allergies: Array.isArray(s.allergies) ? s.allergies : (s.allergies ? [s.allergies] : []),
    franchiseId: s.franchiseId || 1,
    franchiseName: s.franchiseName || 'Jubilee Hills',
    skipMealDates,
    pauseDates: Array.from(pauseSet),
    pauseRanges,
    pausedFrom: null,
    pausedTo: null,
    createdAt: subscribedAt
  };
  subs.push(sub);
  let orderIdMax = orders.length ? Math.max(...orders.map(x => x.id)) : 0;
  const createdOrders = [];
  for (let d = new Date(deliveryStartDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    if (pauseSet.has(dateStr) || skipMealDates.includes(dateStr)) continue;
    orderIdMax++;
    const order = {
      id: orderIdMax,
      subscriptionId: id,
      customerId: sub.customerId,
      customerName: sub.customerName,
      email: sub.email,
      phone: sub.phone,
      address: sub.address,
      pincode: sub.pincode,
      allergies: sub.allergies || [],
      delivery_date: dateStr,
      status: 'pending',
      driverId: null,
      driverName: null,
      driverPhone: null,
      franchiseId: sub.franchiseId,
      franchiseName: sub.franchiseName,
      mealType: sub.plan,
      declinedByDriverIds: [],
      createdAt: new Date().toISOString()
    };
    orders.push(order);
    createdOrders.push(order);
  }
  data.subscriptions = subs;
  data.orders = orders;
  saveData(data);
  // Assign each order using v2 order assignment (PIN-based, accept/decline flow)
  createdOrders.forEach(ord => {
    try { orderAssignmentService.assignOrderOnCreate(ord); } catch (e) { console.warn('Assign order', ord.id, e.message); }
  });
  data = loadData();
  res.status(201).json(sub);
});

// Subscriptions: PATCH /api/subscriptions/:id (pause, resume, cancel) — 5 PM cutoff enforced
app.patch('/api/subscriptions/:id', (req, res) => {
  data = loadData();
  const subs = data.subscriptions || [];
  const id = parseInt(req.params.id, 10);
  const idx = subs.findIndex(s => s.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Subscription not found' });
  const ru = getReqUser(req);
  const subEmail = (subs[idx].email || '').toLowerCase();
  if (ru.role === 'customer' && ru.email !== subEmail) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'admin' && !canAccessCustomer(ru, subEmail)) return res.status(403).json({ error: 'Access denied to this customer' });
  if (!isBeforeDailyCutoff()) {
    return res.status(403).json({
      error: "Today's modification window is closed. Changes will apply from the following day.",
      code: 'CUTOFF_PASSED'
    });
  }
  const updates = req.body || {};
  if (updates.status) subs[idx].status = updates.status;
  if (updates.pausedFrom) subs[idx].pausedFrom = updates.pausedFrom;
  if (updates.pausedTo) subs[idx].pausedTo = updates.pausedTo;
  if (updates.skipMealDates) subs[idx].skipMealDates = updates.skipMealDates;
  if (updates.pauseDates) subs[idx].pauseDates = updates.pauseDates;
  if (updates.pauseRanges) subs[idx].pauseRanges = updates.pauseRanges;
  if (updates.allergies !== undefined) subs[idx].allergies = Array.isArray(updates.allergies) ? updates.allergies : [];
  data.subscriptions = subs;
  saveData(data);
  res.json(subs[idx]);
});

// GET /api/cutoff-status — frontend can show "modification window closed" message
app.get('/api/cutoff-status', (req, res) => {
  res.json({
    canEdit: isBeforeDailyCutoff(),
    message: isBeforeDailyCutoff() ? null : "Today's modification window is closed. Changes will apply from the following day.",
    istTime: nowIST().toISOString()
  });
});

// Orders: GET /api/orders/next-delivery-date?franchiseId=1 — earliest date >= today with orders
app.get('/api/orders/next-delivery-date', (req, res) => {
  data = loadData();
  const orders = data.orders || [];
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  const ru = getReqUser(req);
  let list = orders.filter(o => o.delivery_date && o.delivery_date >= toISTDateStr(new Date()));
  if (ru.role === 'admin' && franchiseId != null && franchiseId === ru.franchiseId) list = list.filter(o => o.franchiseId === franchiseId);
  else if (ru.role === 'admin' && ru.franchiseId) list = list.filter(o => o.franchiseId === ru.franchiseId);
  else if (franchiseId) list = list.filter(o => o.franchiseId === franchiseId);
  const dates = [...new Set(list.map(o => o.delivery_date))].sort();
  res.json({ date: dates[0] || null });
});

// Orders: GET /api/orders?deliveryDate=&franchiseId=&driverId=&email=&viewAs=&subscriptionId=
app.get('/api/orders', (req, res) => {
  data = loadData();
  let list = data.orders || [];
  const ru = getReqUser(req);
  const deliveryDate = req.query.deliveryDate || null;
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  const driverId = req.query.driverId ? parseInt(req.query.driverId, 10) : null;
  let email = req.query.email ? req.query.email.trim().toLowerCase() : null;
  const viewAs = req.query.viewAs ? req.query.viewAs.trim().toLowerCase() : null;
  const subscriptionId = req.query.subscriptionId ? parseInt(req.query.subscriptionId, 10) : null;
  if (ru.role === 'customer') {
    email = ru.email || email;
    if (viewAs && viewAs !== ru.email) return res.status(403).json({ error: 'Access denied' });
    if (email) list = list.filter(o => (o.email || '').toLowerCase() === email);
  } else if (ru.role === 'admin') {
    if (viewAs) {
      if (!canAccessCustomer(ru, viewAs)) return res.status(403).json({ error: 'Access denied to this customer' });
      list = list.filter(o => (o.email || '').toLowerCase() === viewAs);
    } else if (driverId != null && canAccessDriver(ru, driverId)) {
      list = list.filter(o => o.driverId === driverId);
    } else if (franchiseId != null && franchiseId === ru.franchiseId) {
      list = list.filter(o => o.franchiseId === franchiseId);
    } else if (!franchiseId && !driverId) {
      list = list.filter(o => o.franchiseId === ru.franchiseId);
    } else if (driverId != null && !canAccessDriver(ru, driverId)) {
      return res.status(403).json({ error: 'Access denied to this driver' });
    }
  } else if (ru.role === 'master') {
    if (viewAs) list = list.filter(o => (o.email || '').toLowerCase() === viewAs);
    else if (driverId != null) list = list.filter(o => o.driverId === driverId);
    else if (franchiseId) list = list.filter(o => o.franchiseId === franchiseId);
  } else if (ru.role === 'driver') {
    if (ru.driverId) list = list.filter(o => o.driverId === ru.driverId);
    else return res.json([]);
  } else {
    if (franchiseId) list = list.filter(o => o.franchiseId === franchiseId);
    if (driverId) list = list.filter(o => o.driverId === driverId);
    if (email) list = list.filter(o => (o.email || '').toLowerCase() === email);
  }
  if (deliveryDate) list = list.filter(o => o.delivery_date === deliveryDate);
  if (subscriptionId) list = list.filter(o => o.subscriptionId === subscriptionId);
  res.json(list);
});

// Orders: PATCH /api/orders/:id (status, driverId) — backend validates 5 PM for customer edits
app.patch('/api/orders/:id', (req, res) => {
  data = loadData();
  const orders = data.orders || [];
  const id = parseInt(req.params.id, 10);
  const idx = orders.findIndex(o => o.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Order not found' });
  const ru = getReqUser(req);
  const orderEmail = (orders[idx].email || '').toLowerCase();
  if (ru.role === 'customer' && ru.email !== orderEmail) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'admin' && !canAccessCustomer(ru, orderEmail)) return res.status(403).json({ error: 'Access denied to this customer' });
  if (ru.role === 'driver' && orders[idx].driverId !== ru.driverId) return res.status(403).json({ error: 'Access denied' });
  const updates = req.body || {};
  if (updates.status && !['accepted', 'picked', 'picked_up', 'out_for_delivery', 'delivered', 'failed'].includes(updates.status)) {
    if (!isBeforeDailyCutoff()) {
      return res.status(403).json({ error: "Today's modification window is closed.", code: 'CUTOFF_PASSED' });
    }
  }
  if (updates.driverId !== undefined) {
    orders[idx].driverId = updates.driverId;
    orders[idx].driverName = updates.driverName || null;
    orders[idx].driverPhone = updates.driverPhone || null;
    orders[idx].status = 'assigned';
  }
  if (updates.status) {
    if (updates.status === 'accepted' && orders[idx].status === 'pending_acceptance') {
      try { orderAssignmentService.clearOrderTimeout(id); } catch (e) {}
    }
    orders[idx].status = updates.status;
  }
  if (updates.pickupTime) orders[idx].pickupTime = updates.pickupTime;
  if (updates.deliveredAt) orders[idx].deliveredAt = updates.deliveredAt;
  data.orders = orders;
  saveData(data);
  res.json(orders[idx]);
});

// Driver location: POST /api/drivers/:id/location — GPS update (every 5–10 s from driver app)
app.post('/api/drivers/:id/location', (req, res) => {
  data = loadData();
  const drivers = data.drivers || [];
  const id = parseInt(req.params.id, 10);
  const idx = drivers.findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Driver not found' });
  const ru = getReqUser(req);
  if (ru.role === 'driver' && ru.driverId !== id) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'admin' && !canAccessDriver(ru, id)) return res.status(403).json({ error: 'Access denied' });
  const { lat, lng } = req.body || {};
  if (lat != null && lng != null) {
    drivers[idx].currentLat = lat;
    drivers[idx].currentLng = lng;
    drivers[idx].lastLocationAt = new Date().toISOString();
    const log = data.driverLocationLog || [];
    log.push({ driverId: id, lat, lng, timestamp: drivers[idx].lastLocationAt });
    if (log.length > 10000) log.splice(0, 2000);
    data.driverLocationLog = log;
  }
  data.drivers = drivers;
  saveData(data);
  res.json({ ok: true, lastLocationAt: drivers[idx].lastLocationAt });
});

// Tracking: GET /api/tracking/driver/:id — current position for map
app.get('/api/tracking/driver/:id', (req, res) => {
  data = loadData();
  const id = parseInt(req.params.id, 10);
  const driver = (data.drivers || []).find(d => d.id === id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  const ru = getReqUser(req);
  if (ru.role === 'driver' && ru.driverId !== id) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'admin' && !canAccessDriver(ru, id)) return res.status(403).json({ error: 'Access denied' });
  res.json({
    driverId: driver.id,
    name: driver.name,
    phone: driver.phone,
    currentLat: driver.currentLat,
    currentLng: driver.currentLng,
    lastLocationAt: driver.lastLocationAt
  });
});

// Tracking: GET /api/tracking/order/:orderId — order + assigned driver location (for customer/admin/master)
app.get('/api/tracking/order/:orderId', (req, res) => {
  data = loadData();
  const orderId = parseInt(req.params.orderId, 10);
  const order = (data.orders || []).find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const ru = getReqUser(req);
  const orderEmail = (order.email || '').toLowerCase();
  if (ru.role === 'customer' && ru.email !== orderEmail) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'admin' && !canAccessCustomer(ru, orderEmail)) return res.status(403).json({ error: 'Access denied' });
  let driverLocation = null;
  if (order.driverId) {
    const driver = (data.drivers || []).find(d => d.id === order.driverId);
    if (driver) {
      const lat = driver.currentLat, lng = driver.currentLng;
      driverLocation = {
        currentLat: lat != null ? lat : 17.4239,
        currentLng: lng != null ? lng : 78.4738,
        lastLocationAt: driver.lastLocationAt,
        name: driver.name,
        phone: driver.phone,
        isDummy: (lat == null || lng == null)
      };
    }
  }
  res.json({ order, driver: driverLocation });
});

// Tracking: GET /api/tracking/delivery/:id — delivery + driver location
app.get('/api/tracking/delivery/:id', (req, res) => {
  data = loadData();
  const id = parseInt(req.params.id, 10);
  const delivery = (data.deliveries || []).find(d => d.id === id);
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  const ru = getReqUser(req);
  if (ru.role === 'admin' && delivery.franchiseId !== ru.franchiseId) return res.status(403).json({ error: 'Access denied' });
  if (ru.role === 'driver' && delivery.driverId !== ru.driverId) return res.status(403).json({ error: 'Access denied' });
  let driverLocation = null;
  if (delivery.driverId) {
    const driver = (data.drivers || []).find(d => d.id === delivery.driverId);
    if (driver) {
      const lat = driver.currentLat, lng = driver.currentLng;
      driverLocation = {
        currentLat: lat != null ? lat : 17.4239,
        currentLng: lng != null ? lng : 78.4738,
        lastLocationAt: driver.lastLocationAt,
        name: driver.name,
        phone: driver.phone,
        isDummy: (lat == null || lng == null)
      };
    }
  }
  res.json({ delivery, driver: driverLocation });
});

// Notifications: GET /api/notifications?franchiseId= (master: all; admin: franchise)
app.get('/api/notifications', (req, res) => {
  data = loadData();
  let list = data.notifications || [];
  const ru = getReqUser(req);
  if (ru.role === 'admin' && ru.franchiseId) list = list.filter(n => n.franchiseId == null || n.franchiseId === ru.franchiseId);
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : null;
  if (franchiseId != null) list = list.filter(n => n.franchiseId == null || n.franchiseId === franchiseId);
  list = list.slice(-100).reverse();
  res.json(list);
});

// Notifications: POST /api/notifications — create notification (admin/master)
app.post('/api/notifications', (req, res) => {
  data = loadData();
  const ru = getReqUser(req);
  if (ru.role !== 'admin' && ru.role !== 'master') return res.status(403).json({ error: 'Access denied' });
  const n = req.body || {};
  const notifications = data.notifications || [];
  notifications.push({
    id: notifications.length ? Math.max(...notifications.map(x => x.id || 0)) + 1 : 1,
    type: n.type || 'broadcast',
    title: n.title || 'Notification',
    message: n.message || '',
    franchiseId: ru.role === 'admin' ? ru.franchiseId : (n.franchiseId || null),
    at: new Date().toISOString()
  });
  data.notifications = notifications;
  saveData(data);
  res.status(201).json(notifications[notifications.length - 1]);
});

// ————— Auto-assign drivers at 5:30 PM IST —————
function driverCoversPincode(driver, pincode) {
  const pins = driver.assignedPincodes || [];
  if (pins.length === 0) return true;
  const p = String(pincode || '').trim();
  for (const range of pins) {
    const s = String(range).trim();
    if (s.includes('-')) {
      const [a, b] = s.split('-').map(x => parseInt(x, 10));
      if (p >= a && p <= b) return true;
    } else if (parseInt(s, 10) === parseInt(p, 10)) return true;
  }
  return false;
}

function runAutoAssign() {
  data = loadData();
  const orders = data.orders || [];
  const drivers = data.drivers || [];
  const tomorrowIST = new Date(nowIST());
  tomorrowIST.setDate(tomorrowIST.getDate() + 1);
  const tomorrowStr = tomorrowIST.toLocaleString('en-CA', { timeZone: IST_TZ }).slice(0, 10);
  const pending = orders.filter(o => o.delivery_date === tomorrowStr && (o.status === 'pending' || !o.driverId));
  if (pending.length === 0) return;
  const byFranchise = {};
  pending.forEach(o => {
    const fid = o.franchiseId || 1;
    if (!byFranchise[fid]) byFranchise[fid] = [];
    byFranchise[fid].push(o);
  });
  const notifications = data.notifications || [];
  let unassignedCount = 0;
  Object.keys(byFranchise).forEach(fid => {
    const franchiseOrders = byFranchise[fid];
    const franchiseDrivers = drivers.filter(d => (d.franchiseId || 1) == fid && (d.status || 'active') === 'active');
    const byPincode = {};
    franchiseOrders.forEach(o => {
      const pin = o.pincode || 'unknown';
      if (!byPincode[pin]) byPincode[pin] = [];
      byPincode[pin].push(o);
    });
    Object.keys(byPincode).forEach(pin => {
      const list = byPincode[pin];
      const eligible = franchiseDrivers.filter(d => driverCoversPincode(d, pin));
      if (eligible.length === 0) {
        unassignedCount += list.length;
        notifications.push({ type: 'unassigned', franchiseId: parseInt(fid, 10), deliveryDate: tomorrowStr, pincode: pin, count: list.length, at: new Date().toISOString() });
        return;
      }
      const perDriver = Math.floor(list.length / eligible.length);
      let remainder = list.length % eligible.length;
      let idx = 0;
      eligible.forEach(d => {
        const count = perDriver + (remainder > 0 ? 1 : 0);
        remainder--;
        for (let i = 0; i < count && idx < list.length; i++, idx++) {
          list[idx].driverId = d.id;
          list[idx].driverName = d.name;
          list[idx].driverPhone = d.phone;
          list[idx].status = 'assigned';
        }
      });
    });
  });
  data.orders = orders;
  data.notifications = notifications;
  if (unassignedCount > 0) {
    notifications.push({ type: 'admin_alert', message: unassignedCount + ' order(s) could not be assigned for ' + tomorrowStr + '. No driver for PIN.', at: new Date().toISOString() });
  }
  saveData(data);
  console.log('[5:30 PM] Auto-assign completed for', tomorrowStr, '; unassigned:', unassignedCount);
}

// Cron: 5:30 PM IST daily — auto-assign drivers for next day
cron.schedule('30 17 * * *', () => runAutoAssign(), { timezone: IST_TZ });
// Manual trigger for testing: GET /api/jobs/auto-assign (run once)
app.get('/api/jobs/auto-assign', (req, res) => {
  runAutoAssign();
  res.json({ ok: true, message: 'Auto-assign ran for tomorrow.' });
});

// ————— Order Assignment System v2 (modular) —————
const orderAssignmentService = require('./services/orderAssignmentService');
const pincodeDistributionService = require('./services/pincodeDistributionService');
app.use('/api/v2', require('./routes'));

// Bootstrap: ensure driverPincodeMappings exist, run initial PIN rebalance
(function bootstrapPincodeMappings() {
  data = loadData();
  if (!data.driverPincodeMappings || data.driverPincodeMappings.length === 0) {
    const franchises = data.franchises || [{ id: 1 }];
    franchises.forEach(f => {
      try { pincodeDistributionService.rebalancePincodes(f.id); } catch (e) { console.warn('PIN rebalance:', e.message); }
    });
  }
})();

// Serve static app (optional - for dev)
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Arogyadiet API running on port', PORT));
