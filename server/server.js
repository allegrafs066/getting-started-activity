import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import cors from "cors";

dotenv.config({ path: "../.env" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3001;
app.use(cors());
app.use(express.json());

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database("haikuur.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    username    TEXT    NOT NULL,
    avatar      TEXT,
    date        TEXT    NOT NULL,
    haiku_id    INTEGER NOT NULL,
    wpm         INTEGER NOT NULL,
    accuracy    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    guild_id    TEXT
  );
`);

try {
  db.exec(`ALTER TABLE scores ADD COLUMN guild_id TEXT`);
} catch (e) { }

try {
  db.exec(`DROP INDEX idx_user_date`);
} catch (e) { }

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_guild_date ON scores (user_id, guild_id, date);`);

// ─── Haiku rotation ──────────────────────────────────────────────────────────
const haikus = JSON.parse(readFileSync(path.join(__dirname, "haikus.json"), "utf8"));

/** Returns today's date as a UTC string: YYYY-MM-DD */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Deterministic daily pick based on date string */
function getDailyHaiku(dateStr) {
  // Simple hash of the date string
  const seed = dateStr.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return haikus[seed % haikus.length];
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post("/api/token", async (req, res) => {
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });
  const { access_token } = await response.json();
  res.send({ access_token });
});

// ─── Daily Haiku ─────────────────────────────────────────────────────────────
app.get("/api/daily", (req, res) => {
  const dateStr = today();
  const haiku = getDailyHaiku(dateStr);
  const guild_id = req.query.guild_id || null;
  const existing = db
    .prepare("SELECT wpm, accuracy FROM scores WHERE user_id = ? AND date = ? AND (guild_id = ? OR (guild_id IS NULL AND ? IS NULL))")
    .get(req.query.user_id, dateStr, guild_id, guild_id);

  res.json({
    date: dateStr,
    haiku: { ...haiku, text: haiku.lines.join("\n") },
    already_played: !!existing,
    previous_score: existing || null,
  });
});

// ─── Submit Score ─────────────────────────────────────────────────────────────
app.post("/api/score", (req, res) => {
  const { user_id, username, avatar, wpm, accuracy, guild_id } = req.body;
  const dateStr = today();
  const haiku = getDailyHaiku(dateStr);

  if (!user_id || !username || wpm == null || accuracy == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    db.prepare(`
      INSERT INTO scores (user_id, username, avatar, date, haiku_id, wpm, accuracy, created_at, guild_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, username, avatar || null, dateStr, haiku.id, wpm, accuracy, Date.now(), guild_id || null);
    res.json({ success: true });
  } catch (err) {
    // Unique constraint violation — user already submitted today
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Already submitted today" });
    }
    throw err;
  }
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────
app.get("/api/leaderboard", (req, res) => {
  const dateStr = today();
  const guild_id = req.query.guild_id || null;
  const rows = db.prepare(`
    SELECT user_id, username, avatar, wpm, accuracy
    FROM scores
    WHERE date = ? AND (guild_id = ? OR (guild_id IS NULL AND ? IS NULL))
    ORDER BY wpm DESC, accuracy DESC
    LIMIT 10
  `).all(dateStr, guild_id, guild_id);
  res.json({ date: dateStr, scores: rows });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
