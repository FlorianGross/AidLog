/**
 * devicetransfer/qr.ts — a minimal, dependency-free QR Code encoder.
 *
 * DESIGN CHOICE: the transfer code is a longish base64url string, so we need a
 * real QR (not just a copyable block). Rather than add an npm dependency, this
 * is a compact from-scratch encoder supporting exactly what we need:
 *   - BYTE mode (8-bit) encoding of arbitrary ASCII,
 *   - error-correction level L (max data capacity),
 *   - automatic smallest-version selection (versions 1–40),
 *   - mask pattern 0 with the correct format-information bits.
 *
 * It returns a boolean module matrix (true = dark) which the Svelte component
 * paints as an SVG. If the payload exceeds version-40/L capacity, `encodeQr`
 * returns null and the UI falls back to the copyable code block only.
 *
 * This file does NO content crypto — it is pure data-to-matrix encoding — so it
 * does not touch the crypto boundary. It is intentionally small and auditable;
 * the Reed–Solomon and bit-placement steps follow the QR spec (ISO/IEC 18004).
 */

// --- GF(256) for Reed–Solomon (QR's field: primitive poly 0x11d) ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Reed–Solomon ECC bytes for `data` with `ecLen` error-correction codewords. */
function rsEncode(data: number[], ecLen: number): number[] {
  // Build the generator polynomial.
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j]! ^= mul(gen[j]!, EXP[i]!);
      next[j + 1]! ^= gen[j]!;
    }
    gen = next;
  }
  const res = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res.shift()!;
    res.push(0);
    for (let j = 0; j < gen.length - 1; j++) res[j]! ^= mul(gen[j + 1]!, factor);
  }
  return res;
}

// --- per-version capacity & block structure for EC level L ----------------
// [ totalDataCodewords, ecCodewordsPerBlock, numBlocksGroup1, numBlocksGroup2 ]
// Group-2 blocks hold one more data codeword than group-1. Values per ISO 18004
// Table-9 (EC level L), versions 1..40.
const L_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [19, 7, 1, 0],
  [34, 10, 1, 0],
  [55, 15, 1, 0],
  [80, 20, 1, 0],
  [108, 26, 1, 0],
  [136, 18, 2, 0],
  [156, 20, 2, 0],
  [194, 24, 2, 0],
  [232, 30, 2, 0],
  [274, 18, 2, 2],
  [324, 20, 4, 0],
  [370, 24, 2, 2],
  [428, 26, 4, 0],
  [461, 30, 3, 1],
  [523, 22, 5, 1],
  [589, 24, 5, 1],
  [647, 28, 1, 5],
  [721, 30, 5, 1],
  [795, 28, 3, 4],
  [861, 28, 3, 5],
  [932, 28, 4, 4],
  [1006, 28, 2, 7],
  [1094, 30, 4, 5],
  [1174, 30, 6, 4],
  [1276, 26, 8, 4],
  [1370, 28, 10, 2],
  [1468, 30, 8, 4],
  [1531, 30, 3, 10],
  [1631, 30, 7, 7],
  [1735, 30, 5, 10],
  [1843, 30, 13, 3],
  [1955, 30, 17, 0],
  [2071, 30, 17, 1],
  [2191, 30, 13, 6],
  [2306, 30, 12, 7],
  [2434, 30, 6, 14],
  [2566, 30, 17, 4],
  [2702, 30, 4, 18],
  [2812, 30, 20, 4],
  [2956, 30, 19, 6],
];

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const last = size - 7;
  const step = Math.ceil((last - 6) / (count - 1) / 2) * 2;
  const pos = [6];
  for (let i = 1; i < count; i++) pos.push(last - (count - 1 - i) * step);
  return pos;
}

/**
 * Encode `text` (ASCII) into a QR module matrix at EC level L. Returns the
 * boolean matrix (true = dark module) or null if it doesn't fit version 40.
 */
export function encodeQr(text: string): boolean[][] | null {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);

  // Smallest version whose data capacity holds: mode(4) + count + data + term.
  let version = 0;
  for (let v = 1; v <= 40; v++) {
    const cap = L_TABLE[v - 1]![0];
    const countBits = v <= 9 ? 8 : 16;
    const needBits = 4 + countBits + bytes.length * 8;
    if (Math.ceil(needBits / 8) <= cap) {
      version = v;
      break;
    }
  }
  if (version === 0) return null;

  const [totalData, ecLen, blocks1, blocks2] = L_TABLE[version - 1]!;
  const countBits = version <= 9 ? 8 : 16;

  // --- bitstream: BYTE mode header + length + data + terminator + padding ---
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  // terminator (up to 4 zero bits)
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    dataCw.push(b);
  }
  // pad codewords 0xEC / 0x11 alternating
  const pads = [0xec, 0x11];
  let pi = 0;
  while (dataCw.length < totalData) dataCw.push(pads[pi++ % 2]!);

  // --- split into blocks, compute EC, then interleave -----------------------
  const numBlocks = blocks1 + blocks2;
  const g1Count = Math.floor(totalData / numBlocks); // group-1 data codewords/block
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = b < blocks1 ? g1Count : g1Count + 1;
    const block = dataCw.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }
  const finalCw: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) finalCw.push(blk[i]!);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const blk of ecBlocks) finalCw.push(blk[i]!);
  }

  // --- module matrix --------------------------------------------------------
  const size = version * 4 + 17;
  const m: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const set = (r: number, c: number, dark: boolean) => {
    m[r]![c] = dark;
    reserved[r]![c] = true;
  };

  const placeFinder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
            ? dr === 0 ||
              dr === 6 ||
              dc === 0 ||
              dc === 6 ||
              (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
            : false;
        set(rr, cc, inRing);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6]![i]) set(6, i, i % 2 === 0);
    if (!reserved[i]![6]) set(i, 6, i % 2 === 0);
  }

  // alignment patterns
  const aligns = alignmentPositions(version);
  for (const ar of aligns) {
    for (const ac of aligns) {
      if (reserved[ar]![ac]) continue; // skip ones overlapping finders
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          set(ar + dr, ac + dc, dark);
        }
      }
    }
  }

  // dark module + reserve format/version areas
  set(size - 8, 8, true);
  const reserveFormat = () => {
    for (let i = 0; i < 9; i++) {
      if (!reserved[8]![i]) reserved[8]![i] = true;
      if (!reserved[i]![8]) reserved[i]![8] = true;
    }
    for (let i = 0; i < 8; i++) {
      reserved[8]![size - 1 - i] = true;
      reserved[size - 1 - i]![8] = true;
    }
  };
  reserveFormat();
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[i]![size - 11 + j] = true;
        reserved[size - 11 + j]![i] = true;
      }
    }
  }

  // --- place data with mask 0 ((r+c)%2==0) ---------------------------------
  let bitIdx = 0;
  const dataBits: number[] = [];
  for (const cw of finalCw) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);

  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // skip the timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row]![cc]) continue;
        let dark = bitIdx < dataBits.length ? dataBits[bitIdx++] === 1 : false;
        if ((row + cc) % 2 === 0) dark = !dark; // mask 0
        m[row]![cc] = dark;
      }
    }
    upward = !upward;
  }

  // --- format information (EC level L = 01, mask 0) -------------------------
  // 15-bit format string for (L, mask0) with BCH + XOR mask, precomputed.
  const FORMAT_L_MASK0 = 0b111011111000100;
  const fmt: number[] = [];
  for (let i = 14; i >= 0; i--) fmt.push((FORMAT_L_MASK0 >> i) & 1);
  // around top-left finder
  for (let i = 0; i <= 5; i++) m[8]![i] = fmt[i] === 1;
  m[8]![7] = fmt[6] === 1;
  m[8]![8] = fmt[7] === 1;
  m[7]![8] = fmt[8] === 1;
  for (let i = 9; i < 15; i++) m[14 - i]![8] = fmt[i] === 1;
  // duplicated copy near the other two finders
  for (let i = 0; i < 8; i++) m[size - 1 - i]![8] = fmt[i] === 1;
  for (let i = 8; i < 15; i++) m[8]![size - 15 + i] = fmt[i] === 1;
  m[size - 8]![8] = true; // dark module stays dark

  // --- version information (v >= 7) ----------------------------------------
  if (version >= 7) {
    const VERSION_BITS = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((VERSION_BITS >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      m[r]![size - 11 + c] = bit;
      m[size - 11 + c]![r] = bit;
    }
  }

  // finalize: any still-null module is light.
  return m.map((row) => row.map((cell) => cell === true));
}

/** 18-bit BCH version information for versions 7..40. */
function computeVersionBits(version: number): number {
  let d = version << 12;
  const g = 0x1f25;
  for (let i = 17; i >= 12; i--) {
    if ((d >> i) & 1) d ^= g << (i - 12);
  }
  return (version << 12) | (d & 0xfff);
}
