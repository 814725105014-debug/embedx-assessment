/**
 * Canvas Shield — Anti Circle-to-Search & Anti-Scraping Question Renderer
 *
 * Renders quiz question text onto a HiDPI HTML5 <canvas> element instead of
 * selectable DOM text, paired with a subtle diagonal student Register Number
 * watermark so neither DOM scrapers, copy extensions, nor Android text-selection
 * overlays can extract question text.
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

  // If admin disabled canvas mode, show non-selectable DOM fallback
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
  const padTop = 18;
  const padBottom = 20;
  const maxTextWidth = parentWidth - padX * 2;

  const fontSize = parentWidth < 380 ? 16.5 : parentWidth < 640 ? 17.5 : 19;
  const lineHeight = Math.round(fontSize * 1.52);
  const fontStack = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontSize}px ${fontStack}`;

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
  const gapAfterBadge = 12;
  const totalHeight = Math.max(
    112,
    padTop + badgeHeight + gapAfterBadge + lines.length * lineHeight + padBottom
  );

  canvas.width = Math.floor(parentWidth * dpr);
  canvas.height = Math.floor(totalHeight * dpr);
  canvas.style.width = `${parentWidth}px`;
  canvas.style.height = `${totalHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Card background
  const grad = ctx.createLinearGradient(0, 0, parentWidth, totalHeight);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#162238');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, parentWidth, totalHeight, 14);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, parentWidth - 1, totalHeight - 1, 14);
  ctx.stroke();

  // Diagonal Student Watermark (deters secondary phone camera & tracks leaks)
  if (watermarkText) {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, 0, 0, parentWidth, totalHeight, 14);
    ctx.clip();
    ctx.translate(parentWidth / 2, totalHeight / 2);
    ctx.rotate(-0.22);
    ctx.font = `600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.075)';
    ctx.textAlign = 'center';
    const stamp = `${watermarkText}  •  EMBEDX SECURE`;
    for (let y = -totalHeight; y <= totalHeight; y += 38) {
      for (let x = -parentWidth; x <= parentWidth; x += 240) {
        ctx.fillText(stamp, x, y);
      }
    }
    ctx.restore();
  }

  // Category & Question Number pill
  const catLabel = category ? `Q${questionNumber}/${totalQuestions} · ${category}` : `Question ${questionNumber} of ${totalQuestions}`;
  ctx.font = `700 11.5px ${fontStack}`;
  const pillTextWidth = Math.min(ctx.measureText(catLabel).width + 20, maxTextWidth);
  ctx.fillStyle = 'rgba(14, 165, 233, 0.16)';
  roundRect(ctx, padX, padTop, pillTextWidth, 24, 999);
  ctx.fill();

  ctx.fillStyle = '#38bdf8';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(catLabel, padX + 10, padTop + 12.5);

  // Subtle anti-OCR micro-noise lines (imperceptible to humans, disrupts automated screen-scrapers)
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
  ctx.lineWidth = 0.75;
  for (let y = padTop + badgeHeight + 8; y < totalHeight - 10; y += 13) {
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(parentWidth - padX, y + ((y % 2 === 0) ? 2 : -2));
    ctx.stroke();
  }
  ctx.restore();

  // Render Question Text lines crisply
  ctx.font = `600 ${fontSize}px ${fontStack}`;
  ctx.fillStyle = '#f8fafc';
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
