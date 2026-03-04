// src/Game.js

export function renderGame(container, auth) {
    const haiku = "An old silent pond\nA frog jumps into the pond\nSplash! Silence again";

    // Map each character to a span, keeping \n as a raw newline (we will use pre-wrap)
    const charArray = haiku.split('').map(char => {
        if (char === '\n') {
            return `<span class="char newline">\n</span>`;
        }
        return `<span class="char">${char}</span>`;
    }).join('');

    container.innerHTML = `
    <div id="game-container">
      <div id="target-text">${charArray}</div>
      <!-- autocomplete off is crucial to avoid mobile suggestions messing up characters -->
      <input type="text" id="hidden-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
      <div class="stats">
        WPM: <span id="wpm">0</span> | Acc: <span id="acc">0</span>%
      </div>
    </div>
  `;

    const input = document.getElementById('hidden-input');
    const charSpans = container.querySelectorAll('.char');
    let startTime = null;

    // Focus input immediately, and ensure any click on the container refocuses it.
    // This is required for iframes in Discord Activities.
    setTimeout(() => input.focus(), 10);
    container.addEventListener('click', () => {
        input.focus();
    });

    // Keep focus
    input.addEventListener('blur', () => {
        if (input.value.length < haiku.length) {
            input.focus();
        }
    });

    // Initialize cursor on the first character
    if (charSpans.length > 0) {
        charSpans[0].classList.add('cursor');
    }

    input.addEventListener('input', () => {
        if (!startTime) startTime = Date.now();

        const typedText = input.value;
        const typedChars = typedText.split('');

        charSpans.forEach((span, index) => {
            const typedChar = typedChars[index];
            const targetChar = haiku[index];

            // Reset classes
            span.className = span.className.replace(' cursor', '').replace(' correct', '').replace(' incorrect', '');

            if (typedChar == null) {
                // Not typed yet
            } else if (typedChar === targetChar || (targetChar === '\n' && typedChar === ' ')) {
                // Allow space to match a newline for typing convenience
                span.classList.add('correct');
            } else {
                span.classList.add('incorrect');
            }
        });

        const nextIndex = typedChars.length;
        if (nextIndex < charSpans.length) {
            charSpans[nextIndex].classList.add('cursor');
        }

        calculateStats(typedText, haiku, startTime);

        if (nextIndex >= haiku.length) {
            const finalWpm = parseInt(document.getElementById('wpm').innerText) || 0;
            const finalAcc = parseInt(document.getElementById('acc').innerText) || 0;
            renderResults(container, auth, { wpm: finalWpm, accuracy: finalAcc });
        }
    });
}

function calculateStats(typedText, targetText, startTime) {
    if (!startTime || typedText.length === 0) return;

    const timeElapsedInMinutes = (Date.now() - startTime) / 60000;
    let correctChars = 0;

    for (let i = 0; i < typedText.length; i++) {
        // Treat typing a space as equivalent to passing a newline in the text
        const targetChar = targetText[i] === '\n' ? ' ' : targetText[i];
        if (typedText[i] === targetChar) {
            correctChars++;
        }
    }

    // WPM = (Total characters typed / 5) / Time in minutes
    const wpm = Math.round((typedText.length / 5) / timeElapsedInMinutes);

    // Accuracy = (Correct characters / Total characters typed) * 100
    const accuracy = Math.round((correctChars / typedText.length) * 100);

    // Update the DOM, preventing Infinity/NaN errors in the first fraction of a second
    document.getElementById('wpm').innerText = isFinite(wpm) && wpm > 0 ? wpm : 0;
    document.getElementById('acc').innerText = isNaN(accuracy) ? 0 : accuracy;
}

export function renderResults(container, auth, stats) {
    container.innerHTML = `
      <div id="results-container">
        <h1>Activity Complete!</h1>
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
        <button id="play-again-btn">Play Again</button>
      </div>
    `;

    // Wait a tiny bit before adding click to avoid accidental double clicks triggering it instantly
    setTimeout(() => {
        document.getElementById('play-again-btn')?.addEventListener('click', () => {
            renderGame(container, auth);
        });
    }, 100);
}