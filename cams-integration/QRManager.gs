/**
 * @fileoverview QRManager.gs — Offline QR code engine (ISO/IEC 18004, v1-10)
 * UPDATED FOR DIRECT FIREBASE VERIFICATION (NO APPS SCRIPT QR LINKS).
 *
 * Every QR code generated in VERIFICATION_URL mode encodes:
 *   https://embedx-assessment.web.app/verify?certificateId=<URL_ENCODED_ID>
 *
 * HOW TO UPDATE IN APPS SCRIPT:
 *   Open QRManager.gs in your CAMS Apps Script editor -> Select All (Ctrl+A) ->
 *   Paste this file -> Save (Ctrl+S).
 */

/** Official Firebase Certificate Verification URL (No Google login / No /u/5/ redirect). */
const CAMS_FIREBASE_VERIFY_URL = 'https://embedx-assessment.web.app/verify';

/** Static QR tables. Only versions 1-10 are needed by CAMS. */
const CAMS_QR = Object.freeze({
  /** Format-information bit pattern per error-correction level. */
  EC_LEVEL: Object.freeze({ L: 1, M: 0, Q: 3, H: 2 }),

  /** Highest version the built-in encoder supports. */
  MAX_VERSION: 10,

  /** Error-correction codewords per block, indexed by level then version 1-10. */
  EC_CODEWORDS_PER_BLOCK: Object.freeze({
    L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28]
  }),

  /** Number of error-correction blocks, indexed by level then version 1-10. */
  NUM_EC_BLOCKS: Object.freeze({
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8]
  }),

  /** Total codewords (data + error correction) per version 1-10. */
  TOTAL_CODEWORDS: Object.freeze([26, 44, 70, 100, 134, 172, 196, 242, 292, 346]),

  /** Alignment-pattern centre coordinates per version 1-10. */
  ALIGNMENT_CENTERS: Object.freeze([
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
  ])
});

/* -------------------------------------------------------------------------- */
/* Payload (Direct Firebase Link — Never Apps Script)                         */
/* -------------------------------------------------------------------------- */

/**
 * Returns the QR text for a certificate, pointing directly to Firebase /verify.
 * @param {!Object} certificate Certificate data object.
 * @return {string} Text to encode.
 */
function buildQrPayload_(certificate) {
  const mode = String(getSetting_('QR Data Mode') || 'VERIFICATION_URL').trim().toUpperCase();

  if (mode === 'CERTIFICATE_ID') return String(certificate.certificateId || '').trim();

  if (mode === 'VERIFICATION_URL') {
    const base = normalizeQrBaseUrl_(getSetting_('QR Verification Base URL'));
    const separator = base.indexOf('?') >= 0 ? '&' : '?';
    return base + separator + 'certificateId=' + encodeURIComponent(String(certificate.certificateId || '').trim());
  }

  throw new Error('Unsupported QR Data Mode: ' + mode + '. Use CERTIFICATE_ID or VERIFICATION_URL.');
}

/**
 * Cleans "QR Verification Base URL" and guarantees QR codes ALWAYS point to the
 * direct public Firebase verification portal (never script.google.com / /u/5/).
 *
 * @param {string} rawValue Raw Settings value.
 * @return {string} Clean public verification base URL (https://embedx-assessment.web.app/verify).
 */
function normalizeQrBaseUrl_(rawValue) {
  const raw = String(rawValue === undefined || rawValue === null ? '' : rawValue).trim();

  const anyUrl = raw.match(/https?:\/\/[^\s\[\]()<>"']+/i);
  if (anyUrl) {
    const cleaned = anyUrl[0]
      .replace(/[?&]certificateId=.*$/i, '')
      .replace(/[.,;:]+$/, '')
      .replace(/\/+$/, '');

    // Block all Google Apps Script links (/macros/s/, /macros/u/5/s/, /a/macros/...)
    // so QR scans go straight to Firebase without Workspace login or /u/5/ routing bugs.
    if (/script\.google\.com|googleusercontent\.com/i.test(cleaned)) {
      return CAMS_FIREBASE_VERIFY_URL;
    }

    return cleaned;
  }

  return CAMS_FIREBASE_VERIFY_URL;
}

/* -------------------------------------------------------------------------- */
/* Slides integration                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Replaces a standalone {{QR_CODE}} text box with a rendered QR code.
 * @param {!SlidesApp.Presentation} presentation Open presentation.
 * @param {!Object} certificate Certificate data object.
 */
function insertQrCodeIntoPresentation_(presentation, certificate) {
  if (String(getSetting_('QR Enabled') || 'FALSE').toUpperCase() !== 'TRUE') return;

  const placeholder = getSetting_('QR Placeholder') || '{{QR_CODE}}';
  const targets = [];

  presentation.getSlides().forEach(slide => {
    slide.getShapes().forEach(shape => {
      const text = String(shape.getText().asString() || '').replace(/\s+/g, '');
      if (text === placeholder.replace(/\s+/g, '')) {
        targets.push({
          slide: slide,
          shape: shape,
          left: shape.getLeft(),
          top: shape.getTop(),
          width: shape.getWidth(),
          height: shape.getHeight()
        });
      }
    });
  });

  if (!targets.length) {
    throw new Error('QR Enabled is TRUE but no standalone Slides placeholder ' + placeholder + ' was found. It must sit alone in one text box, with no line break.');
  }

  const payload = buildQrPayload_(certificate);
  const level = String(getSetting_('QR Error Correction Level') || 'M').trim().toUpperCase();
  const encoded = qrEncode_(payload, level);

  const foreground = getSetting_('QR Foreground Color') || '#000000';
  const background = getSetting_('QR Background Color') || '#FFFFFF';
  const quietZone = Math.max(4, Number(getSetting_('QR Quiet Zone') || 4));
  const renderMode = String(getSetting_('QR Render Mode') || 'AUTO').trim().toUpperCase();

  Logger.log('QR: version ' + encoded.version + ', level ' + level + ', mask ' + encoded.mask +
    ', matrix ' + encoded.matrix.length + 'x' + encoded.matrix.length + ', payload ' + payload.length + ' chars -> ' + payload);

  targets.forEach(target => {
    const useImage = renderMode === 'IMAGE' ||
      (renderMode !== 'SHAPES' && encoded.matrix.length > 33);

    if (useImage) {
      drawQrImage_(target.slide, encoded.matrix, target.left, target.top, target.width, target.height, quietZone, foreground, background, certificate);
    } else {
      drawQrMatrix_(target.slide, encoded.matrix, target.left, target.top, target.width, target.height, quietZone, foreground, background);
    }
    target.shape.remove();
  });
}

/**
 * Draws the QR as native Slides rectangles. Best for short payloads only.
 */
function drawQrMatrix_(slide, matrix, left, top, width, height, quietZone, foreground, background) {
  const modules = matrix.length;
  const total = modules + quietZone * 2;
  const unit = Math.min(width, height) / total;
  const size = unit * total;
  const x = left + (width - size) / 2;
  const y = top + (height - size) / 2;

  const backdrop = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, size, size);
  backdrop.getFill().setSolidFill(background);
  backdrop.getBorder().getLineFill().setSolidFill(background, 0);

  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!matrix[row][col]) continue;
      const module = slide.insertShape(
        SlidesApp.ShapeType.RECTANGLE,
        x + (col + quietZone) * unit,
        y + (row + quietZone) * unit,
        unit + 0.05,
        unit + 0.05
      );
      module.getFill().setSolidFill(foreground);
      module.getBorder().getLineFill().setSolidFill(foreground, 0);
    }
  }
}

/**
 * Draws the QR as a single PNG image built in memory.
 */
function drawQrImage_(slide, matrix, left, top, width, height, quietZone, foreground, background, certificate) {
  const pngBytes = qrCreatePng_(matrix, {
    scale: 6,
    quietZone: quietZone,
    foreground: foreground,
    background: background
  });

  const fileName = formatTemplate_(
    getSetting_('QR File Name Pattern') || '{{CERTIFICATE_ID}}-QR.png',
    { CERTIFICATE_ID: (certificate && certificate.certificateId) || 'QR' }
  );
  const blob = Utilities.newBlob(pngBytes, 'image/png', fileName);

  if (String(getSetting_('QR Keep Image File') || 'FALSE').toUpperCase() === 'TRUE') {
    try {
      const folder = getFolderBySetting_('Email Assets Folder ID');
      if (!findFileInFolderByName_(folder, fileName)) folder.createFile(blob);
    } catch (error) {
      Logger.log('QR image was not saved to Drive: ' + error.message);
    }
  }

  const size = Math.min(width, height);
  const x = left + (width - size) / 2;
  const y = top + (height - size) / 2;
  slide.insertImage(blob, x, y, size, size);
}

/* -------------------------------------------------------------------------- */
/* Encoder core                                                               */
/* -------------------------------------------------------------------------- */

function qrEncode_(text, requestedLevel, forcedMask) {
  const level = String(requestedLevel || 'M').trim().toUpperCase();
  if (!(level in CAMS_QR.EC_LEVEL)) throw new Error('QR Error Correction Level must be L, M, Q, or H.');

  const bytes = qrUtf8Bytes_(text);
  const version = qrChooseVersion_(bytes.length, level);
  const codewords = qrBuildCodewords_(bytes, version, level);

  let best = null;
  const masks = forcedMask === null || forcedMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask];

  masks.forEach(mask => {
    const matrix = qrBuildMatrix_(codewords, version, level, mask);
    const penalty = qrPenaltyScore_(matrix);
    if (!best || penalty < best.penalty) best = { matrix: matrix, mask: mask, penalty: penalty };
  });

  return { matrix: best.matrix, version: version, mask: best.mask, level: level };
}

function createQrMatrix_(text, requestedLevel) {
  return qrEncode_(text, requestedLevel).matrix;
}

function qrChooseVersion_(byteLength, level) {
  for (let version = 1; version <= CAMS_QR.MAX_VERSION; version++) {
    const capacity = qrDataCodewordCount_(version, level) * 8;
    const header = 4 + qrCharCountBits_(version);
    if (header + byteLength * 8 <= capacity) return version;
  }
  throw new Error('QR content is too long (' + byteLength + ' bytes) for the built-in encoder at level ' +
    level + ' (max version ' + CAMS_QR.MAX_VERSION + '). Shorten the verification URL or lower the error-correction level.');
}

function qrCharCountBits_(version) {
  return version <= 9 ? 8 : 16;
}

function qrDataCodewordCount_(version, level) {
  const blocks = CAMS_QR.NUM_EC_BLOCKS[level][version - 1];
  const ecPerBlock = CAMS_QR.EC_CODEWORDS_PER_BLOCK[level][version - 1];
  return CAMS_QR.TOTAL_CODEWORDS[version - 1] - blocks * ecPerBlock;
}

function qrBuildCodewords_(bytes, version, level) {
  const numBlocks = CAMS_QR.NUM_EC_BLOCKS[level][version - 1];
  const ecPerBlock = CAMS_QR.EC_CODEWORDS_PER_BLOCK[level][version - 1];
  const dataCodewords = qrDataCodewordCount_(version, level);

  const bits = [];
  qrPushBits_(bits, 0x4, 4);
  qrPushBits_(bits, bytes.length, qrCharCountBits_(version));
  bytes.forEach(value => qrPushBits_(bits, value, 8));

  const capacityBits = dataCodewords * 8;
  qrPushBits_(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) value = (value << 1) | bits[i + bit];
    data.push(value);
  }
  for (let pad = 0; data.length < dataCodewords; pad++) data.push(pad % 2 === 0 ? 0xEC : 0x11);

  const shortBlockLength = Math.floor(dataCodewords / numBlocks);
  const longBlockCount = dataCodewords % numBlocks;
  const blocks = [];
  let offset = 0;

  for (let i = 0; i < numBlocks; i++) {
    const length = shortBlockLength + (i >= numBlocks - longBlockCount ? 1 : 0);
    const blockData = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: blockData, ec: qrReedSolomon_(blockData, ecPerBlock) });
  }

  const result = [];
  const maxDataLength = shortBlockLength + (longBlockCount > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLength; i++) {
    blocks.forEach(block => { if (i < block.data.length) result.push(block.data[i]); });
  }
  for (let i = 0; i < ecPerBlock; i++) {
    blocks.forEach(block => result.push(block.ec[i]));
  }
  return result;
}

function qrReedSolomon_(data, ecLength) {
  const generator = qrRsGenerator_(ecLength);
  const remainder = new Array(ecLength).fill(0);

  data.forEach(value => {
    const factor = value ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i++) remainder[i] ^= qrGfMultiply_(generator[i], factor);
  });
  return remainder;
}

function qrRsGenerator_(degree) {
  let polynomial = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(polynomial.length + 1).fill(0);
    for (let j = 0; j < polynomial.length; j++) {
      next[j] ^= qrGfMultiply_(polynomial[j], 1);
      next[j + 1] ^= qrGfMultiply_(polynomial[j], qrGfExp_(i));
    }
    polynomial = next;
  }
  return polynomial.slice(1);
}

let QR_GF_EXP_ = null;
let QR_GF_LOG_ = null;

function qrGfInit_() {
  if (QR_GF_EXP_) return;
  QR_GF_EXP_ = new Array(512);
  QR_GF_LOG_ = new Array(256).fill(0);
  let value = 1;
  for (let i = 0; i < 255; i++) {
    QR_GF_EXP_[i] = value;
    QR_GF_LOG_[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) QR_GF_EXP_[i] = QR_GF_EXP_[i - 255];
}

function qrGfExp_(exponent) {
  qrGfInit_();
  return QR_GF_EXP_[exponent % 255];
}

function qrGfMultiply_(a, b) {
  if (!a || !b) return 0;
  qrGfInit_();
  return QR_GF_EXP_[QR_GF_LOG_[a] + QR_GF_LOG_[b]];
}

function qrPushBits_(target, value, length) {
  for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
}

function qrUtf8Bytes_(text) {
  const bytes = [];
  const source = String(text === null || text === undefined ? '' : text);

  for (let i = 0; i < source.length; i++) {
    let code = source.charCodeAt(i);

    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < source.length) {
      const low = source.charCodeAt(i + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
        i++;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F),
        0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
  }
  return bytes;
}

/* -------------------------------------------------------------------------- */
/* Matrix construction                                                        */
/* -------------------------------------------------------------------------- */

function qrBuildMatrix_(codewords, version, level, mask) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunction = (x, y, dark) => {
    modules[y][x] = !!dark;
    isFunction[y][x] = true;
  };

  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(center => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = center[0] + dx;
        const y = center[1] + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  });

  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunction(i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(6, i, i % 2 === 0);
  }

  const centers = CAMS_QR.ALIGNMENT_CENTERS[version - 1] || [];
  centers.forEach(row => {
    centers.forEach(col => {
      const cornerTop = row === 6 && col === 6;
      const cornerTopRight = row === 6 && col === centers[centers.length - 1];
      const cornerBottomLeft = row === centers[centers.length - 1] && col === 6;
      if (cornerTop || cornerTopRight || cornerBottomLeft) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(col + dx, row + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  for (let i = 0; i <= 8; i++) {
    if (!isFunction[8][i]) setFunction(i, 8, false);
    if (!isFunction[i][8]) setFunction(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) setFunction(size - 1 - i, 8, false);
    if (!isFunction[size - 1 - i][8]) setFunction(8, size - 1 - i, false);
  }

  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1F25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }
  }

  qrDrawFormatBits_(setFunction, size, level, mask);

  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (isFunction[y][x]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
        modules[y][x] = dark !== qrMaskBit_(mask, x, y);
      }
    }
  }
  return modules;
}

function qrDrawFormatBits_(setFunction, size, level, mask) {
  const data = (CAMS_QR.EC_LEVEL[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunction(8, i, (bits >>> i) & 1);
  setFunction(8, 7, (bits >>> 6) & 1);
  setFunction(8, 8, (bits >>> 7) & 1);
  setFunction(7, 8, (bits >>> 8) & 1);
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, (bits >>> i) & 1);

  for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, (bits >>> i) & 1);
  for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, (bits >>> i) & 1);
  setFunction(8, size - 8, true);
}

function qrMaskBit_(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new Error('Invalid QR mask: ' + mask);
  }
}

function qrPenaltyScore_(matrix) {
  const size = matrix.length;
  let score = 0;

  for (let i = 0; i < size; i++) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < size; j++) {
      runRow = matrix[i][j] === matrix[i][j - 1] ? runRow + 1 : 1;
      if (runRow === 5) score += 3; else if (runRow > 5) score += 1;

      runCol = matrix[j][i] === matrix[j - 1][i] ? runCol + 1 : 1;
      if (runCol === 5) score += 3; else if (runCol > 5) score += 1;
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const value = matrix[y][x];
      if (value === matrix[y][x + 1] && value === matrix[y + 1][x] && value === matrix[y + 1][x + 1]) score += 3;
    }
  }

  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];

  const matches = (getter, start) => {
    let matchA = true;
    let matchB = true;
    for (let k = 0; k < 11; k++) {
      const value = getter(start + k);
      if (value !== patternA[k]) matchA = false;
      if (value !== patternB[k]) matchB = false;
      if (!matchA && !matchB) return 0;
    }
    return (matchA ? 1 : 0) + (matchB ? 1 : 0);
  };

  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - 11; j++) {
      score += 40 * matches(k => matrix[i][k], j);
      score += 40 * matches(k => matrix[k][i], j);
    }
  }

  let dark = 0;
  matrix.forEach(row => row.forEach(cell => { if (cell) dark++; }));
  const total = size * size;
  const ratio = dark / total;
  score += Math.floor(Math.abs(ratio * 100 - 50) / 5) * 10;

  return score;
}

/* -------------------------------------------------------------------------- */
/* PNG writer (no library, zlib "stored" blocks)                              */
/* -------------------------------------------------------------------------- */

function qrCreatePng_(matrix, options) {
  const scale = Math.max(1, Number(options.scale) || 6);
  const quietZone = Math.max(0, Number(options.quietZone) || 4);
  const foreground = qrParseColor_(options.foreground || '#000000');
  const background = qrParseColor_(options.background || '#FFFFFF');

  const modules = matrix.length;
  const pixelsPerSide = (modules + quietZone * 2) * scale;

  const raw = new Uint8Array(pixelsPerSide * (pixelsPerSide * 3 + 1));
  let offset = 0;

  for (let y = 0; y < pixelsPerSide; y++) {
    raw[offset++] = 0;
    const moduleRow = Math.floor(y / scale) - quietZone;
    for (let x = 0; x < pixelsPerSide; x++) {
      const moduleCol = Math.floor(x / scale) - quietZone;
      const dark = moduleRow >= 0 && moduleRow < modules && moduleCol >= 0 && moduleCol < modules &&
        matrix[moduleRow][moduleCol];
      const color = dark ? foreground : background;
      raw[offset++] = color[0];
      raw[offset++] = color[1];
      raw[offset++] = color[2];
    }
  }

  const header = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = new Uint8Array(13);
  qrWriteUint32_(ihdr, 0, pixelsPerSide);
  qrWriteUint32_(ihdr, 4, pixelsPerSide);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    header,
    qrPngChunk_('IHDR', ihdr),
    qrPngChunk_('IDAT', qrZlibStored_(raw)),
    qrPngChunk_('IEND', new Uint8Array(0))
  ];

  let total = 0;
  parts.forEach(part => { total += part.length; });
  const png = new Uint8Array(total);
  let cursor = 0;
  parts.forEach(part => { png.set(part, cursor); cursor += part.length; });
  return Array.from(png);
}

function qrWriteUint32_(target, offset, value) {
  target[offset] = (value >>> 24) & 0xFF;
  target[offset + 1] = (value >>> 16) & 0xFF;
  target[offset + 2] = (value >>> 8) & 0xFF;
  target[offset + 3] = value & 0xFF;
}

function qrPngChunk_(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  qrWriteUint32_(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  qrWriteUint32_(chunk, 8 + data.length, qrCrc32_(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function qrZlibStored_(data) {
  const blockSize = 65535;
  const blockCount = Math.max(1, Math.ceil(data.length / blockSize));
  const output = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let offset = 0;

  output[offset++] = 0x78;
  output[offset++] = 0x01;

  for (let block = 0; block < blockCount; block++) {
    const start = block * blockSize;
    const length = Math.min(blockSize, data.length - start);
    output[offset++] = block === blockCount - 1 ? 1 : 0;
    output[offset++] = length & 0xFF;
    output[offset++] = (length >>> 8) & 0xFF;
    output[offset++] = (~length) & 0xFF;
    output[offset++] = ((~length) >>> 8) & 0xFF;
    output.set(data.subarray(start, start + length), offset);
    offset += length;
  }

  const adler = qrAdler32_(data);
  output[offset++] = (adler >>> 24) & 0xFF;
  output[offset++] = (adler >>> 16) & 0xFF;
  output[offset++] = (adler >>> 8) & 0xFF;
  output[offset++] = adler & 0xFF;

  return output.subarray(0, offset);
}

let QR_CRC_TABLE_ = null;

function qrCrc32_(bytes) {
  if (!QR_CRC_TABLE_) {
    QR_CRC_TABLE_ = new Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
      QR_CRC_TABLE_[i] = value >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = QR_CRC_TABLE_[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function qrAdler32_(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function qrParseColor_(value) {
  const text = String(value || '#000000').trim();
  const hex = text.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  }
  const named = { BLACK: [0, 0, 0], WHITE: [255, 255, 255] };
  const key = text.toUpperCase();
  return named[key] || [0, 0, 0];
}
