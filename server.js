const express = require('express');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const marketData = require('./data.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ponytail: sql.js (WASM SQLite) — no native deps, handles concurrency safely
const DB_PATH = path.join(__dirname, 'invest.db');
let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS results (
      nickname TEXT PRIMARY KEY,
      allocation TEXT NOT NULL,
      final_amount INTEGER NOT NULL,
      return_rate REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// --- API: 시장 데이터 ---
app.get('/api/assets', (req, res) => {
  res.json(marketData.assets);
});

// --- API: 시뮬레이션 ---
app.post('/api/simulate', (req, res) => {
  const { nickname, allocation } = req.body;

  if (!nickname || !allocation) {
    return res.status(400).json({ error: '닉네임과 배분 비율을 입력해주세요.' });
  }

  const total = Object.values(allocation).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 100) > 0.1) {
    return res.status(400).json({ error: '배분 비율의 합이 100%여야 합니다.' });
  }

  const startAmount = 1000000;
  const years = [];

  // ponytail: 연도별 복리 계산, 자산별 독립 추적
  const assetValues = {};
  for (const [assetId, pct] of Object.entries(allocation)) {
    assetValues[assetId] = startAmount * (pct / 100);
  }

  for (let year = 2010; year <= 2020; year++) {
    for (const [assetId, _] of Object.entries(allocation)) {
      const asset = marketData.assets.find(a => a.id === assetId);
      if (!asset) continue;
      const r = asset.returns[String(year)] / 100;
      assetValues[assetId] *= (1 + r);
    }
    const totalValue = Object.values(assetValues).reduce((s, v) => s + v, 0);
    years.push({ year, amount: Math.round(totalValue) });
  }

  const finalAmount = years[years.length - 1].amount;
  const returnRate = Math.round(((finalAmount - startAmount) / startAmount) * 10000) / 100;

  // ponytail: UPSERT — 동일 닉네임 덮어쓰기
  db.run(
    `INSERT INTO results (nickname, allocation, final_amount, return_rate) VALUES (?, ?, ?, ?)
     ON CONFLICT(nickname) DO UPDATE SET allocation=excluded.allocation, final_amount=excluded.final_amount, return_rate=excluded.return_rate, created_at=datetime('now')`,
    [nickname, JSON.stringify(allocation), finalAmount, returnRate]
  );
  saveDB();

  res.json({ nickname, startAmount, finalAmount, returnRate, years });
});

// --- API: 순위표 ---
app.get('/api/ranking', (req, res) => {
  const rows = db.exec('SELECT nickname, allocation, final_amount, return_rate FROM results ORDER BY return_rate DESC LIMIT 100');
  if (!rows.length) return res.json([]);
  res.json(rows[0].values.map((r, i) => ({
    rank: i + 1,
    nickname: r[0],
    allocation: JSON.parse(r[1]),
    finalAmount: r[2],
    returnRate: r[3]
  })));
});

// ponytail: 관리자 초기화 — /api/reset?key=shinhan
app.delete('/api/reset', (req, res) => {
  if (req.query.key !== 'shinhan') return res.status(403).json({ error: '키가 틀립니다.' });
  db.run('DELETE FROM results');
  saveDB();
  res.json({ ok: true, message: '순위표가 초기화되었습니다.' });
});

initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});
