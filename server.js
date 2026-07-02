const express = require('express');
const fs = require('fs');
const path = require('path');
const marketData = require('./data.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ponytail: JSON file as DB, swap to real DB if scale matters
const DB_PATH = path.join(__dirname, 'results.json');
function readDB() {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
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
  const returnRate = ((finalAmount - startAmount) / startAmount) * 100;

  const results = readDB();
  const entry = {
    id: Date.now(),
    nickname,
    allocation,
    finalAmount,
    returnRate: Math.round(returnRate * 100) / 100,
    createdAt: new Date().toISOString()
  };
  const existing = results.findIndex(r => r.nickname === nickname);
  if (existing !== -1) results[existing] = entry;
  else results.push(entry);
  writeDB(results);

  res.json({
    id: entry.id,
    nickname,
    startAmount,
    finalAmount,
    returnRate: Math.round(returnRate * 100) / 100,
    years
  });
});

// --- API: 순위표 ---
app.get('/api/ranking', (req, res) => {
  const results = readDB();
  results.sort((a, b) => b.returnRate - a.returnRate);
  res.json(results.slice(0, 100).map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    allocation: r.allocation,
    finalAmount: r.finalAmount,
    returnRate: r.returnRate
  })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
