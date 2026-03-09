import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Redis from "ioredis";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import cors from "cors";

dotenv.config({ path: "../.env" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// Initialize Redis client using the environment variable provided by Vercel Integration
const redis = new Redis(process.env.REDIS_URL || process.env.KV_URL);

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
app.get("/api/daily", async (req, res) => {
  try {
    const dateStr = today();
    const haiku = getDailyHaiku(dateStr);
    const userId = req.query.user_id;
    const guildId = req.query.guild_id || "global";

    let existing = null;
    if (userId) {
      const raw = await redis.hget(`score:${guildId}:${dateStr}`, userId);
      if (raw) existing = JSON.parse(raw);
    }

    res.json({
      date: dateStr,
      haiku: { ...haiku, text: haiku.lines.join("\n") },
      already_played: !!existing,
      previous_score: existing || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Submit Score ─────────────────────────────────────────────────────────────
app.post("/api/score", async (req, res) => {
  try {
    const { user_id, username, avatar, wpm, accuracy, guild_id } = req.body;
    const dateStr = today();
    const guildId = guild_id || "global";

    if (!user_id || !username || wpm == null || accuracy == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if already submitted today
    const existing = await redis.hget(`score:${guildId}:${dateStr}`, user_id);
    if (existing) {
      return res.status(409).json({ error: "Already submitted today" });
    }

    const statObj = { user_id, username, avatar, wpm, accuracy, created_at: Date.now() };

    // Save to hash map for user retrieval
    await redis.hset(`score:${guildId}:${dateStr}`, user_id, JSON.stringify(statObj));

    // Save to sorted set for leaderboard
    // Score calculation: prioritize WPM, then accuracy. 
    // e.g., 120 WPM and 98 Acc = 120098 score
    const sortScore = (Math.round(wpm) * 1000) + Math.round(accuracy);
    await redis.zadd(`leaderboard:${guildId}:${dateStr}`, sortScore, user_id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────
app.get("/api/leaderboard", async (req, res) => {
  try {
    const dateStr = today();
    const guildId = req.query.guild_id || "global";

    // Get top 10 from sorted set (highest to lowest score)
    const topUserIds = await redis.zrevrange(`leaderboard:${guildId}:${dateStr}`, 0, 9);

    if (!topUserIds || topUserIds.length === 0) {
      return res.json({ date: dateStr, scores: [] });
    }

    // Get the full stats for each top user
    const scores = [];
    for (const uid of topUserIds) {
      const raw = await redis.hget(`score:${guildId}:${dateStr}`, uid);
      if (raw) {
        scores.push(JSON.parse(raw));
      }
    }

    res.json({ date: dateStr, scores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// In Vercel, don't bind to a port during export
if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
  });
}

// Export the Express app for Vercel
export default app;
