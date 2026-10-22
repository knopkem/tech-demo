/**
 * The Lumen Hollow palette — every colour in the world lives here so the
 * night scene stays cohesive. Hex numbers are sRGB; convert with
 * `new THREE.Color(...)` where linear is needed (three handles the space
 * when assigned to material colour properties).
 */
export const PALETTE = {
  // Sky
  zenithIndigo: 0x0b1030,
  upperIndigo: 0x131a45,
  horizonTeal: 0x0e3a3f,
  afterglow: 0xff7a4d,
  star: 0xcfe0ff,
  moon: 0xdfe8ff,
  moonHalo: 0x8fa8ff,

  // Sea
  seaDeep: 0x052029,
  seaGlow: 0x37f2d8,
  foam: 0xbff6ea,

  // Island ground
  wetSand: 0x24322f,
  drySand: 0x3d4a42,
  moss: 0x14382f,
  mossBright: 0x1d5a44,
  mossDeep: 0x0d2b23,
  mossMid: 0x184a38,
  rock: 0x232a3a,
  rockDark: 0x1a2030,
  rockMid: 0x2c3550,
  mineralCap: 0xb8d8cf,
  lagoonBed: 0x0a2e2b,
  lagoonShallow: 0x0f4a42,

  // Bioluminescence
  glowTeal: 0x3df5c8,
  glowCyan: 0x40f0ff,
  glowViolet: 0xb06bff,
  glowAmber: 0xffb340,
  floraTeal: 0x3df5c8,
  floraViolet: 0xb06bff,
  crystalCyan: 0x40f0ff,
  crystalViolet: 0xb06bff,

  // Atmosphere
  fog: 0x0a1622,
  mist: 0x9fd8e8,

  // Underwater
  underWater: 0x02151d,
} as const;

/** Alias kept for the modules written against the shorter name. */
export const P = PALETTE;

/** Crystal hue cycle for instanced spires. */
export const CRYSTAL_HUES = [
  0x40f0ff, // cyan
  0xb06bff, // violet
  0x2affc4, // teal
  0xffb340, // amber accent
] as const;

/**
 * The six hero monoliths. `x`/`z` are world coordinates, `hue` is the hex
 * attenuation colour and `height` (metres) scales the glass prism. Bases are
 * dropped onto the terrain at build time, so exact ground contact is free.
 */
export const HERO_CRYSTALS = [
  { x: -560, z: 470, hue: 0x40f0ff, height: 12 },
  { x: 300, z: -460, hue: 0xb06bff, height: 9 },
  { x: -340, z: -380, hue: 0x2affc4, height: 11 },
  { x: 520, z: 210, hue: 0xffb340, height: 8 },
  { x: 240, z: 480, hue: 0x40f0ff, height: 13 },
  { x: -120, z: 520, hue: 0x8fd0ff, height: 10 },
] as const;
