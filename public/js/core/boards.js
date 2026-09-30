// LED boards RGBcommander can drive, and how their pins map to RGB LEDs.

export const BOARDS = {
  ultimateio: {
    id: 'ultimateio',
    name: 'Ultimarc I-PAC Ultimate I/O',
    shortName: 'Ultimate I/O',
    rgbcmdName: 'ULTIMATEIO_1',
    hwthrottle: 417,
    pinCount: 96,
    portCount: 32,
    // Pins 1-48 run R,G,B; the other header (49-96) runs B,G,R. RGBcommander's
    // own example config wires P1_BUTTON1 as pin="81,80,79" for this reason.
    portPins(port) {
      const first = port * 3 - 2;
      return port <= 16 ? { r: first, g: first + 1, b: first + 2 } : { r: first + 2, g: first + 1, b: first };
    },
    portOrder(port) {
      return port <= 16 ? 'rgb' : 'bgr';
    },
    // Rough time the daemon spends pushing one frame over USB before it starts
    // the frame delay. Community measurements put a 255 ms frame at ~440 ms.
    frameWriteMs: 185,
  },
  pacled64: {
    id: 'pacled64',
    name: 'Ultimarc PacLED64',
    shortName: 'PacLED64',
    rgbcmdName: 'PACLED64_1',
    hwthrottle: 625,
    pinCount: 64,
    portCount: 21,
    portPins(port) {
      const first = port * 3 - 2;
      return { r: first, g: first + 1, b: first + 2 };
    },
    portOrder() {
      return 'rgb';
    },
    frameWriteMs: 125,
  },
};

export const DEFAULT_BOARD = 'ultimateio';

export function getBoard(id) {
  return BOARDS[id] || BOARDS[DEFAULT_BOARD];
}

export const CHANNEL_ORDERS = ['rgb', 'rbg', 'grb', 'gbr', 'brg', 'bgr'];

/** Pins of an LED port wired in a given channel order ('auto' uses the board's wiring). */
export function portPinsWithOrder(board, port, order = 'auto') {
  if (order === 'auto' || !CHANNEL_ORDERS.includes(order)) return board.portPins(port);
  const first = port * 3 - 2;
  const pins = {};
  [...order].forEach((ch, i) => {
    pins[ch] = first + i;
  });
  return pins;
}

/**
 * Resolve a control's wiring to pin numbers (1-based).
 * Returns { r, g, b } for RGB LEDs, { single, tint } for single-colour LEDs,
 * or null for controls without a light.
 */
export function resolveWiring(wiring, board) {
  if (!wiring || wiring.mode === 'none') return null;
  const ok = (p) => Number.isInteger(p) && p >= 1 && p <= board.pinCount;
  if (wiring.mode === 'port') {
    if (!Number.isInteger(wiring.port) || wiring.port < 1 || wiring.port > board.portCount) return null;
    return portPinsWithOrder(board, wiring.port, wiring.order);
  }
  if (wiring.mode === 'pins') {
    return ok(wiring.r) && ok(wiring.g) && ok(wiring.b) ? { r: wiring.r, g: wiring.g, b: wiring.b } : null;
  }
  if (wiring.mode === 'single') {
    return ok(wiring.pin) ? { single: wiring.pin, tint: wiring.tint || '#ffffff' } : null;
  }
  return null;
}

/** Which LED port (if any) a pin belongs to. */
export function portOfPin(pin) {
  return Math.ceil(pin / 3);
}
