/**
 * Canvas Shield — Anti Circle-to-Search & Anti-Scraping Question Renderer
 * Styled in Crisp White, Royal Purple & Metallic Gold
 */

export function renderProtectedQuestionCanvas(canvas, options) {
  if (!canvas) return;
  const {
    questionNumber = 1,
    totalQuestions = 30,
    category = '',
    questionText = '',
    watermarkText = '',
    canvasAntiSearch = true,
    fallbackTextEl = null
  } = options || {};

  if (!canvasAntiSearch && fallbackTextEl) {
    canvas.style.display = 'none';
    fallbackTextEl.style.display = 'block';
    fallbackTextEl.textContent = questionText;
    return;
  }

  if (fallbackTextEl) {
    fallbackTextEl.style.display = 'none';
  }
  canvas.style.display = 'block';

  const parentWidth = Math.max(
    260,
    Math.floor((canvas.parentElement && canvas.parentElement.clientWidth) || 340)
  );
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  const padX = parentWidth < 400 ? 16 : 22;
  const padTop = 20;
  const padBottom = 20;
  const maxTextWidth = parentWidth - padX * 2;

  const fontSize = parentWidth < 380 ? 16.5 : parentWidth < 640 ? 17.5 : 19;
  const lineHeight = Math.round(fontSize * 1.52);
  const fontStack = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

  const ctx = canvas.getContext('2d');
  ctx.font = `700 ${fontSize}px ${fontStack}`;

  // Wrap question text cleanly by words
  const words = String(questionText || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxTextWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const badgeHeight = 26;
  const gapAfterBadge = 13;
  const totalHeight = Math.max(
    114,
    padTop + badgeHeight + gapAfterBadge + lines.length * lineHeight + padBottom
  );

  canvas.width = Math.floor(parentWidth * dpr);
  canvas.height = Math.floor(totalHeight * dpr);
  canvas.style.width = `${parentWidth}px`;
  canvas.style.height = `${totalHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Crisp White & Subtle Pearl-Purple Card Surface
  const grad = ctx.createLinearGradient(0, 0, parentWidth, totalHeight);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#faf6ff');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, parentWidth, totalHeight, 14);
  ctx.fill();

  // Top Metallic Gold Accent Strip
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, 0, 0, parentWidth, totalHeight, 14);
  ctx.clip();
  const topGold = ctx.createLinearGradient(0, 0, parentWidth, 0);
  topGold.addColorStop(0, '#5b21b6');
  topGold.addColorStop(0.5, '#d97706');
  topGold.addColorStop(1, '#f59e0b');
  ctx.fillStyle = topGold;
  ctx.fillRect(0, 0, parentWidth, 4);

  // Diagonal Student Watermark (Purple-Gold micro-stamp)
  if (watermarkText) {
    ctx.translate(parentWidth / 2, totalHeight / 2);
    ctx.rotate(-0.22);
    ctx.font = `700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = 'rgba(91, 33, 182, 0.06)';
    ctx.textAlign = 'center';
    const stamp = `${watermarkText}  •  EEE EMBEDX`;
    for (let y = -totalHeight; y <= totalHeight; y += 38) {
      for (let x = -parentWidth; x <= parentWidth; x += 220) {
        ctx.fillText(stamp, x, y);
      }
    }
  }
  ctx.restore();

  // Card Border (Gold/Purple)
  ctx.strokeStyle = 'rgba(217, 119, 6, 0.36)';
  ctx.lineWidth = 1.25;
  roundRect(ctx, 0.6, 0.6, parentWidth - 1.2, totalHeight - 1.2, 14);
  ctx.stroke();

  // Category & Question Number Pill (Royal Purple + Gold)
  const catLabel = category
    ? `Q${questionNumber}/${totalQuestions} · ${category}`
    : `Question ${questionNumber} of ${totalQuestions}`;
  ctx.font = `800 11.5px ${fontStack}`;
  const pillTextWidth = Math.min(ctx.measureText(catLabel).width + 22, maxTextWidth);

  ctx.fillStyle = '#f3ecff';
  roundRect(ctx, padX, padTop, pillTextWidth, 24, 999);
  ctx.fill();

  ctx.strokeStyle = 'rgba(217, 119, 6, 0.42)';
  ctx.lineWidth = 1;
  roundRect(ctx, padX, padTop, pillTextWidth, 24, 999);
  ctx.stroke();

  ctx.fillStyle = '#4c1d95';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(catLabel, padX + 11, padTop + 12.5);

  // Subtle anti-OCR micro-pattern
  ctx.save();
  ctx.strokeStyle = 'rgba(217, 119, 6, 0.05)';
  ctx.lineWidth = 0.75;
  for (let y = padTop + badgeHeight + 8; y < totalHeight - 10; y += 13) {
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(parentWidth - padX, y + (y % 2 === 0 ? 2 : -2));
    ctx.stroke();
  }
  ctx.restore();

  // Render Question Text in Deep Royal Ink
  ctx.font = `700 ${fontSize}px ${fontStack}`;
  ctx.fillStyle = '#1e1035';
  ctx.textBaseline = 'top';
  const startY = padTop + badgeHeight + gapAfterBadge;

  lines.forEach((line, idx) => {
    ctx.fillText(line, padX, startY + idx * lineHeight);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
