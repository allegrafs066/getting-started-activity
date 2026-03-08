// src/Game.js

/** Build HTML spans for each character in the haiku string */
function buildCharSpans(haiku) {
    return haiku.split('').map(char => {
        if (char === '\n') return `<span class="char newline">\n</span>`;
        return `<span class="char">${char.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
    }).join('');
}

/** Get UTC midnight-based countdown string */
function getCountdownToMidnight() {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const diff = tomorrow - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function renderGame(container, auth) {
    const userId = auth?.user?.id;
    const username = auth?.user?.username ?? 'Anonymous';
    const avatar = auth?.user?.avatar ?? null;

    // Show loading state
    container.innerHTML = `<div class="loading-screen"><p>Loading today's haiku...</p></div>`;

    // Fetch daily haiku & check if already played
    let dailyData;
    try {
        const res = await fetch(`/api/daily?user_id=${userId}`);
        dailyData = await res.json();
    } catch (e) {
        container.innerHTML = `<div class="loading-screen"><p>Failed to load. Please retry.</p></div>`;
        return;
    }

    const haiku = dailyData.haiku.text;
    const haikuMeta = dailyData.haiku;

    // Immediately show results if they already played today
    if (dailyData.already_played) {
        renderResults(container, auth, dailyData.previous_score, haikuMeta, false);
        return;
    }

    // ── Render game ────────────────────────────────────────────────────────────
    const charArray = buildCharSpans(haiku);

    container.innerHTML = `
    <div id="game-container">
      <div id="game-header">
        <span class="haiku-label">Daily Haiku · <em>${haikuMeta.author}</em></span>
      </div>
      <div id="target-text">${charArray}</div>
      <input type="text" id="hidden-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
      <div class="stats">
        WPM: <span id="wpm">0</span> | Acc: <span id="acc">0</span>%
      </div>
    </div>
  `;

    const input = document.getElementById('hidden-input');
    const charSpans = container.querySelectorAll('.char');
    let startTime = null;
    let typedText = '';

    setTimeout(() => input.focus(), 10);
    container.addEventListener('click', () => input.focus());
    input.addEventListener('blur', () => {
        if (typedText.length < haiku.length) input.focus();
    });

    if (charSpans.length > 0) charSpans[0].classList.add('cursor');

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (typedText.length < haiku.length) typedText += '\n';
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            typedText = typedText.slice(0, -1);
        } else if (e.key.length === 1) {
            if (typedText.length < haiku.length) typedText += e.key;
        } else {
            return;
        }

        if (!startTime && typedText.length > 0) startTime = Date.now();

        const typedChars = typedText.split('');

        charSpans.forEach((span, index) => {
            const typedChar = typedChars[index];
            const targetChar = haiku[index];
            span.className = span.className.replace(' cursor', '').replace(' correct', '').replace(' incorrect', '');
            if (typedChar == null) {
                // not typed yet
            } else if (typedChar === targetChar) {
                span.classList.add('correct');
            } else {
                span.classList.add('incorrect');
            }
        });

        const nextIndex = typedChars.length;
        if (nextIndex < charSpans.length) charSpans[nextIndex].classList.add('cursor');

        calculateStats(typedText, haiku, startTime);

        if (nextIndex >= haiku.length) {
            const finalWpm = parseInt(document.getElementById('wpm').innerText) || 0;
            const finalAcc = parseInt(document.getElementById('acc').innerText) || 0;
            const finalStats = { wpm: finalWpm, accuracy: finalAcc };

            // Submit score to server, then show results
            fetch('/api/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, username, avatar, ...finalStats }),
            }).catch(() => { }); // best effort

            renderResults(container, auth, finalStats, haikuMeta, true);
        }
    });
}

function calculateStats(typedText, targetText, startTime) {
    if (!startTime || typedText.length === 0) return;
    const timeElapsedInMinutes = (Date.now() - startTime) / 60000;
    let correctChars = 0;
    for (let i = 0; i < typedText.length; i++) {
        if (typedText[i] === targetText[i]) correctChars++;
    }
    const wpm = Math.round((typedText.length / 5) / timeElapsedInMinutes);
    const accuracy = Math.round((correctChars / typedText.length) * 100);
    document.getElementById('wpm').innerText = isFinite(wpm) && wpm > 0 ? wpm : 0;
    document.getElementById('acc').innerText = isNaN(accuracy) ? 0 : accuracy;
}

async function renderResults(container, auth, stats, haikuMeta, justFinished) {
    // Show initial results immediately, then load leaderboard
    container.innerHTML = `
      <div id="results-container">
        <h1>${justFinished ? '🎉 Activity Complete!' : '📖 Already played today!'}</h1>
        <p class="haiku-label">Today's haiku by <em>${haikuMeta?.author ?? 'Unknown'}</em></p>
        <div class="final-stats">
          <div class="stat-box">
            <h2>WPM</h2>
            <p>${stats.wpm}</p>
          </div>
          <div class="stat-box">
            <h2>Accuracy</h2>
            <p>${stats.accuracy}%</p>
          </div>
        </div>
        <div id="leaderboard-section">
          <p class="loading-label">Loading leaderboard...</p>
        </div>
        <div class="next-haiku">
          Next haiku in <span id="countdown">${getCountdownToMidnight()}</span>
        </div>
        <button id="share-btn" class="share-btn">📋 Copy Result Card</button>
      </div>
    `;

    // Wire up share button
    setTimeout(() => {
        document.getElementById('share-btn')?.addEventListener('click', () => {
            generateShareCard(auth, stats, haikuMeta);
        });
    }, 100);

    // Tick the countdown every second
    const ticker = setInterval(() => {
        const el = document.getElementById('countdown');
        if (el) el.textContent = getCountdownToMidnight();
        else clearInterval(ticker);
    }, 1000);

    // Fetch and render leaderboard
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        const section = document.getElementById('leaderboard-section');
        if (!section) return;

        if (!data.scores || data.scores.length === 0) {
            section.innerHTML = `<p class="loading-label">No scores yet today.</p>`;
            return;
        }

        const rows = data.scores.map((score, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            const avatarHtml = score.avatar
                ? `<img class="lb-avatar" src="https://cdn.discordapp.com/avatars/${score.user_id ?? ''}/${score.avatar}.webp?size=32" alt="" />`
                : `<span class="lb-avatar-placeholder"></span>`;
            return `
              <div class="lb-row${i === 0 ? ' lb-first' : ''}">
                <span class="lb-rank">${medal}</span>
                ${avatarHtml}
                <span class="lb-name">${escapeHtml(score.username)}</span>
                <span class="lb-wpm">${score.wpm} <small>WPM</small></span>
                <span class="lb-acc">${score.accuracy}%</span>
              </div>`;
        }).join('');

        section.innerHTML = `
          <h3 class="lb-title">Today's Leaderboard</h3>
          <div class="leaderboard">${rows}</div>`;
    } catch (e) {
        const section = document.getElementById('leaderboard-section');
        if (section) section.innerHTML = `<p class="loading-label">Could not load leaderboard.</p>`;
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showImageModal(dataUrl) {
    // Remove any existing modal first
    document.getElementById('share-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.innerHTML = `
      <div id="share-modal-backdrop">
        <div id="share-modal-card">
          <img id="share-card-img" src="${dataUrl}" alt="Your result card" />
          <p class="share-hint">Right-click the image → <strong>Save Image As</strong> to share it!</p>
          <button id="share-modal-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#share-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#share-modal-backdrop').addEventListener('click', (e) => {
        if (e.target === modal.querySelector('#share-modal-backdrop')) modal.remove();
    });
}

// ── Share Card Generator (Canvas) ────────────────────────────────────────────
async function generateShareCard(auth, stats, haikuMeta) {
    const btn = document.getElementById('share-btn');
    if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }

    const W = 600, H = 320;
    const canvas = document.createElement('canvas');
    canvas.width = W * 2; // 2x for retina
    canvas.height = H * 2;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2); // retina scale

    const userId = auth?.user?.id;
    const username = auth?.user?.username ?? 'Anonymous';
    const avatarHash = auth?.user?.avatar ?? null;
    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1a1a2e');
    bg.addColorStop(1, '#16213e');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, W, H, 20);
    ctx.fill();

    // Subtle grid pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // App brand top-left
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = '#e2b714';
    ctx.fillText('haikuur', 28, 38);

    // Date top-right
    ctx.font = '13px Inter, Arial, sans-serif';
    ctx.fillStyle = '#646669';
    ctx.textAlign = 'right';
    ctx.fillText(date, W - 28, 38);
    ctx.textAlign = 'left';

    // Divider line
    ctx.strokeStyle = 'rgba(226,183,20,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(28, 52); ctx.lineTo(W - 28, 52); ctx.stroke();

    // Haiku author
    ctx.font = 'italic 13px Inter, Arial, sans-serif';
    ctx.fillStyle = '#8b8987';
    ctx.fillText(`"${haikuMeta?.author ?? 'Unknown'}"`, 28, 76);

    // ── Avatar ──
    const avatarSize = 72;
    const avatarX = W / 2 - avatarSize / 2;
    const avatarY = 90;

    if (avatarHash && userId) {
        try {
            const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=128`;
            const img = await loadImage(avatarUrl);
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
            // Gold ring
            ctx.strokeStyle = '#e2b714';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 2, 0, Math.PI * 2);
            ctx.stroke();
        } catch (_) {
            drawAvatarFallback(ctx, avatarX, avatarY, avatarSize, username);
        }
    } else {
        drawAvatarFallback(ctx, avatarX, avatarY, avatarSize, username);
    }

    // Username
    ctx.font = 'bold 16px Inter, Arial, sans-serif';
    ctx.fillStyle = '#d1d0c5';
    ctx.textAlign = 'center';
    ctx.fillText(username, W / 2, avatarY + avatarSize + 22);

    // ── Stat boxes ──
    const boxW = 160, boxH = 76, boxY = H - 106;
    const gap = 24;
    const leftX = W / 2 - boxW - gap / 2;
    const rightX = W / 2 + gap / 2;

    // WPM box
    drawStatBox(ctx, leftX, boxY, boxW, boxH, 'WPM', String(stats.wpm), '#e2b714');
    // ACC box
    drawStatBox(ctx, rightX, boxY, boxW, boxH, 'ACC', `${stats.accuracy}%`, '#7ec8a4');

    // Bottom tagline
    ctx.font = '11px Inter, Arial, sans-serif';
    ctx.fillStyle = '#3a3a4a';
    ctx.textAlign = 'center';
    ctx.fillText('discord.gg · daily typing activity', W / 2, H - 14);

    // Convert to data URL and show in a modal (works in all iframe environments)
    const dataUrl = canvas.toDataURL('image/png');
    showImageModal(dataUrl);

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) { shareBtn.textContent = '🖼️ View Card'; shareBtn.disabled = false; }
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function drawAvatarFallback(ctx, x, y, size, username) {
    ctx.fillStyle = '#2a2a3e';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${size * 0.4}px Inter, Arial, sans-serif`;
    ctx.fillStyle = '#e2b714';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((username[0] ?? '?').toUpperCase(), x + size / 2, y + size / 2);
    ctx.textBaseline = 'alphabetic';
}

function drawStatBox(ctx, x, y, w, h, label, value, color) {
    // Box background
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = `${color}44`;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
    // Label
    ctx.font = '12px Inter, Arial, sans-serif';
    ctx.fillStyle = '#646669';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + 22);
    // Value
    ctx.font = `bold 32px "Courier New", monospace`;
    ctx.fillStyle = color;
    ctx.fillText(value, x + w / 2, y + h - 16);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

