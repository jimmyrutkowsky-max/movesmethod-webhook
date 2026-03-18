const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'events.json');

const VALID_STAGES = [
  'landing_page_view',
  'checkout_page_view',
  'order_confirmation',
  'upsell_1_view',
  'upsell_1_purchase',
  'upsell_2_view',
  'upsell_2_purchase',
];

// ── Simple JSON file storage (no SQLite = easier Railway deploy) ──
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

function loadEvents() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveEvents(events) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(events));
}

// ── Auth ──────────────────────────────────────────────────────────
function checkKey(req, res) {
  if (!WEBHOOK_SECRET) return true;
  const key = req.query.key || req.headers['x-webhook-key'];
  if (key !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Invalid key' });
    return false;
  }
  return true;
}

// ── Webhook receivers ─────────────────────────────────────────────
app.post('/webhook/:stage', (req, res) => {
  if (!checkKey(req, res)) return;
  const { stage } = req.params;
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `Invalid stage. Valid: ${VALID_STAGES.join(', ')}` });
  }

  const body = req.body || {};
  const now = new Date();
  const event = {
    stage,
    timestamp: now.toISOString(),
    date: now.toISOString().split('T')[0],
    email: body.email || body.contact?.email || null,
    contact_id: body.contact_id || body.contactId || body.id || null,
  };

  const events = loadEvents();
  events.push(event);
  saveEvents(events);

  res.json({ ok: true, stage, timestamp: event.timestamp });
});

// ── API for dashboard to read ─────────────────────────────────────

// Counts by stage for a date range
app.get('/api/funnel/counts', (req, res) => {
  if (!checkKey(req, res)) return;
  const { start, end } = req.query;
  const events = loadEvents();
  const counts = {};

  for (const e of events) {
    if (start && e.date < start) continue;
    if (end && e.date > end) continue;
    counts[e.stage] = (counts[e.stage] || 0) + 1;
  }

  res.json(counts);
});

// Daily breakdown by stage
app.get('/api/funnel/daily', (req, res) => {
  if (!checkKey(req, res)) return;
  const { start, end } = req.query;
  const events = loadEvents();
  const byDate = {};

  for (const e of events) {
    if (start && e.date < start) continue;
    if (end && e.date > end) continue;
    if (!byDate[e.date]) byDate[e.date] = { date: e.date };
    byDate[e.date][e.stage] = (byDate[e.date][e.stage] || 0) + 1;
  }

  res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
});

// List stages + key (for dashboard setup guide)
app.get('/api/funnel/stages', (req, res) => {
  res.json({ stages: VALID_STAGES, keyHint: WEBHOOK_SECRET });
});

// Health check
app.get('/', (req, res) => {
  const events = loadEvents();
  res.json({
    status: 'ok',
    totalEvents: events.length,
    stages: VALID_STAGES,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Secret key: ${WEBHOOK_SECRET ? 'configured' : 'NOT SET (open to all)'}`);
});
