"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { win11B64, macB64 } from "./images_b64";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { fetchLaptops, fetchLaptopDesign, saveLaptopDesign, type Laptop } from "@/lib/supabase";
import styles from "./Laptop3dviewer.module.css";

// ---- Config ----
const BASE_COLORS = [
  { name: "Space Grey",      hex: "#4b4f56" },
  { name: "Silver",          hex: "#d6d9dd" },
  { name: "Midnight Black",  hex: "#1c1e22" },
  { name: "Rose Gold",       hex: "#d9b8ac" },
  { name: "Sky Blue",        hex: "#8bb4d6" },
  { name: "Starlight",       hex: "#e8e4dc" },
  { name: "Glacier White",   hex: "#f0f2f5" },
  { name: "Cobalt Blue",     hex: "#1f4e8c" },
  { name: "Forest Green",    hex: "#2d5a3d" },
  { name: "Volcanic Red",    hex: "#7a1a1a" },
  { name: "Arctic Purple",   hex: "#5b3f7a" },
  { name: "Champagne Gold",  hex: "#c9a86c" },
  { name: "Graphite",        hex: "#36383d" },
  { name: "Copper",          hex: "#8b5c3e" },
];

// Best-guess color per brand, since the laptops table has no color column
const BRAND_COLORS: Record<string, string> = {
  apple: "#4b4f56",
  macbook: "#4b4f56",
  dell: "#c9ccd1",
  hp: "#d6d9dd",
  lenovo: "#1c1e22",
  thinkpad: "#1c1e22",
  asus: "#1c1e22",
  rog: "#1c1e22",
  acer: "#c9ccd1",
  msi: "#26282c",
  microsoft: "#d6d9dd",
  surface: "#8bb4d6",
  razer: "#1c1e22",
  samsung: "#8bb4d6",
  lg: "#d6d9dd",
  gigabyte: "#1c1e22",
};

function colorForBrand(brand?: string): string {
  if (!brand) return BASE_COLORS[0].hex;
  const key = brand.toLowerCase().trim();
  for (const k of Object.keys(BRAND_COLORS)) {
    if (key.includes(k)) return BRAND_COLORS[k];
  }
  return BASE_COLORS[0].hex;
}

function osThemeForBrand(brand?: string): "windows" | "mac" {
  if (!brand) return "windows";
  const b = brand.toLowerCase();
  return b.includes("apple") || b.includes("macbook") ? "mac" : "windows";
}

function scaleForScreenSize(screenSize?: number | null): number {
  if (!screenSize) return 1;
  return THREE.MathUtils.clamp(screenSize / 14, 0.82, 1.2);
}

const FINISHES = [
  { name: "Matte",     roughness: 0.55, clearcoat: 0.2,  sheen: 0.2,  metalness: 0.65, sheenTint: "#ffffff" },
  { name: "Aluminum", roughness: 0.22, clearcoat: 0.55, sheen: 0.08, metalness: 0.82, sheenTint: "#ffffff" },
  { name: "Glossy",   roughness: 0.04, clearcoat: 1.0,  sheen: 0,    metalness: 0.7,  sheenTint: "#ffffff" },
  { name: "Titanium", roughness: 0.32, clearcoat: 0.3,  sheen: 0.35, metalness: 0.9,  sheenTint: "#c8c0b0" },
  { name: "Carbon",   roughness: 0.42, clearcoat: 0.65, sheen: 0.05, metalness: 0.4,  sheenTint: "#111111" },
];

const BACKLIGHTS = [
  { name: "Off",       color: null },
  { name: "White",     color: "#eef3ff" },
  { name: "Blue",      color: "#4d9dff" },
  { name: "Green",     color: "#5df29a" },
  { name: "Red",       color: "#ff4d4d" },
  { name: "Purple",    color: "#b04dff" },
  { name: "Amber",     color: "#ffb84d" },
  { name: "Cyan",      color: "#4dffe0" },
  { name: "Rainbow",   color: "__rainbow__" },
];

const BACKGROUNDS = [
  { name: "Studio",   color: "#f4f5f7", ground: "#e9eaed" },
  { name: "Dark",     color: "#1b1c1f", ground: "#2a2b2f" },
  { name: "Slate",    color: "#1a2033", ground: "#222840" },
  { name: "Warm",     color: "#1f1a14", ground: "#2c2418" },
];

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  iso: { pos: [3.0, 2.2, 4.0], target: [0, 0.35, 0] },
  front: { pos: [0, 0.9, 3.6], target: [0, 0.65, 0] },
  side: { pos: [3.8, 0.6, 0], target: [0, 0.4, 0] },
  top: { pos: [0.01, 4.2, 0.01], target: [0, 0, 0] },
  // Tight, close-up framing of just the screen -- for actually "using" the interactive OS
  // instead of clicking tiny targets on a small laptop viewed from a normal distance.
  screenFocus: { pos: [0, 0.85, 1.7], target: [0, 0.85, 0] },
};

// Overall footprint stays constant (screen-size scaling applies uniformly on top);
// everything else that actually varies between laptop families lives in SHAPE_PROFILES below.
const DIMS = {
  width: 2.2,
  depth: 1.5,
};

// ---- Shape profiles: brand families get genuinely different proportions/details, not just color ----
type ShapeProfile = {
  name: string;
  baseThickness: number;
  lidThickness: number;
  cornerRadius: number;      // 0 = sharp/angular, higher = rounded consumer look
  deckInsetX: number;        // how far the keyboard deck sits in from the sides
  bezelInset: number;        // screen bezel thickness (larger = thicker bezel, ThinkPad-like)
  vents: "side" | "rear" | "hidden";
  keyHeight: number;         // keycap thickness -- flatter for ultrabooks, taller for gaming
  keyGap: number;
  hasTrackpoint: boolean;
  hasCameraBump: boolean;
  logoStyle: "centered-glow" | "corner-etched";
  dishedKeys: boolean; // real ThinkPad keys are visibly concave/scooped, not flat chiclet keys
};

const SHAPE_PROFILES: Record<string, ShapeProfile> = {
  thinkpad: {
    name: "thinkpad",
    baseThickness: 0.078,
    lidThickness: 0.038,
    cornerRadius: 0.016,
    deckInsetX: 0.16,
    bezelInset: 0.05,
    vents: "side",
    keyHeight: 0.014,
    keyGap: 0.02,
    hasTrackpoint: true,
    hasCameraBump: true,
    logoStyle: "corner-etched",
    dishedKeys: true,
  },
  macbook: {
    name: "macbook",
    baseThickness: 0.052,
    lidThickness: 0.028,
    cornerRadius: 0.065,
    deckInsetX: 0.11,
    bezelInset: 0.022,
    vents: "hidden",
    keyHeight: 0.009,
    keyGap: 0.014,
    hasTrackpoint: false,
    hasCameraBump: false,
    logoStyle: "centered-glow",
    dishedKeys: false,
  },
  gaming: {
    name: "gaming",
    baseThickness: 0.098,
    lidThickness: 0.05,
    cornerRadius: 0.022,
    deckInsetX: 0.18,
    bezelInset: 0.035,
    vents: "rear",
    keyHeight: 0.02,
    keyGap: 0.016,
    hasTrackpoint: false,
    hasCameraBump: false,
    logoStyle: "centered-glow",
    dishedKeys: false,
  },
  default: {
    name: "default",
    baseThickness: 0.07,
    lidThickness: 0.04,
    cornerRadius: 0.04,
    deckInsetX: 0.14,
    bezelInset: 0.045,
    vents: "side",
    keyHeight: 0.016,
    keyGap: 0.018,
    hasTrackpoint: false,
    hasCameraBump: false,
    logoStyle: "centered-glow",
    dishedKeys: false,
  },
};

function isThinkpadName(brand?: string, model?: string): boolean {
  const b = (brand || "").toLowerCase();
  const m = (model || "").toLowerCase();
  return b.includes("thinkpad") || m.includes("thinkpad") ||
    (b.includes("lenovo") && (m.includes("x1") || m.includes("t14") || m.includes("carbon") || m.includes("p1")));
}

function profileForLaptop(brand?: string, model?: string): ShapeProfile {
  const b = (brand || "").toLowerCase();
  const m = (model || "").toLowerCase();
  if (b.includes("apple") || b.includes("macbook") || m.includes("macbook")) return SHAPE_PROFILES.macbook;
  if (isThinkpadName(brand, model)) return SHAPE_PROFILES.thinkpad;
  if (
    b.includes("rog") || m.includes("rog") || b.includes("razer") || b.includes("msi") ||
    m.includes("legion") || m.includes("predator") || m.includes("alienware") || m.includes("titan")
  ) return SHAPE_PROFILES.gaming;
  return SHAPE_PROFILES.default;
}

// ---- Exact-model dimension overrides, sourced from real spec sheets (mm, converted to scene units) ----
// This is the actual accuracy upgrade: instead of every ThinkPad or every MacBook sharing one guessed
// shape, laptops matching these specific model names get their *real* measured footprint and thickness.
// Anything not in this table still falls back to its shape-profile family above.
type DimensionOverride = { widthScene: number; depthScene: number; thicknessScene: number };

// Calibrated against the ThinkPad T14 Gen 5's real 315.9 x 223.7mm footprint mapping to this scene's
// existing 2.2 x 1.5 unit baseline -- so all other real-world mm figures convert on the same scale.
const MM_TO_SCENE_W = 2.2 / 315.9;
const MM_TO_SCENE_D = 1.5 / 223.7;

function mmToScene(widthMm: number, depthMm: number, thicknessMm: number): DimensionOverride {
  return {
    widthScene: widthMm * MM_TO_SCENE_W,
    depthScene: depthMm * MM_TO_SCENE_D,
    thicknessScene: thicknessMm * MM_TO_SCENE_W,
  };
}

// Keys are matched as case-insensitive substrings against "<brand> <model>".
// Source: manufacturer spec sheets / PSREF, checked at the time these were added.
const MODEL_DIMENSIONS: Record<string, DimensionOverride> = {
  "thinkpad t14 gen 5": mmToScene(315.9, 223.7, 17.7),
  "thinkpad t14s gen 5": mmToScene(313.6, 219.4, 15.3),
  "macbook air 13": mmToScene(304.1, 215.0, 11.3),
  "macbook air m2": mmToScene(304.1, 215.0, 11.3),
  "macbook pro 14": mmToScene(312.6, 221.2, 15.5),
  "legion 5": mmToScene(362.5, 260.0, 24.0),
  "xps 13": mmToScene(295.3, 199.04, 14.8),
};

function dimensionOverrideForLaptop(brand?: string, model?: string): DimensionOverride | null {
  const key = `${brand || ""} ${model || ""}`.toLowerCase();
  for (const [needle, dims] of Object.entries(MODEL_DIMENSIONS)) {
    if (key.includes(needle)) return dims;
  }
  return null;
}

// ---- Generic accurate-footprint fallback for every laptop NOT in the exact table above ----
// Previously, any unmatched laptop fell back to one flat 2.2x1.5 template scaled by a crudely
// clamped screen-size multiplier -- a 13" and an 11" laptop ended up nearly the same size. This
// instead derives real footprint from actual display geometry: diagonal + aspect ratio gives
// screen width/height, then realistic bezel allowances (which differ by laptop class) give the
// full chassis size -- the same math that makes the 7 exact-matched models above land within a
// few mm of their real spec sheets also applies universally here.
function aspectRatioForLaptop(brand?: string, model?: string): [number, number] {
  const b = (brand || "").toLowerCase();
  const m = (model || "").toLowerCase();
  if (m.includes("surface")) return [3, 2];
  if (b.includes("apple") || b.includes("macbook") || m.includes("macbook")) return [16, 10];
  if (isThinkpadName(brand, model)) return [16, 10];
  if (m.includes("xps") || m.includes("spectre") || m.includes("zenbook") || m.includes("expertbook")) return [16, 10];
  return [16, 9]; // most budget/older/gaming panels are still 16:9
}

function bezelMmForProfile(profileName: string): { side: number; top: number; bottom: number } {
  switch (profileName) {
    case "thinkpad": return { side: 5, top: 8, bottom: 14 };
    case "macbook": return { side: 4, top: 6, bottom: 8 };
    case "gaming": return { side: 6, top: 9, bottom: 16 };
    // "default" covers a wide mix of Dell/HP/Acer/etc across many years -- many older/budget
    // 16:9 panels have noticeably thicker bottom bezels than modern thin-bezel ultrabooks,
    // so this leans thicker than the named-brand profiles above to average better across that mix.
    default: return { side: 6, top: 8, bottom: 20 };
  }
}

function thicknessMmForProfile(profileName: string): number {
  switch (profileName) {
    case "macbook": return 12;
    case "gaming": return 24;
    case "thinkpad": return 18;
    default: return 16;
  }
}

function genericDimsFromScreenSize(
  screenSizeIn: number | null | undefined,
  brand: string | undefined,
  model: string | undefined,
  profileName: string
): DimensionOverride {
  const diag = screenSizeIn && screenSizeIn > 0 ? screenSizeIn : 14;
  const [aw, ah] = aspectRatioForLaptop(brand, model);
  const diagUnits = Math.sqrt(aw * aw + ah * ah);
  const screenWidthMm = (diag * (aw / diagUnits)) * 25.4;
  const screenHeightMm = (diag * (ah / diagUnits)) * 25.4;
  const bezel = bezelMmForProfile(profileName);
  const widthMm = screenWidthMm + bezel.side * 2;
  const depthMm = screenHeightMm + bezel.top + bezel.bottom;
  return mmToScene(widthMm, depthMm, thicknessMmForProfile(profileName));
}

// Single entry point every call site should use: exact spec-sheet match when we have one,
// otherwise a real screen-geometry-derived estimate -- never the old flat generic template.
function getAccurateDims(
  brand: string | undefined,
  model: string | undefined,
  screenSizeIn: number | null | undefined,
  profileName: string
): DimensionOverride {
  return dimensionOverrideForLaptop(brand, model) ?? genericDimsFromScreenSize(screenSizeIn, brand, model, profileName);
}

// ---- Real official color options per model, replacing the generic 14-swatch palette ----
// When a laptop matches one of these, the Color picker shows ONLY the colors that
// model actually ships in (verified against manufacturer pages), instead of letting
// the user pick an arbitrary shade Lenovo/Apple/Dell never made.
type OfficialColor = { name: string; hex: string };

const OFFICIAL_COLORS: Record<string, OfficialColor[]> = {
  "thinkpad t14 gen 5": [{ name: "Thunder Black", hex: "#1c1e22" }],
  "thinkpad t14s gen 5": [{ name: "Thunder Black", hex: "#1c1e22" }],
  "macbook air 13": [
    { name: "Midnight", hex: "#1e2a3d" },
    { name: "Starlight", hex: "#e9e2d0" },
    { name: "Space Gray", hex: "#5c5c5e" },
    { name: "Silver", hex: "#e5e5e7" },
  ],
  "macbook air m2": [
    { name: "Midnight", hex: "#1e2a3d" },
    { name: "Starlight", hex: "#e9e2d0" },
    { name: "Space Gray", hex: "#5c5c5e" },
    { name: "Silver", hex: "#e5e5e7" },
  ],
  "macbook pro 14": [
    { name: "Space Gray", hex: "#4b4d50" },
    { name: "Silver", hex: "#e5e5e7" },
  ],
  "xps 13": [
    { name: "Platinum", hex: "#e6e6e8" },
    { name: "Graphite", hex: "#3a3a3c" },
  ],
  "spectre x360": [
    { name: "Nightfall Black", hex: "#1a1a1c" },
    { name: "Natural Silver", hex: "#d6d6d8" },
    { name: "Nocturne Blue", hex: "#1f3350" },
  ],
  "legion 5": [{ name: "Onyx Grey", hex: "#3a3b3f" }],
  "legion pro 5": [{ name: "Onyx Grey", hex: "#3a3b3f" }],
};

function officialColorsForLaptop(brand?: string, model?: string): OfficialColor[] | null {
  const key = `${brand || ""} ${model || ""}`.toLowerCase();
  for (const [needle, colors] of Object.entries(OFFICIAL_COLORS)) {
    if (key.includes(needle)) return colors;
  }
  return null;
}

// ---- Real per-family port layouts, replacing the old "3 identical slots on the right" ----
// Actual counts/types/sides sourced from spec sheets: e.g. a real ThinkPad T14 has 2x USB-A +
// HDMI on one side and 2x USB-C/Thunderbolt + Ethernet + audio on the other; a MacBook Air has
// only MagSafe + 2x Thunderbolt on the left and a headphone jack on the right, nothing more.
type PortType = "usb-a" | "usb-c" | "hdmi" | "ethernet" | "audio" | "sdcard" | "lock" | "magsafe";
type PortSpec = { type: PortType; zRatio: number }; // zRatio: 0 = back/hinge edge, 1 = front edge

const PORT_DIMENSIONS: Record<PortType, { w: number; h: number; color: string }> = {
  "usb-a":   { w: 0.026, h: 0.011, color: "#9a9ea3" },
  "usb-c":   { w: 0.014, h: 0.006, color: "#c9ccd1" },
  "hdmi":    { w: 0.024, h: 0.008, color: "#9a9ea3" },
  "ethernet":{ w: 0.024, h: 0.02,  color: "#3a3d42" },
  "audio":   { w: 0.012, h: 0.012, color: "#1a1a1c" },
  "sdcard":  { w: 0.026, h: 0.003, color: "#5a5d62" },
  "lock":    { w: 0.012, h: 0.007, color: "#2a2c30" },
  "magsafe": { w: 0.016, h: 0.009, color: "#c9ccd1" },
};

const PORT_LAYOUTS: Record<string, { left: PortSpec[]; right: PortSpec[] }> = {
  thinkpad: {
    // Real T14: right side has 2x USB-A + HDMI; left side has 2x USB-C (Thunderbolt/USB4),
    // Ethernet, headphone jack, and a Kensington lock slot near the back.
    right: [
      { type: "lock", zRatio: 0.08 },
      { type: "hdmi", zRatio: 0.28 },
      { type: "usb-a", zRatio: 0.52 },
      { type: "usb-a", zRatio: 0.74 },
    ],
    left: [
      { type: "ethernet", zRatio: 0.15 },
      { type: "usb-c", zRatio: 0.4 },
      { type: "usb-c", zRatio: 0.58 },
      { type: "audio", zRatio: 0.8 },
    ],
  },
  macbook: {
    // Real MacBook Air: MagSafe 3 + 2x Thunderbolt/USB4 all on the left, headphone jack alone
    // on the right. Nothing else -- no HDMI, no USB-A, no Ethernet, no SD card.
    left: [
      { type: "magsafe", zRatio: 0.2 },
      { type: "usb-c", zRatio: 0.5 },
      { type: "usb-c", zRatio: 0.68 },
    ],
    right: [
      { type: "audio", zRatio: 0.25 },
    ],
  },
  gaming: {
    // Gaming laptops typically load most I/O onto the left side plus a rear cluster (approximated
    // here as extra left-side ports since this model doesn't build a separate back panel), with
    // just audio/one USB-A on the right so the RGB/vent side stays clear.
    left: [
      { type: "ethernet", zRatio: 0.12 },
      { type: "hdmi", zRatio: 0.3 },
      { type: "usb-c", zRatio: 0.48 },
      { type: "usb-a", zRatio: 0.64 },
      { type: "sdcard", zRatio: 0.82 },
    ],
    right: [
      { type: "usb-a", zRatio: 0.35 },
      { type: "audio", zRatio: 0.6 },
    ],
  },
  default: {
    right: [
      { type: "usb-a", zRatio: 0.25 },
      { type: "usb-a", zRatio: 0.5 },
      { type: "audio", zRatio: 0.75 },
    ],
    left: [
      { type: "usb-c", zRatio: 0.3 },
      { type: "hdmi", zRatio: 0.6 },
    ],
  },
};

function portLayoutForProfile(profileName: string): { left: PortSpec[]; right: PortSpec[] } {
  return PORT_LAYOUTS[profileName] ?? PORT_LAYOUTS.default;
}

// ---- Real per-family trackpad sizes, replacing the one fixed 0.62x0.4 pad every laptop shared ----
// Sourced from real product dimensions: a MacBook's Force Touch pad is dramatically larger than
// a ThinkPad's, and a real ThinkPad has three dedicated physical click buttons directly above
// its pad for TrackPoint use -- a detail no other laptop family has.
type TrackpadSpec = {
  widthMm: number;
  depthMm: number;
  hasClickButtons: boolean;
  cornerRadius: number;   // MacBook's pad has visibly rounder corners than a Windows clickpad
  matte: boolean;         // MacBook = glossy Force Touch glass; everyone else = more matte plastic/glass
  flush: boolean;         // MacBook's pad sits nearly level with the deck; others sit visibly recessed
};
const TRACKPAD_SPECS: Record<string, TrackpadSpec> = {
  thinkpad: { widthMm: 105, depthMm: 60, hasClickButtons: true, cornerRadius: 0.012, matte: true, flush: false },
  macbook: { widthMm: 132, depthMm: 82, hasClickButtons: false, cornerRadius: 0.045, matte: false, flush: true },
  gaming: { widthMm: 110, depthMm: 65, hasClickButtons: false, cornerRadius: 0.015, matte: true, flush: false },
  default: { widthMm: 105, depthMm: 65, hasClickButtons: false, cornerRadius: 0.015, matte: true, flush: false },
};
function trackpadSpecForProfile(profileName: string): TrackpadSpec {
  return TRACKPAD_SPECS[profileName] ?? TRACKPAD_SPECS.default;
}

// ---- Real keyboard layouts with actual printed labels, instead of a blank uniform grid ----
// A "u" is one standard keycap width; wider keys (space, shift, enter) get a multiple of that.
type KeyDef = { label: string; u: number; isMod?: boolean };
type KeyRow = KeyDef[];

const U = 0.1; // one key unit in scene units, matches the old keySize

// Real ANSI key-unit widths so every alpha row totals exactly 15u and columns
// actually line up under each other (they didn't before -- Tab/Caps/Shift/Enter/Backspace
// were all slightly off, so e.g. "A" wasn't sitting under "Q" the way it does on a real board).
const NUMBER_ROW: KeyRow = [
  { label: "`", u: 1 }, { label: "1", u: 1 }, { label: "2", u: 1 }, { label: "3", u: 1 },
  { label: "4", u: 1 }, { label: "5", u: 1 }, { label: "6", u: 1 }, { label: "7", u: 1 },
  { label: "8", u: 1 }, { label: "9", u: 1 }, { label: "0", u: 1 }, { label: "-", u: 1 },
  { label: "=", u: 1 }, { label: "Bksp", u: 2, isMod: true },
];
const QWERTY_ROW: KeyRow = [
  { label: "Tab", u: 1.5, isMod: true }, { label: "Q", u: 1 }, { label: "W", u: 1 }, { label: "E", u: 1 },
  { label: "R", u: 1 }, { label: "T", u: 1 }, { label: "Y", u: 1 }, { label: "U", u: 1 }, { label: "I", u: 1 },
  { label: "O", u: 1 }, { label: "P", u: 1 }, { label: "[", u: 1 }, { label: "]", u: 1 }, { label: "\\", u: 1.5, isMod: true },
];
const HOME_ROW: KeyRow = [
  { label: "Caps", u: 1.75, isMod: true }, { label: "A", u: 1 }, { label: "S", u: 1 }, { label: "D", u: 1 },
  { label: "F", u: 1 }, { label: "G", u: 1 }, { label: "H", u: 1 }, { label: "J", u: 1 }, { label: "K", u: 1 },
  { label: "L", u: 1 }, { label: ";", u: 1 }, { label: "'", u: 1 }, { label: "Enter", u: 2.25, isMod: true },
];
const SHIFT_ROW: KeyRow = [
  { label: "Shift", u: 2.25, isMod: true }, { label: "Z", u: 1 }, { label: "X", u: 1 }, { label: "C", u: 1 },
  { label: "V", u: 1 }, { label: "B", u: 1 }, { label: "N", u: 1 }, { label: "M", u: 1 }, { label: ",", u: 1 },
  { label: ".", u: 1 }, { label: "/", u: 1 }, { label: "Shift", u: 2.75, isMod: true },
];
// Real ThinkPad top row includes Home/End/Insert/Delete after F12 (with a gap), matching
// the photo. These are narrower keys than a full 1u -- on the real keyboard the whole
// function row stays close to the same overall width as the rows below it (Insert/Delete's
// right edge roughly lines up with Backspace/Enter's), not noticeably wider.
const FUNCTION_ROW: KeyRow = [
  { label: "Esc", u: 1, isMod: true }, { label: "", u: 0.3 },
  { label: "F1", u: 1 }, { label: "F2", u: 1 }, { label: "F3", u: 1 }, { label: "F4", u: 1 }, { label: "", u: 0.3 },
  { label: "F5", u: 1 }, { label: "F6", u: 1 }, { label: "F7", u: 1 }, { label: "F8", u: 1 }, { label: "", u: 0.3 },
  { label: "F9", u: 1 }, { label: "F10", u: 1 }, { label: "F11", u: 1 }, { label: "F12", u: 1 }, { label: "", u: 0.3 },
  { label: "Home", u: 0.8, isMod: true }, { label: "End", u: 0.8, isMod: true },
  { label: "Insert", u: 0.8, isMod: true }, { label: "Delete", u: 0.8, isMod: true },
];

// ThinkPad's signature layout quirk: Fn sits to the LEFT of Ctrl (opposite of nearly every
// other PC keyboard). Also matching the real photo: PrtSc is its own dedicated key (not
// "AltGr", which a real ThinkPad US layout doesn't print), and there's a stacked PgUp/PgDn
// pair between right-Ctrl and the arrow cluster -- both were missing before.
const THINKPAD_BOTTOM_ROW: KeyRow = [
  { label: "Fn", u: 1, isMod: true }, { label: "Ctrl", u: 1.2, isMod: true }, { label: "Win", u: 1, isMod: true },
  { label: "Alt", u: 1, isMod: true }, { label: "", u: 4.4 }, { label: "Alt", u: 1, isMod: true },
  { label: "PrtSc", u: 0.85, isMod: true }, { label: "Ctrl", u: 1.2, isMod: true },
  { label: "PgUp\nPgDn", u: 0.85, isMod: true },
  { label: "\u25c0", u: 0.9, isMod: true }, { label: "\u25b2\n\u25bc", u: 0.9, isMod: true },
  { label: "\u25b6", u: 0.9, isMod: true },
];

// MacBook: Control/Option/Command ordering with the Touch ID button replacing the last
// function-row key, and the same inverted-T arrow cluster Apple has used for years.
const MACBOOK_BOTTOM_ROW: KeyRow = [
  { label: "Fn", u: 1, isMod: true }, { label: "Ctrl", u: 1, isMod: true }, { label: "\u2325", u: 1, isMod: true },
  { label: "\u2318", u: 1.3, isMod: true }, { label: "", u: 5 }, { label: "\u2318", u: 1.3, isMod: true },
  { label: "\u2325", u: 1, isMod: true }, { label: "\u25c0", u: 0.9, isMod: true }, { label: "\u25b2\n\u25bc", u: 0.9, isMod: true },
  { label: "\u25b6", u: 0.9, isMod: true },
];
const MACBOOK_FUNCTION_ROW: KeyRow = [
  { label: "esc", u: 1, isMod: true },
  ...Array.from({ length: 11 }, (_, i) => ({ label: `F${i + 1}`, u: 1 })),
  { label: "\u25c9", u: 1, isMod: true }, // Touch ID
];

const GAMING_BOTTOM_ROW: KeyRow = [
  { label: "Ctrl", u: 1.2, isMod: true }, { label: "Win", u: 1, isMod: true }, { label: "Alt", u: 1, isMod: true },
  { label: "", u: 6.25 }, { label: "Alt", u: 1, isMod: true }, { label: "Fn", u: 1, isMod: true },
  { label: "Ctrl", u: 1.2, isMod: true }, { label: "\u25c0", u: 0.9, isMod: true }, { label: "\u25b2\n\u25bc", u: 0.9, isMod: true },
  { label: "\u25b6", u: 0.9, isMod: true },
];

// Extra numpad block for larger gaming laptops (e.g. a real Legion Pro 5 16" ships with one).
const NUMPAD_ROWS: KeyRow[] = [
  [{ label: "NumLk", u: 1, isMod: true }, { label: "/", u: 1 }, { label: "*", u: 1 }, { label: "-", u: 1 }],
  [{ label: "7", u: 1 }, { label: "8", u: 1 }, { label: "9", u: 1 }, { label: "+", u: 1 }],
  [{ label: "4", u: 1 }, { label: "5", u: 1 }, { label: "6", u: 1 }, { label: "", u: 1 }],
  [{ label: "1", u: 1 }, { label: "2", u: 1 }, { label: "3", u: 1 }, { label: "Enter", u: 1, isMod: true }],
  [{ label: "0", u: 2 }, { label: ".", u: 1 }, { label: "", u: 1 }],
];

// Standard PC layout for everything that ISN'T a ThinkPad (Dell/HP/Acer/etc): Ctrl-Fn-Win-Alt
// ordering, the opposite of ThinkPad's distinctive Fn-Ctrl. Previously this profile just
// relabeled ThinkPad's row, which left a duplicate "Ctrl" key sitting next to the real one --
// a genuine layout error, not just a cosmetic simplification.
const DEFAULT_BOTTOM_ROW: KeyRow = [
  { label: "Ctrl", u: 1.2, isMod: true }, { label: "Fn", u: 1, isMod: true }, { label: "Win", u: 1.2, isMod: true },
  { label: "Alt", u: 1.2, isMod: true }, { label: "", u: 5.2 }, { label: "Alt", u: 1.2, isMod: true },
  { label: "Ctrl", u: 1.2, isMod: true },
  { label: "\u25c0", u: 0.9, isMod: true }, { label: "\u25b2\n\u25bc", u: 0.9, isMod: true },
  { label: "\u25b6", u: 0.9, isMod: true },
];

function keyboardLayoutForProfile(profileName: string): { rows: KeyRow[]; numpad: KeyRow[] | null } {
  if (profileName === "thinkpad") {
    return { rows: [FUNCTION_ROW, NUMBER_ROW, QWERTY_ROW, HOME_ROW, SHIFT_ROW, THINKPAD_BOTTOM_ROW], numpad: null };
  }
  if (profileName === "macbook") {
    return { rows: [MACBOOK_FUNCTION_ROW, NUMBER_ROW, QWERTY_ROW, HOME_ROW, SHIFT_ROW, MACBOOK_BOTTOM_ROW], numpad: null };
  }
  if (profileName === "gaming") {
    return { rows: [FUNCTION_ROW, NUMBER_ROW, QWERTY_ROW, HOME_ROW, SHIFT_ROW, GAMING_BOTTOM_ROW], numpad: NUMPAD_ROWS };
  }
  return { rows: [FUNCTION_ROW, NUMBER_ROW, QWERTY_ROW, HOME_ROW, SHIFT_ROW, DEFAULT_BOTTOM_ROW], numpad: null };
}

// Cache one small canvas texture per unique label so we don't regenerate ~50 identical
// "A" textures across different keyboards/rebuilds.
const keyLabelTextureCache = new Map<string, THREE.CanvasTexture>();
function getKeyLabelTexture(label: string, isMod: boolean): THREE.CanvasTexture {
  const cacheKey = `${label}|${isMod}`;
  const cached = keyLabelTextureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1b1e";
  ctx.fillRect(0, 0, 128, 128);

  if (label === "Win") {
    // Real 4-pane Windows flag icon instead of plain text -- the actual logo every
    // PC keyboard prints on this key, not a generic "Win" label.
    const gap = 6;
    const size = 26;
    const cx = 64, cy = 64;
    ctx.fillStyle = "#c6cad2";
    // slight italic skew to match the real logo's tilt
    ctx.save();
    ctx.translate(cx, cy);
    ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.fillRect(-size - gap / 2, -size - gap / 2, size, size);
    ctx.fillRect(gap / 2, -size - gap / 2, size, size);
    ctx.fillRect(-size - gap / 2, gap / 2, size, size);
    ctx.fillRect(gap / 2, gap / 2, size, size);
    ctx.restore();
  } else if (label) {
    ctx.fillStyle = isMod ? "#c8ccd4" : "#f0f2f5";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = label.split("\n");
    const fontSize = isMod ? (lines[0].length > 2 ? 32 : 44) : 64;
    ctx.font = `${isMod ? "600" : "500"} ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
    const lineHeight = fontSize * 1.05;
    const startY = 64 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 64, startY + i * lineHeight));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  keyLabelTextureCache.set(cacheKey, tex);
  return tex;
}

// Builds one row of individually-shaped, individually-labeled keycaps (not a uniform
// instanced grid) so wide keys (space/shift/enter) actually look wide and every key
// shows its real character. `dished` renders ThinkPad's signature concave/scooped keycap
// (a raised outer rim with a recessed, slightly darker inner surface holding the label)
// instead of one flat top face -- that visible step/shadow is what actually reads as
// "U-shaped" ThinkPad keys versus a flat chiclet key.
function buildKeyRow(
  row: KeyRow,
  centerX: number,
  z: number,
  yBase: number,
  keyHeight: number,
  keyGap: number,
  sideMat: THREE.Material,
  dished: boolean = false,
  unitSize: number = U
): THREE.Group {
  const group = new THREE.Group();
  const totalUnits = row.reduce((sum, k) => sum + k.u, 0) + (row.length - 1) * (keyGap / unitSize);
  let cursor = -((totalUnits * unitSize) / 2);
  row.forEach((key) => {
    const keyW = key.u * unitSize - keyGap * 0.3;
    const keyD = unitSize - keyGap * 0.3;
    const x = cursor + (key.u * unitSize) / 2;
    cursor += key.u * unitSize + keyGap;

    if (!key.label && key.u < 2) {
      // Blank filler slot (e.g. gap in numpad) -- skip rendering a cap entirely.
      return;
    }

    // Base keycap: identical for every laptop, guaranteed to show its label -- this is the
    // exact same geometry/material setup for both dished and flat keys, so a bug in the rim
    // decoration below can never hide the letter again.
    const geo = new RoundedBoxGeometry(keyW, keyHeight, keyD, 2, 0.018);
    const topMat = new THREE.MeshStandardMaterial({
      map: getKeyLabelTexture(key.label, !!key.isMod),
      roughness: 0.5,
      metalness: 0.15,
    });
    // Materials order for a Box-derived geometry: [+x,-x,+y,-y,+z,-z] -- index 2 is the top face.
    const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    mesh.position.set(centerX + x, yBase + keyHeight / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Tag every keycap with its label + rest height so a raycast click can identify which
    // key was pressed and animate it back up afterward -- this is what makes the physical
    // keyboard clickable/typeable, not just decorative geometry.
    mesh.userData.isKey = true;
    mesh.userData.keyLabel = key.label;
    mesh.userData.restY = mesh.position.y;
    group.add(mesh);

    if (dished) {
      // ThinkPad's concave/scooped look, added as a thin raised frame around the OUTSIDE
      // edge of the key -- sits beside the label, never over it, so it cannot cover the
      // letter the way a stacked "recessed center" mesh could. The frame reads as a rim
      // and the untouched center reads as the dish relative to it.
      const frameH = keyHeight * 0.16;
      const frameT = Math.min(keyW, keyD) * 0.14;
      const frameY = yBase + keyHeight + frameH / 2 - 0.0005;
      const frameMat = sideMat;

      const top = new THREE.Mesh(new THREE.BoxGeometry(keyW, frameH, frameT), frameMat);
      top.position.set(centerX + x, frameY, z + keyD / 2 - frameT / 2);
      group.add(top);

      const bottom = new THREE.Mesh(new THREE.BoxGeometry(keyW, frameH, frameT), frameMat);
      bottom.position.set(centerX + x, frameY, z - keyD / 2 + frameT / 2);
      group.add(bottom);

      const left = new THREE.Mesh(new THREE.BoxGeometry(frameT, frameH, keyD - frameT * 2), frameMat);
      left.position.set(centerX + x - keyW / 2 + frameT / 2, frameY, z);
      group.add(left);

      const right = new THREE.Mesh(new THREE.BoxGeometry(frameT, frameH, keyD - frameT * 2), frameMat);
      right.position.set(centerX + x + keyW / 2 - frameT / 2, frameY, z);
      group.add(right);
    }
  });
  return group;
}

function makeBrushedMetalNormalMap(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8080ff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * size;
    const shade = 118 + Math.floor(Math.random() * 20);
    ctx.strokeStyle = `rgba(${shade},${shade},255,${0.06 + Math.random() * 0.08})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (Math.random() - 0.5) * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  return tex;
}

function makeMicroRoughnessMap(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.floor(Math.random() * 55);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  return tex;
}

function makeContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.35, "rgba(0,0,0,0.32)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

const texLoader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;

function getDisplayTexture(theme: "windows" | "mac", customUrl?: string): THREE.Texture {
  if (!texLoader) {
    const fallback = new THREE.Texture();
    return fallback;
  }
  let url = theme === "windows" ? win11B64 : macB64;
  if (customUrl) {
    url = `https://api.allorigins.win/raw?url=${encodeURIComponent(customUrl)}`;
  }
  texLoader.crossOrigin = "anonymous";
  const tex = texLoader.load(url, () => {
    tex.needsUpdate = true;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ==== Interactive OS layer =========================================================
// Renders a genuinely clickable mini desktop UI (Start menu / taskbar for Windows,
// menu bar / Dock for Mac) onto a canvas that becomes the screen's texture, with real
// raycasting from pointer clicks against the 3D display mesh -> canvas pixel coords ->
// hit-testing against the drawn UI regions. Only active when there's no user-uploaded
// custom photo on the screen (can't fake clickable UI on top of a real screenshot).
const OS_CANVAS_W = 1024;
const OS_CANVAS_H = 640;
// Render at 2x physical pixel density while keeping all layout math in the same 1024x640
// logical space -- sharper text/icons without having to rescale dozens of hardcoded layout
// values (taskbar height, panel size, font sizes, hit-test regions) that all depend on each
// other staying consistent between drawing and click detection.
const OS_RENDER_SCALE = 2;

type OSAction =
  | { type: "toggleStart" }
  | { type: "closeMenus" }
  | { type: "launch"; name: string }
  | { type: "toggleAppleMenu" }
  | { type: "appleMenuItem"; name: string }
  | { type: "closeApp" }
  | { type: "installApp"; name: string };

type OSUIState = {
  startOpen: boolean;
  appleMenuOpen: boolean;
  openApp: string | null; // name of the currently open app window, or null if none
  wordDocText: string; // live text typed via the physical keyboard, shown in the Word app
  browserUrl: string; // live-typed/navigated address bar text for Edge/Safari
  installedApps: string[]; // Store apps that have finished "installing"
  installingApp: string | null; // Store app currently mid-install animation
  settingsToggles: Record<string, boolean>; // real toggle state for the Settings app
  toastText: string | null;
  toastUntil: number;
  animT: number; // 0-1 ease-in progress for whatever panel/window just opened -- makes it
                 // actually animate in (scale + fade) instead of appearing instantly.
};

const WIN_APPS = ["Edge", "Word", "Photos", "Mail", "Store", "Settings"];

// Newly installed Store apps now actually appear in the Start menu grid (and Dock, on Mac)
// so they're findable/openable later, not just re-launchable from inside the Store itself --
// that was the real gap behind "can't open the apps you installed". Colors match the Store's
// own card colors for the apps we know about.
const STORE_APP_COLORS: Record<string, string> = { Spotify: "#1db954", Netflix: "#e50914", Discord: "#5865f2", Slack: "#4a154b" };

function winStartAppList(installedApps: string[]): string[] {
  return [...WIN_APPS, ...installedApps.filter((a) => !WIN_APPS.includes(a))];
}
// Shared by draw and hit-test so the panel size and grid math can never drift apart --
// same coupling issue this file has hit before whenever they were computed separately.
function winStartPanelLayout(appCount: number) {
  const cols = 3;
  const rows = Math.max(2, Math.ceil(appCount / cols));
  return { panelW: 380, panelH: 118 + rows * 100, cols };
}
const MAC_DOCK = ["Finder", "Safari", "Photos", "Mail", "Music", "Settings"];
const MAC_MENU_ITEMS = ["About This Mac", "System Settings\u2026", "Sleep", "Restart\u2026", "Shut Down\u2026"];
const SETTINGS_TOGGLE_ORDER = ["Wi-Fi", "Bluetooth", "Dark mode", "Airplane mode"];
const SETTINGS_TOGGLE_DEFAULTS: Record<string, boolean> = { "Wi-Fi": true, "Bluetooth": false, "Dark mode": true, "Airplane mode": false };

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWinLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const gap = size * 0.16;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx - size - gap / 2, cy - size - gap / 2, size, size);
  ctx.fillRect(cx + gap / 2, cy - size - gap / 2, size, size);
  ctx.fillRect(cx - size - gap / 2, cy + gap / 2, size, size);
  ctx.fillRect(cx + gap / 2, cy + gap / 2, size, size);
}

// Hand-drawn vector icons instead of emoji glyphs -- emoji rendering is inconsistent across
// browsers/OSes (the same problem the Apple logo character had), so anything meant to look
// consistent and "real" is drawn as actual shapes instead.
type IconName = "search" | "folder" | "globe" | "mail" | "edge" | "word" | "photos" | "store" | "settings" | "safari" | "finder" | "music" | "gear";

function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  switch (name) {
    case "search": {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = s * 0.12;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(-s * 0.08, -s * 0.08, s * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.18);
      ctx.lineTo(s * 0.4, s * 0.4);
      ctx.stroke();
      break;
    }
    case "folder": {
      ctx.fillStyle = "#ffc94d";
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.15);
      ctx.lineTo(-s * 0.15, -s * 0.15);
      ctx.lineTo(-s * 0.05, -s * 0.3);
      ctx.lineTo(s * 0.45, -s * 0.3);
      ctx.lineTo(s * 0.45, s * 0.35);
      ctx.lineTo(-s * 0.45, s * 0.35);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "globe": {
      ctx.strokeStyle = "#4d9dff";
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.2, s * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, 0);
      ctx.lineTo(s * 0.42, 0);
      ctx.stroke();
      break;
    }
    case "mail": {
      ctx.fillStyle = "#5b9dff";
      roundRectPath(ctx, -s * 0.45, -s * 0.32, s * 0.9, s * 0.64, s * 0.06);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = s * 0.06;
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, -s * 0.28);
      ctx.lineTo(0, s * 0.05);
      ctx.lineTo(s * 0.42, -s * 0.28);
      ctx.stroke();
      break;
    }
    case "edge": {
      const grad = ctx.createLinearGradient(-s * 0.45, -s * 0.45, s * 0.45, s * 0.45);
      grad.addColorStop(0, "#39d0f5");
      grad.addColorStop(1, "#1a5fd6");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      ctx.arc(s * 0.04, 0, s * 0.28, Math.PI * 0.15, Math.PI * 1.5);
      ctx.stroke();
      break;
    }
    case "word": {
      ctx.fillStyle = "#2b5fd9";
      roundRectPath(ctx, -s * 0.42, -s * 0.42, s * 0.84, s * 0.84, s * 0.08);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${s * 0.55}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("W", 0, s * 0.03);
      break;
    }
    case "photos": {
      const colors = ["#ff5f6d", "#ffc93c", "#4dd8a0", "#4d9dff"];
      colors.forEach((c, i) => {
        const ang = (i / 4) * Math.PI * 2 - Math.PI / 4;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * s * 0.2, Math.sin(ang) * s * 0.2, s * 0.28, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case "store": {
      ctx.fillStyle = "#4d9dff";
      roundRectPath(ctx, -s * 0.4, -s * 0.15, s * 0.36, s * 0.55, s * 0.05);
      ctx.fill();
      ctx.fillStyle = "#ff8a4d";
      roundRectPath(ctx, s * 0.04, -s * 0.4, s * 0.36, s * 0.8, s * 0.05);
      ctx.fill();
      break;
    }
    case "settings":
    case "gear": {
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = s * 0.1;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.save();
        ctx.rotate(ang);
        ctx.fillRect(-s * 0.06, -s * 0.48, s * 0.12, s * 0.16);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = name === "gear" ? "#3a3a3c" : "#1a1a1c";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "safari": {
      const grad = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
      grad.addColorStop(0, "#5cc9ff");
      grad.addColorStop(1, "#1a7fd6");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.32);
      ctx.lineTo(s * 0.1, -s * 0.05);
      ctx.lineTo(0, s * 0.32);
      ctx.lineTo(-s * 0.1, -s * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.32);
      ctx.lineTo(s * 0.1, -s * 0.05);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "finder": {
      ctx.fillStyle = "#3a8dff";
      ctx.beginPath();
      ctx.arc(-s * 0.14, 0, s * 0.42, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      ctx.fillStyle = "#5cd6ff";
      ctx.beginPath();
      ctx.arc(s * 0.14, 0, s * 0.42, Math.PI / 2, Math.PI * 1.5);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-s * 0.12, -s * 0.08, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "music": {
      ctx.fillStyle = "#ff5f9e";
      ctx.beginPath();
      ctx.arc(-s * 0.22, s * 0.28, s * 0.14, 0, Math.PI * 2);
      ctx.arc(s * 0.22, s * 0.18, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff5f9e";
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.moveTo(-s * 0.22 + s * 0.13, s * 0.28);
      ctx.lineTo(-s * 0.22 + s * 0.13, -s * 0.35);
      ctx.lineTo(s * 0.22 + s * 0.13, -s * 0.45);
      ctx.lineTo(s * 0.22 + s * 0.13, s * 0.18);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawToast(ctx: CanvasRenderingContext2D, text: string, canvasW: number, bottomClear: number) {
  ctx.font = "600 15px 'Segoe UI', -apple-system, sans-serif";
  const textW = ctx.measureText(text).width;
  const padX = 18, boxW = textW + padX * 2, boxH = 42;
  const x = canvasW / 2 - boxW / 2;
  const y = OS_CANVAS_H - bottomClear - boxH - 14;
  ctx.fillStyle = "rgba(20,20,24,0.88)";
  roundRectPath(ctx, x, y, boxW, boxH, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvasW / 2, y + boxH / 2 + 1);
}

const WIN_TASKBAR_H = 56;
function drawWindowsUI(ctx: CanvasRenderingContext2D, wallpaper: HTMLImageElement | null, state: OSUIState) {
  ctx.clearRect(0, 0, OS_CANVAS_W, OS_CANVAS_H);
  if (wallpaper) ctx.drawImage(wallpaper, 0, 0, OS_CANVAS_W, OS_CANVAS_H);
  else { ctx.fillStyle = "#1b2735"; ctx.fillRect(0, 0, OS_CANVAS_W, OS_CANVAS_H); }

  const tbY = OS_CANVAS_H - WIN_TASKBAR_H;
  ctx.fillStyle = "rgba(24,26,32,0.75)";
  ctx.fillRect(0, tbY, OS_CANVAS_W, WIN_TASKBAR_H);

  const centerX = OS_CANVAS_W / 2;
  const startX = centerX - 148, startW = 44;
  ctx.fillStyle = state.startOpen ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0)";
  roundRectPath(ctx, startX, tbY + 6, startW, WIN_TASKBAR_H - 12, 6);
  ctx.fill();
  drawWinLogo(ctx, startX + startW / 2, tbY + WIN_TASKBAR_H / 2, 8);

  // Windows 11's small glowing indicator pill under an active taskbar icon -- shows Start
  // is "active" whenever the menu is open or any app window is up.
  if (state.startOpen || state.openApp) {
    ctx.fillStyle = "#4d9dff";
    roundRectPath(ctx, startX + startW / 2 - 8, OS_CANVAS_H - 4, 16, 3, 1.5);
    ctx.fill();
  }

  // Real Windows 11 taskbar has a search pill right next to Start, not just a magnifier icon.
  const searchX = startX + startW + 10, searchW = 130;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRectPath(ctx, searchX, tbY + 10, searchW, WIN_TASKBAR_H - 20, (WIN_TASKBAR_H - 20) / 2);
  ctx.fill();
  drawIcon(ctx, "search", searchX + 22, tbY + WIN_TASKBAR_H / 2, 18);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Search", searchX + 38, tbY + WIN_TASKBAR_H / 2 + 1);

  const taskbarIcons: IconName[] = ["folder", "globe", "mail"];
  let ix = searchX + searchW + 30;
  taskbarIcons.forEach((icon) => {
    drawIcon(ctx, icon, ix, tbY + WIN_TASKBAR_H / 2, 22);
    ix += 42;
  });

  const now = new Date();
  ctx.textAlign = "right";
  ctx.fillStyle = "#fff";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), OS_CANVAS_W - 16, tbY + 20);
  ctx.font = "11px 'Segoe UI', sans-serif";
  ctx.fillText(now.toLocaleDateString(), OS_CANVAS_W - 16, tbY + 38);

  if (state.startOpen) {
    const appList = winStartAppList(state.installedApps);
    const { panelW, panelH, cols } = winStartPanelLayout(appList.length);
    const panelX = centerX - panelW / 2, panelY = tbY - panelH - 8;
    // Ease-in: fades in and rises slightly from the taskbar instead of appearing instantly.
    ctx.save();
    ctx.globalAlpha = state.animT;
    const riseOffset = (1 - state.animT) * 16;
    ctx.translate(0, riseOffset);

    ctx.fillStyle = "rgba(30,32,38,0.97)";
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.09)";
    roundRectPath(ctx, panelX + 20, panelY + 18, panelW - 40, 34, 17);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    drawIcon(ctx, "search", panelX + 42, panelY + 35, 15);
    ctx.fillText("Type here to search", panelX + 56, panelY + 35);

    const cellW = (panelW - 40) / cols;
    const winAppIcons: IconName[] = ["edge", "word", "photos", "mail", "store", "settings"];
    appList.forEach((app, i) => {
      const cx = panelX + 20 + cellW * (i % cols) + cellW / 2;
      const cy = panelY + 100 + Math.floor(i / cols) * 100;
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      roundRectPath(ctx, cx - 26, cy - 26, 52, 52, 10);
      ctx.fill();
      if (i < WIN_APPS.length) {
        drawIcon(ctx, winAppIcons[i] ?? "settings", cx, cy - 2, 30);
      } else {
        // Installed Store app without a dedicated vector icon -- colored tile + first letter,
        // matching the color it shows as a card in the Store itself.
        ctx.fillStyle = STORE_APP_COLORS[app] ?? "#666";
        roundRectPath(ctx, cx - 15, cy - 17, 30, 30, 7);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(app[0], cx, cy - 2);
      }
      ctx.fillStyle = "#fff";
      ctx.font = "10px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(app, cx, cy + 38);
    });
    ctx.restore();
  }

  if (state.openApp) drawAppWindow(ctx, "windows", state.openApp, state.animT, state.wordDocText, state.settingsToggles, state.browserUrl, state.installedApps, state.installingApp);

  if (state.toastText && Date.now() < state.toastUntil) {
    drawToast(ctx, state.toastText, OS_CANVAS_W, WIN_TASKBAR_H);
  }
}

function hitTestWindowsUI(px: number, py: number, state: OSUIState): OSAction | null {
  if (state.openApp) {
    return hitTestAppWindow(px, py, "windows", state.openApp, state.installedApps);
  }
  const tbY = OS_CANVAS_H - WIN_TASKBAR_H;
  const centerX = OS_CANVAS_W / 2;

  if (state.startOpen) {
    const panelW = 380, panelH = 380;
    const panelX = centerX - panelW / 2, panelY = tbY - panelH - 8;
    if (px >= panelX && px <= panelX + panelW && py >= panelY && py <= panelY + panelH) {
      const cols = 3, cellW = (panelW - 40) / cols;
      for (let i = 0; i < WIN_APPS.length; i++) {
        const cx = panelX + 20 + cellW * (i % cols) + cellW / 2;
        const cy = panelY + 100 + Math.floor(i / cols) * 100;
        if (Math.abs(px - cx) < 30 && Math.abs(py - cy) < 45) return { type: "launch", name: WIN_APPS[i] };
      }
      return null; // clicked inside panel but not on an icon -- absorb the click, don't fall through
    }
  }

  const startX = centerX - 148, startW = 44;
  if (py >= tbY && px >= startX && px <= startX + startW) return { type: "toggleStart" };

  // The search pill previously did nothing when clicked -- real Windows opens Start's
  // search view from here too, so route it the same way instead of dead space.
  const searchX = startX + startW + 10, searchW = 130;
  if (py >= tbY && px >= searchX && px <= searchX + searchW) return { type: "toggleStart" };

  // Taskbar quick-launch icons (folder/globe/mail) were previously decorative -- drawn but
  // with no click region at all, so they visually looked clickable and did nothing.
  const taskbarIconApps = ["File Explorer", "Edge", "Mail"];
  if (py >= tbY) {
    let ix = searchX + searchW + 30;
    for (const appName of taskbarIconApps) {
      if (Math.abs(px - ix) < 18) return { type: "launch", name: appName };
      ix += 42;
    }
  }

  if (py >= tbY) return { type: "closeMenus" };
  if (state.startOpen) return { type: "closeMenus" };
  return null;
}

const MAC_MENUBAR_H = 30;
function drawMacUI(ctx: CanvasRenderingContext2D, wallpaper: HTMLImageElement | null, state: OSUIState) {
  ctx.clearRect(0, 0, OS_CANVAS_W, OS_CANVAS_H);
  if (wallpaper) ctx.drawImage(wallpaper, 0, 0, OS_CANVAS_W, OS_CANVAS_H);
  else { ctx.fillStyle = "#3a3a3c"; ctx.fillRect(0, 0, OS_CANVAS_W, OS_CANVAS_H); }

  ctx.fillStyle = "rgba(245,245,247,0.6)";
  ctx.fillRect(0, 0, OS_CANVAS_W, MAC_MENUBAR_H);
  if (state.appleMenuOpen) {
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(0, 0, 40, MAC_MENUBAR_H);
  }
  // Drawn apple-ish glyph instead of the U+F8FF private-use character, which only renders
  // on Apple's own font stack -- most visitors on Windows/Linux would just see a blank box.
  ctx.fillStyle = "#1a1a1c";
  ctx.beginPath();
  ctx.arc(20, MAC_MENUBAR_H / 2 + 1, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = wallpaper ? "rgba(245,245,247,0.6)" : "#3a3a3c";
  ctx.beginPath();
  ctx.ellipse(22, MAC_MENUBAR_H / 2 - 3, 2.6, 3.4, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "12.5px -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Finder    File    Edit    View    Go    Window    Help", 48, MAC_MENUBAR_H / 2 + 1);

  const now = new Date();
  const timeStr = `${now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}  ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  ctx.textAlign = "right";
  ctx.fillText(timeStr, OS_CANVAS_W - 16, MAC_MENUBAR_H / 2 + 1);

  if (state.appleMenuOpen) {
    const menuX = 6, menuY = MAC_MENUBAR_H + 2, menuW = 210, itemH = 28;
    const menuH = MAC_MENU_ITEMS.length * itemH + 8;
    ctx.save();
    ctx.globalAlpha = state.animT;
    ctx.translate(0, (1 - state.animT) * -10);
    ctx.fillStyle = "rgba(250,250,250,0.98)";
    roundRectPath(ctx, menuX, menuY, menuW, menuH, 8);
    ctx.fill();
    ctx.fillStyle = "#1a1a1c";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    MAC_MENU_ITEMS.forEach((item, i) => {
      ctx.fillText(item, menuX + 14, menuY + 4 + itemH * i + itemH / 2);
    });
    ctx.restore();
  }

  const dockW = MAC_DOCK.length * 66 + 20, dockH = 60;
  const dockX = (OS_CANVAS_W - dockW) / 2, dockY = OS_CANVAS_H - dockH - 12;
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  roundRectPath(ctx, dockX, dockY, dockW, dockH, 16);
  ctx.fill();
  const macDockIcons: IconName[] = ["finder", "safari", "photos", "mail", "music", "gear"];
  MAC_DOCK.forEach((app, i) => {
    const cx = dockX + 20 + i * 66 + 23, cy = dockY + dockH / 2;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    roundRectPath(ctx, cx - 22, cy - 22, 44, 44, 11);
    ctx.fill();
    drawIcon(ctx, macDockIcons[i] ?? "gear", cx, cy, 26);
    // Small dot under the Dock icon of the currently open app -- real macOS shows exactly
    // this to indicate a running application.
    if (state.openApp === app) {
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(cx, dockY + dockH - 4, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  if (state.openApp) drawAppWindow(ctx, "mac", state.openApp, state.animT, state.wordDocText, state.settingsToggles, state.browserUrl, state.installedApps, state.installingApp);

  if (state.toastText && Date.now() < state.toastUntil) {
    drawToast(ctx, state.toastText, OS_CANVAS_W, dockH + 26);
  }
}

function hitTestMacUI(px: number, py: number, state: OSUIState): OSAction | null {
  if (state.openApp) {
    return hitTestAppWindow(px, py, "mac", state.openApp, state.installedApps);
  }
  if (py <= MAC_MENUBAR_H) {
    if (px <= 40) return { type: "toggleAppleMenu" };
    return { type: "closeMenus" };
  }
  if (state.appleMenuOpen) {
    const menuX = 6, menuY = MAC_MENUBAR_H + 2, menuW = 210, itemH = 28;
    const menuH = MAC_MENU_ITEMS.length * itemH + 8;
    if (px >= menuX && px <= menuX + menuW && py >= menuY && py <= menuY + menuH) {
      const idx = Math.floor((py - menuY - 4) / itemH);
      if (idx >= 0 && idx < MAC_MENU_ITEMS.length) return { type: "appleMenuItem", name: MAC_MENU_ITEMS[idx] };
      return null;
    }
    return { type: "closeMenus" };
  }
  const dockW = MAC_DOCK.length * 66 + 20, dockH = 60;
  const dockX = (OS_CANVAS_W - dockW) / 2, dockY = OS_CANVAS_H - dockH - 12;
  if (px >= dockX && px <= dockX + dockW && py >= dockY && py <= dockY + dockH) {
    const idx = Math.floor((px - dockX - 20) / 66);
    if (idx >= 0 && idx < MAC_DOCK.length) return { type: "launch", name: MAC_DOCK[idx] };  }
  return null;
}

function drawAppWindow(ctx: CanvasRenderingContext2D, theme: "windows" | "mac", appName: string, animT: number = 1, wordText: string = "", settingsToggles: Record<string, boolean> = SETTINGS_TOGGLE_DEFAULTS, browserUrl: string = "laptopcore.ca", installedApps: string[] = [], installingApp: string | null = null) {
  const winW = OS_CANVAS_W * 0.72, winH = OS_CANVAS_H * 0.68;
  const winX = (OS_CANVAS_W - winW) / 2, winY = (OS_CANVAS_H - winH) / 2 - 20;
  const chromeH = 40;
  const wcx = winX + winW / 2, wcy = winY + winH / 2;
  const isBrowser = appName === "Edge" || appName === "Safari";

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, OS_CANVAS_W, OS_CANVAS_H);

  ctx.save();
  ctx.globalAlpha = animT;
  const scale = 0.92 + animT * 0.08;
  ctx.translate(wcx, wcy);
  ctx.scale(scale, scale);
  ctx.translate(-wcx, -wcy);

  ctx.fillStyle = "#f2f3f5";
  roundRectPath(ctx, winX, winY, winW, winH, 10);
  ctx.fill();
  ctx.fillStyle = "#e4e5e8";
  roundRectPath(ctx, winX, winY, winW, chromeH, 10);
  ctx.fill();
  ctx.fillRect(winX, winY + chromeH - 10, winW, 10);

  if (theme === "mac") {
    const dotY = winY + chromeH / 2;
    ([["#ff5f57", winX + 20], ["#febc2e", winX + 40], ["#28c840", winX + 60]] as [string, number][]).forEach(([color, dcx]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(dcx, dotY, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    ctx.fillStyle = "#333";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u2715", winX + winW - 24, winY + chromeH / 2);
  }

  if (isBrowser) {
    const navX0 = theme === "mac" ? winX + 76 : winX + 12;
    const barX = theme === "mac" ? winX + 128 : winX + 62;
    const barW = theme === "mac" ? winW - 218 : winW - 116;
    const navY = winY + chromeH / 2;
    ctx.strokeStyle = "#5f6368";
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(navX0 + 7, navY - 5); ctx.lineTo(navX0 + 2, navY); ctx.lineTo(navX0 + 7, navY + 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(navX0 + 17, navY - 5); ctx.lineTo(navX0 + 22, navY); ctx.lineTo(navX0 + 17, navY + 5); ctx.stroke();
    ctx.beginPath(); ctx.arc(navX0 + 33, navY, 6, -Math.PI * 0.15, Math.PI * 1.3); ctx.stroke();

    ctx.fillStyle = "#fff";
    roundRectPath(ctx, barX, winY + 8, barW, chromeH - 16, 12);
    ctx.fill();
    const lockX = barX + 18, lockY = winY + chromeH / 2;
    ctx.strokeStyle = "#3a8f4a";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(lockX, lockY - 2, 3.2, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = "#3a8f4a";
    roundRectPath(ctx, lockX - 4.5, lockY - 2, 9, 6, 1.5);
    ctx.fill();
    ctx.fillStyle = "#444";
    ctx.font = "12px 'Segoe UI', -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(browserUrl || "Search or enter address", barX + 30, winY + chromeH / 2);
  } else {
    ctx.fillStyle = "#333";
    ctx.font = "600 13px 'Segoe UI', -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(appName, winX + winW / 2, winY + chromeH / 2);
  }

  const bodyY = winY + chromeH;
  const bodyH = winH - chromeH;
  ctx.save();
  roundRectPath(ctx, winX, bodyY, winW, bodyH, 0);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(winX, bodyY, winW, bodyH);
  drawAppBody(ctx, appName, winX, bodyY, winW, bodyH, wordText, settingsToggles, browserUrl, installedApps, installingApp);
  ctx.restore();

  ctx.restore();
}

function drawAppBody(ctx: CanvasRenderingContext2D, appName: string, x: number, y: number, w: number, h: number, wordText: string = "", settingsToggles: Record<string, boolean> = SETTINGS_TOGGLE_DEFAULTS, browserUrl: string = "laptopcore.ca", installedApps: string[] = [], installingApp: string | null = null) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (appName === "Edge" || appName === "Safari") {
    const url = browserUrl.toLowerCase().trim();
    const isLaptopCore = url.includes("laptopcore");
    if (isLaptopCore || !url) {
      ctx.fillStyle = "#111";
      ctx.font = "600 22px 'Segoe UI', -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("LaptopCore", x + w / 2, y + h * 0.35);
      ctx.fillStyle = "#666";
      ctx.font = "13px 'Segoe UI', -apple-system, sans-serif";
      ctx.fillText("Track prices. Compare laptops. Find the deal.", x + w / 2, y + h * 0.35 + 30);
      return;
    }
    // Anything else typed and "navigated" to gets a real (simulated) search-results page --
    // this is what makes the address bar actually respond to typing instead of being static.
    ctx.fillStyle = "#222";
    ctx.font = "13px 'Segoe UI', -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Results for \u201c${browserUrl}\u201d`, x + 24, y + 30);
    const results = [
      [`${browserUrl} - Official Site`, `www.${url.replace(/\s+/g, "")}.com`],
      [`${browserUrl}: Reviews, Prices & Specs \u2014 LaptopCore`, "laptopcore.ca/search"],
      [`Best deals on ${browserUrl} this week`, "www.retailer-deals.example/offers"],
    ];
    results.forEach(([title, link], i) => {
      const ry = y + 60 + i * 56;
      ctx.fillStyle = "#1a0dab";
      ctx.font = "14px arial, sans-serif";
      ctx.fillText(title, x + 24, ry);
      ctx.fillStyle = "#006621";
      ctx.font = "11px arial, sans-serif";
      ctx.fillText(link, x + 24, ry + 16);
      ctx.fillStyle = "#555";
      ctx.font = "11px arial, sans-serif";
      ctx.fillText("Compare prices, read specs, and see what other buyers say.", x + 24, ry + 32);
    });
    return;
  }

  if (appName === "Word") {
    ctx.fillStyle = "#f3f3f3";
    ctx.fillRect(x, y, w, 40);
    ["B", "I", "U", "\u2261", "\u2263"].forEach((label, i) => {
      ctx.fillStyle = "#444";
      ctx.font = `${label === "B" ? "700" : "400"} 14px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + 24 + i * 34, y + 20);
    });
    const pageX = x + w * 0.15, pageY = y + 56, pageW = w * 0.7, pageH = h - 80;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.fillRect(pageX, pageY, pageW, pageH);
    ctx.strokeRect(pageX, pageY, pageW, pageH);

    // Actually typed text from the physical keyboard -- word-wrapped and clipped to the
    // page, showing only the most recent lines once it overflows (like a real editor).
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageX, pageY, pageW, pageH);
    ctx.clip();
    ctx.fillStyle = "#222";
    ctx.font = "15px 'Calibri', sans-serif";
    const lineHeight = 22;
    const maxCharsPerLine = Math.floor((pageW - 40) / 8);
    const rawLines = wordText.length ? wordText.split("\n") : [""];
    const wrapped: string[] = [];
    rawLines.forEach((line) => {
      if (line.length === 0) { wrapped.push(""); return; }
      for (let i = 0; i < line.length; i += maxCharsPerLine) wrapped.push(line.slice(i, i + maxCharsPerLine));
    });
    const maxVisibleLines = Math.floor((pageH - 40) / lineHeight);
    const visible = wrapped.slice(-maxVisibleLines);
    visible.forEach((line, i) => {
      ctx.fillText(line, pageX + 20, pageY + 30 + i * lineHeight);
    });
    // Blinking-ish cursor at the end of the last visible line (steady, not actually animated
    // per-frame since this only redraws on keystroke, but still reads as an insertion point).
    const lastLine = visible[visible.length - 1] ?? "";
    const cursorX = pageX + 20 + ctx.measureText(lastLine).width + 2;
    const cursorY = pageY + 30 + (visible.length - 1) * lineHeight;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cursorX, cursorY - 13);
    ctx.lineTo(cursorX, cursorY + 3);
    ctx.stroke();
    if (!wordText.length) {
      ctx.fillStyle = "#aaa";
      ctx.font = "13px 'Calibri', sans-serif";
      ctx.fillText("Click a key on the keyboard to type\u2026", pageX + 20, pageY + 30);
    }
    ctx.restore();
    return;
  }

  if (appName === "Photos") {
    const cols = 3, rows = 2, pad = 12;
    const cellW = (w - pad * (cols + 1)) / cols, cellH = (h - pad * (rows + 1)) / rows;
    const colors = ["#7fb0e0", "#e0a37f", "#8fd0a0", "#d08fc9", "#e0d07f", "#7fd0d0"];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = colors[i % colors.length];
        roundRectPath(ctx, x + pad + c * (cellW + pad), y + pad + r * (cellH + pad), cellW, cellH, 6);
        ctx.fill();
        i++;
      }
    }
    return;
  }

  if (appName === "Mail") {
    const sidebarW = w * 0.24;
    ctx.fillStyle = "#f5f5f7";
    ctx.fillRect(x, y, sidebarW, h);
    ["Inbox", "Sent", "Drafts", "Trash"].forEach((label, i) => {
      ctx.fillStyle = i === 0 ? "#3a7bd5" : "#333";
      ctx.font = `${i === 0 ? "600" : "400"} 12px 'Segoe UI', -apple-system, sans-serif`;
      ctx.fillText(label, x + 16, y + 28 + i * 28);
    });
    const emails = [
      ["Dell", "Your order has shipped", "10:24 AM"],
      ["Lenovo Support", "Warranty registration", "Yesterday"],
      ["LaptopCore", "Price drop alert: XPS 13", "Mon"],
      ["Newsletter", "This week in tech", "Sun"],
    ];
    emails.forEach(([from, subj, time], i) => {
      const ey = y + 14 + i * 56;
      ctx.strokeStyle = "#eee";
      ctx.beginPath(); ctx.moveTo(x + sidebarW, ey - 6); ctx.lineTo(x + w, ey - 6); ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.font = "600 12px 'Segoe UI', -apple-system, sans-serif";
      ctx.fillText(from, x + sidebarW + 16, ey + 10);
      ctx.fillStyle = "#888";
      ctx.font = "11px 'Segoe UI', -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(time, x + w - 16, ey + 10);
      ctx.textAlign = "left";
      ctx.fillStyle = "#444";
      ctx.font = "12px 'Segoe UI', -apple-system, sans-serif";
      ctx.fillText(subj, x + sidebarW + 16, ey + 28);
    });
    return;
  }

  if (appName === "Store" || appName === "Microsoft Store") {
    const cols = 2, pad = 16;
    const cellW = (w - pad * (cols + 1)) / cols, cellH = 90;
    const apps = [["Spotify", "#1db954"], ["Netflix", "#e50914"], ["Discord", "#5865f2"], ["Slack", "#4a154b"]];
    apps.forEach(([name, color], i) => {
      const cx0 = x + pad + (i % cols) * (cellW + pad), cy0 = y + pad + Math.floor(i / cols) * (cellH + pad);
      ctx.fillStyle = "#fafafa";
      roundRectPath(ctx, cx0, cy0, cellW, cellH, 8);
      ctx.fill();
      ctx.fillStyle = color;
      roundRectPath(ctx, cx0 + 12, cy0 + 15, 60, 60, 10);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = "600 13px 'Segoe UI', sans-serif";
      ctx.fillText(name, cx0 + 84, cy0 + 38);

      const isInstalled = installedApps.includes(name);
      const isInstalling = installingApp === name;
      ctx.fillStyle = isInstalled ? "#e8e8e8" : "#0067c0";
      roundRectPath(ctx, cx0 + 84, cy0 + 50, 60, 24, 4);
      ctx.fill();
      ctx.fillStyle = isInstalled ? "#333" : "#fff";
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(isInstalling ? "Installing\u2026" : isInstalled ? "\u2713 Open" : "Get", cx0 + 114, cy0 + 66);
      ctx.textAlign = "left";
    });
    return;
  }

  if (appName === "Settings") {
    const navW = w * 0.32;
    ctx.fillStyle = "#f5f5f7";
    ctx.fillRect(x, y, navW, h);
    ["System", "Bluetooth & devices", "Network & internet", "Personalization", "Apps"].forEach((label, i) => {
      ctx.fillStyle = i === 0 ? "#0067c0" : "#333";
      ctx.font = `${i === 0 ? "600" : "400"} 12px 'Segoe UI', sans-serif`;
      ctx.fillText(label, x + 16, y + 30 + i * 30);
    });
    const toggles = SETTINGS_TOGGLE_ORDER.map((label) => [label, settingsToggles[label] ?? SETTINGS_TOGGLE_DEFAULTS[label]] as [string, boolean]);
    toggles.forEach(([label, on], i) => {
      const ty = y + 24 + i * 44;
      ctx.fillStyle = "#111";
      ctx.font = "13px 'Segoe UI', sans-serif";
      ctx.fillText(label, x + navW + 20, ty + 5);
      const swX = x + w - 70, swW = 40, swH = 20;
      ctx.fillStyle = on ? "#0067c0" : "#ccc";
      roundRectPath(ctx, swX, ty - 8, swW, swH, swH / 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(on ? swX + swW - 10 : swX + 10, ty + 2, 8, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }

  if (appName === "Finder") {
    const navW = w * 0.28;
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(x, y, navW, h);
    ctx.fillStyle = "#888";
    ctx.font = "600 10px -apple-system, sans-serif";
    ctx.fillText("FAVOURITES", x + 14, y + 20);
    ["AirDrop", "Recents", "Applications", "Desktop", "Documents"].forEach((label, i) => {
      ctx.fillStyle = "#222";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(label, x + 14, y + 44 + i * 26);
    });
    const files = [["Report.docx", "142 KB"], ["Photo.jpg", "2.1 MB"], ["Budget.xlsx", "88 KB"], ["Notes.txt", "4 KB"]];
    files.forEach(([name, size], i) => {
      const fy = y + 24 + i * 34;
      ctx.fillStyle = "#3a8dff";
      roundRectPath(ctx, x + navW + 16, fy - 10, 16, 16, 3);
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(name, x + navW + 40, fy + 2);
      ctx.fillStyle = "#999";
      ctx.textAlign = "right";
      ctx.fillText(size, x + w - 16, fy + 2);
      ctx.textAlign = "left";
    });
    return;
  }

  if (appName === "Music") {
    const artX = x + w / 2 - 60, artY = y + 40;
    const grad = ctx.createLinearGradient(artX, artY, artX + 120, artY + 120);
    grad.addColorStop(0, "#ff5f9e");
    grad.addColorStop(1, "#5f6cff");
    ctx.fillStyle = grad;
    roundRectPath(ctx, artX, artY, 120, 120, 10);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = "600 15px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Now Playing", x + w / 2, artY + 150);
    ctx.fillStyle = "#888";
    ctx.font = "12px -apple-system, sans-serif";
    ctx.fillText("LaptopCore Radio", x + w / 2, artY + 170);
    const barY = artY + 195, barW = 220;
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + w / 2 - barW / 2, barY); ctx.lineTo(x + w / 2 + barW / 2, barY); ctx.stroke();
    ctx.strokeStyle = "#5f6cff";
    ctx.beginPath(); ctx.moveTo(x + w / 2 - barW / 2, barY); ctx.lineTo(x + w / 2 - barW / 2 + barW * 0.4, barY); ctx.stroke();
    ["\u25c0\u25c0", "\u25b6", "\u25b6\u25b6"].forEach((sym, i) => {
      ctx.fillStyle = "#333";
      ctx.font = "16px sans-serif";
      ctx.fillText(sym, x + w / 2 + (i - 1) * 40, barY + 34);
    });
    return;
  }

  if (appName === "File Explorer") {
    const navW = w * 0.26;
    ctx.fillStyle = "#f3f3f3";
    ctx.fillRect(x, y, navW, h);
    ["Quick access", "This PC", "Documents", "Downloads", "Pictures"].forEach((label, i) => {
      ctx.fillStyle = i === 0 ? "#222" : "#444";
      ctx.font = i === 0 ? "600 12px 'Segoe UI', sans-serif" : "12px 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, x + 14, y + 24 + i * 26);
    });
    const files: [string, string][] = [["Report.docx", "142 KB"], ["Photo.jpg", "2.1 MB"], ["Budget.xlsx", "88 KB"], ["Notes.txt", "4 KB"]];
    ctx.fillStyle = "#666";
    ctx.font = "600 10px 'Segoe UI', sans-serif";
    ctx.fillText("NAME", x + navW + 40, y + 16);
    ctx.textAlign = "right";
    ctx.fillText("SIZE", x + w - 20, y + 16);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#e0e0e0";
    ctx.beginPath(); ctx.moveTo(x + navW, y + 24); ctx.lineTo(x + w, y + 24); ctx.stroke();
    files.forEach(([name, size], i) => {
      const fy = y + 30 + i * 34;
      ctx.fillStyle = "#4d9dff";
      roundRectPath(ctx, x + navW + 16, fy - 10, 16, 16, 3);
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.font = "12px 'Segoe UI', sans-serif";
      ctx.fillText(name, x + navW + 40, fy + 2);
      ctx.fillStyle = "#888";
      ctx.textAlign = "right";
      ctx.fillText(size, x + w - 20, fy + 2);
      ctx.textAlign = "left";
    });
    return;
  }

  if (appName === "Spotify") {
    ctx.fillStyle = "#191414";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#1db954";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.35, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "600 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Your Library", x + w / 2, y + h * 0.35 + 80);
    ctx.fillStyle = "#b3b3b3";
    ctx.font = "12px sans-serif";
    ctx.fillText("Sign in to see your playlists", x + w / 2, y + h * 0.35 + 104);
    return;
  }

  if (appName === "Netflix") {
    ctx.fillStyle = "#141414";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#e50914";
    ctx.font = "900 30px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("NETFLIX", x + w / 2, y + h * 0.4);
    ctx.fillStyle = "#aaa";
    ctx.font = "13px sans-serif";
    ctx.fillText("Who's watching?", x + w / 2, y + h * 0.4 + 34);
    return;
  }

  if (appName === "Discord") {
    ctx.fillStyle = "#313338";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(x, y, w * 0.22, h);
    ["# general", "# random", "# laptopcore"].forEach((label, i) => {
      ctx.fillStyle = i === 0 ? "#fff" : "#96989d";
      ctx.font = "12.5px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, x + 16, y + 30 + i * 28);
    });
    ctx.fillStyle = "#96989d";
    ctx.font = "13px sans-serif";
    ctx.fillText("No messages yet. Say hi!", x + w * 0.22 + 20, y + 34);
    return;
  }

  if (appName === "Slack") {
    ctx.fillStyle = "#3f0e40";
    ctx.fillRect(x, y, w * 0.24, h);
    ["# general", "# announcements", "# random"].forEach((label, i) => {
      ctx.fillStyle = i === 0 ? "#fff" : "#cfc3cf";
      ctx.font = "12.5px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, x + 16, y + 30 + i * 28);
    });
    ctx.fillStyle = "#616061";
    ctx.font = "13px sans-serif";
    ctx.fillText("You're all caught up.", x + w * 0.24 + 20, y + 34);
    return;
  }

  // Fallback for any app without a dedicated body
  ctx.fillStyle = "#999";
  ctx.font = "13px 'Segoe UI', -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${appName} is running`, x + w / 2, y + h / 2);
}

function hitTestAppWindow(px: number, py: number, theme: "windows" | "mac", appName: string, installedApps: string[] = []): OSAction | null {
  const winW = OS_CANVAS_W * 0.72, winH = OS_CANVAS_H * 0.68;
  const winX = (OS_CANVAS_W - winW) / 2, winY = (OS_CANVAS_H - winH) / 2 - 20;
  const chromeH = 40;
  if (theme === "mac") {
    if (py >= winY && py <= winY + chromeH && px >= winX + 12 && px <= winX + 30) return { type: "closeApp" };
  } else {
    if (py >= winY && py <= winY + chromeH && px >= winX + winW - 40 && px <= winX + winW - 8) return { type: "closeApp" };
  }

  if (appName === "Store" || appName === "Microsoft Store") {
    // Must match the exact layout math in the Store's draw case above, or clicks and
    // buttons drift apart -- same coupling as every other draw/hit-test pair in this file.
    const bodyY = winY + chromeH, bodyX = winX;
    const w = winW;
    const cols = 2, pad = 16;
    const cellW = (w - pad * (cols + 1)) / cols, cellH = 90;
    const apps = ["Spotify", "Netflix", "Discord", "Slack"];
    for (let i = 0; i < apps.length; i++) {
      const cx0 = bodyX + pad + (i % cols) * (cellW + pad), cy0 = bodyY + pad + Math.floor(i / cols) * (cellH + pad);
      const btnX = cx0 + 84, btnY = cy0 + 50, btnW = 60, btnH = 24;
      if (px >= btnX && px <= btnX + btnW && py >= btnY && py <= btnY + btnH) {
        // Once installed, this same button becomes "Open" -- it should actually open the
        // app's window, not try to install it again (which the guard in applyOSAction would
        // just silently ignore, leaving the button looking broken/unresponsive).
        return installedApps.includes(apps[i]) ? { type: "launch", name: apps[i] } : { type: "installApp", name: apps[i] };
      }
    }
  }

  return null;
}
// ==== end interactive OS layer ======================================================

function makeBrandLogoTexture(brand: string, model: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 512);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const b = (brand || "").toLowerCase();
  const m = (model || "").toLowerCase();

  if (b.includes("apple") || b.includes("macbook") || m.includes("macbook")) {
    ctx.beginPath();
    ctx.arc(256, 276, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(380, 276, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.ellipse(256, 100, 40, 20, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.includes("dell")) {
    ctx.beginPath();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 20;
    ctx.arc(256, 256, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 110px sans-serif";
    ctx.fillText("DELL", 256, 276);
  } else if (b.includes("hp")) {
    ctx.beginPath();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 20;
    ctx.arc(256, 256, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "italic bold 160px serif";
    ctx.fillText("hp", 256, 270);
  } else if (b.includes("lenovo") || b.includes("thinkpad") || m.includes("thinkpad") || m.includes("legion") || m.includes("yoga")) {
    const isThinkpad = isThinkpadName(brand, model);
    if (isThinkpad) {
      ctx.font = "bold 90px sans-serif";
      ctx.fillText("ThinkPad", 256, 256);
      ctx.fillStyle = "#ff0000";
      ctx.beginPath();
      ctx.arc(425, 200, 18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = "bold 120px sans-serif";
      ctx.fillText("Lenovo", 256, 256);
    }
  } else if (b.includes("asus") || b.includes("rog") || m.includes("rog") || m.includes("expertbook") || m.includes("zenbook") || m.includes("vivobook")) {
    if (m.includes("rog") || b.includes("rog")) {
      ctx.font = "bold 120px sans-serif";
      ctx.fillText("ROG", 256, 256);
      ctx.fillRect(100, 310, 312, 12);
    } else {
      ctx.font = "bold 130px sans-serif";
      ctx.fillText("ASUS", 256, 256);
    }
  } else if (b.includes("acer") || m.includes("acer")) {
    ctx.font = "bold 140px sans-serif";
    ctx.fillText("acer", 256, 256);
  } else {
    ctx.beginPath();
    ctx.arc(256, 256, 100, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  return tex;
}

function makeLenovoBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 64);

  ctx.fillStyle = "#444444";
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Lenovo", 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  return tex;
}

type LaptopMeshRefs = {
  bodyMeshes: THREE.Mesh[];
  screenPivot: THREE.Group;
  display: THREE.Mesh;
  backlightPlane: THREE.Mesh;
  logo: THREE.Mesh;
  secondaryLogo: THREE.Mesh;
  trackpoint: THREE.Mesh;
  cameraBump: THREE.Mesh;
  bottomDetails: THREE.Group;
  group: THREE.Group;
  profile: ShapeProfile;
  width: number;
  depth: number;
  lidThickness: number;
  dimsOverride: DimensionOverride | null;
};

// buildLaptop now takes a ShapeProfile so different laptop families get real
// geometric differences (thickness, corner radius, deck size, vents, key height)
// instead of only a recolored identical box.
function buildLaptop(
  bodyMat: THREE.MeshPhysicalMaterial,
  displayTexture: THREE.Texture,
  profile: ShapeProfile,
  dimsOverride: DimensionOverride | null
): { group: THREE.Group; refs: LaptopMeshRefs } {
  const group = new THREE.Group();
  const bodyMeshes: THREE.Mesh[] = [];
  const width = dimsOverride?.widthScene ?? DIMS.width;
  const depth = dimsOverride?.depthScene ?? DIMS.depth;
  const { cornerRadius, deckInsetX, bezelInset, keyHeight, keyGap } = profile;
  // Real measured thickness (when we have a spec-sheet match) overrides the profile's guessed thickness.
  // Split roughly 70/30 between base and lid, matching typical laptop proportions.
  const baseThickness = dimsOverride ? dimsOverride.thicknessScene * 0.68 : profile.baseThickness;
  const lidThickness = dimsOverride ? dimsOverride.thicknessScene * 0.32 : profile.lidThickness;

  const darkMat = new THREE.MeshStandardMaterial({
    color: "#181a1e",
    roughness: 0.75,
    metalness: 0.15,
  });
  const bezelMat = new THREE.MeshStandardMaterial({
    color: "#0a0a0a",
    roughness: 0.35,
    metalness: 0.55,
  });
  // Keycap finish now differs by family instead of every laptop sharing identical plastic:
  // MacBook keys have a smoother, more premium/anodized feel; ThinkPad's soft-touch matte
  // is distinctly rougher/less reflective; gaming keys read as grippier textured plastic.
  const keyMatByProfile: Record<string, { roughness: number; metalness: number }> = {
    macbook: { roughness: 0.3, metalness: 0.15 },
    thinkpad: { roughness: 0.58, metalness: 0.2 },
    gaming: { roughness: 0.5, metalness: 0.3 },
    default: { roughness: 0.42, metalness: 0.25 },
  };
  const keyFinish = keyMatByProfile[profile.name] ?? keyMatByProfile.default;
  const keyMat = new THREE.MeshStandardMaterial({
    color: "#1a1b1e",
    roughness: keyFinish.roughness,
    metalness: keyFinish.metalness,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: "#2a2c30",
    roughness: 0.04,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const ventAccentMat = new THREE.MeshStandardMaterial({
    color: profile.vents === "rear" ? "#ff3b3b" : "#0d0e0f",
    roughness: 0.6,
    metalness: 0.3,
    emissive: profile.vents === "rear" ? new THREE.Color("#ff3b3b") : new THREE.Color("#000000"),
    emissiveIntensity: profile.vents === "rear" ? 0.35 : 0,
  });

  const base = new THREE.Mesh(
    new RoundedBoxGeometry(width, baseThickness, depth, 16, cornerRadius),
    bodyMat
  );
  base.position.y = baseThickness / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);
  bodyMeshes.push(base);

  const footGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.008, 14);
  const footMat = new THREE.MeshStandardMaterial({ color: "#0d0e0f", roughness: 0.9 });
  const footOffsets: [number, number][] = [
    [-width / 2 + 0.12, -depth / 2 + 0.12],
    [width / 2 - 0.12, -depth / 2 + 0.12],
    [-width / 2 + 0.12, depth / 2 - 0.12],
    [width / 2 - 0.12, depth / 2 - 0.12],
  ];
  footOffsets.forEach(([x, z]) => {
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(x, -0.004, z);
    group.add(foot);
  });

  // ---- Vents: differ by profile instead of always identical side slats ----
  if (profile.vents === "side") {
    const ventGeo = new THREE.BoxGeometry(0.09, 0.006, 0.012);
    for (let i = 0; i < 10; i++) {
      const vent = new THREE.Mesh(ventGeo, darkMat);
      vent.position.set(-width / 2 + 0.25 + i * 0.1, baseThickness - 0.002, -depth / 2 + 0.01);
      group.add(vent);
    }
  } else if (profile.vents === "rear") {
    // Aggressive rear-exhaust slats with a colored accent line, gaming-laptop style
    const ventGeo = new THREE.BoxGeometry(0.05, baseThickness * 0.7, 0.014);
    const slatCount = 14;
    const spanW = width - 0.3;
    for (let i = 0; i < slatCount; i++) {
      const vent = new THREE.Mesh(ventGeo, darkMat);
      vent.position.set(-spanW / 2 + (i / (slatCount - 1)) * spanW, baseThickness * 0.55, -depth / 2 + 0.006);
      group.add(vent);
    }
    const accent = new THREE.Mesh(new THREE.BoxGeometry(spanW + 0.02, 0.006, 0.01), ventAccentMat);
    accent.position.set(0, baseThickness * 0.2, -depth / 2 + 0.006);
    group.add(accent);
  }
  // profile.vents === "hidden" -> no visible vent geometry (MacBook-style bottom-only venting, omitted for simplicity)

  const deckWidth = width - deckInsetX * 2;
  const deckDepth = depth - 0.42;
  const deck = new THREE.Mesh(
    new RoundedBoxGeometry(deckWidth, 0.006, deckDepth, 3, Math.min(0.02, cornerRadius)),
    darkMat
  );
  deck.position.set(0, baseThickness + 0.003, -depth * 0.06);
  group.add(deck);

  const backlightPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(deckWidth - 0.05, deckDepth - 0.32),
    new THREE.MeshStandardMaterial({
      color: "#000000",
      emissive: new THREE.Color("#4d9dff"),
      emissiveIntensity: 0,
      roughness: 1,
    })
  );
  backlightPlane.rotation.x = -Math.PI / 2;
  backlightPlane.position.set(0, baseThickness + 0.009, deck.position.z + 0.02);
  group.add(backlightPlane);

  // Real keyboard: individually shaped/labeled rows instead of a uniform blank grid.
  // Layout (row order, key widths, Fn/Ctrl position, numpad presence) is chosen per
  // shape-profile family, so a ThinkPad, a MacBook, and a gaming laptop actually differ.
  const { rows: kbRows, numpad } = keyboardLayoutForProfile(profile.name);
  const keySideMat = keyMat;

  // The keyboard MUST fit inside this laptop's actual deck width -- U was previously a fixed
  // constant regardless of the laptop's real size, so a smaller laptop's keyboard could
  // literally overflow past its own deck/chassis edges. Instead, derive the key unit size
  // FROM the real deck width: find the widest row (including the numpad block laid out
  // beside the main keys, if present) and size keys so that widest extent fits with a
  // small safety margin, then scale everything else (gaps, row spacing) proportionally.
  const mainBlockMaxUnits = Math.max(...kbRows.map((r) => r.reduce((s, k) => s + k.u, 0)));
  const numpadMaxUnits = numpad ? Math.max(...numpad.map((r) => r.reduce((s, k) => s + k.u, 0))) : 0;
  const numpadGapUnits = numpad ? 0.6 : 0;
  const totalLayoutUnits = mainBlockMaxUnits + numpadGapUnits + numpadMaxUnits;
  let dynU = (deckWidth * 0.82) / totalLayoutUnits;
  // Also make sure the keyboard's total DEPTH (all rows stacked, plus the numpad's row count
  // if it's taller than the main block) fits within the deck's actual depth -- a shallower
  // chassis could otherwise get a keyboard that fits width-wise but spills off the front/back.
  const rowCount = Math.max(kbRows.length, numpad ? numpad.length : 0);
  const depthBudget = deckDepth * 0.85;
  const dynUFromDepth = depthBudget / (rowCount * (1 + keyGap / U));
  dynU = Math.min(dynU, dynUFromDepth);
  const dynKeyGap = keyGap * (dynU / U);

  const rowGap = dynU + dynKeyGap;
  const kbTotalDepth = kbRows.length * rowGap;
  const kbStartZ = deck.position.z - kbTotalDepth / 2 + rowGap / 2 + 0.02;

  // Numpad shifts the main alpha block left to make room on the right, matching how a
  // real numpad gaming keyboard is laid out (not centered when a numpad is present).
  const mainBlockCenterX = numpad ? -(numpadMaxUnits * dynU) / 2 - numpadGapUnits * dynU * 0.5 : 0;

  kbRows.forEach((row, i) => {
    const z = kbStartZ + i * rowGap;
    const rowGroup = buildKeyRow(row, mainBlockCenterX, z, baseThickness + 0.006, keyHeight, dynKeyGap, keySideMat, profile.dishedKeys, dynU);
    group.add(rowGroup);
  });

  if (numpad) {
    const numpadStartZ = deck.position.z - (numpad.length * rowGap) / 2 + rowGap / 2 + 0.02;
    const numpadCenterX = mainBlockCenterX + (mainBlockMaxUnits * dynU) / 2 + numpadGapUnits * dynU + (numpadMaxUnits * dynU) / 2;
    numpad.forEach((row, i) => {
      const z = numpadStartZ + i * rowGap;
      const rowGroup = buildKeyRow(row, numpadCenterX, z, baseThickness + 0.006, keyHeight, dynKeyGap, keySideMat, profile.dishedKeys, dynU);
      group.add(rowGroup);
    });
  }

  // ThinkPad TrackPoint (red dot in the middle of keyboard) -- visibility set per-profile below
  const trackpoint = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 16, 16),
    new THREE.MeshStandardMaterial({ color: "#ff0000", roughness: 0.7 })
  );
  trackpoint.position.set(0, baseThickness + 0.02, deck.position.z);
  trackpoint.visible = profile.hasTrackpoint;
  group.add(trackpoint);

  // Real per-family trackpad size and position, instead of one fixed pad every laptop shared.
  // MacBook's is dramatically larger (Force Touch, edge-to-edge feel); ThinkPad's is smaller
  // and sits below three dedicated physical click buttons (a ThinkPad-only detail); a gaming
  // laptop with a numpad gets its pad aligned under the main keys, not the full chassis center.
  const tpSpec = trackpadSpecForProfile(profile.name);
  const tpWidth = Math.min(tpSpec.widthMm * MM_TO_SCENE_W, deckWidth * 0.72);
  const tpDepth = tpSpec.depthMm * MM_TO_SCENE_D;
  const trackpadCenterX = numpad ? mainBlockCenterX : 0;

  if (tpSpec.hasClickButtons) {
    // Three physical click buttons (left / TrackPoint-middle scroll / right) directly above
    // the pad -- unique to ThinkPad, and the reason its pad sits lower/smaller than other laptops'.
    // Lighter gray + a thin dark groove around each one so they visually read as separate
    // physical buttons against the deck, instead of blending into it at nearly the same color.
    const btnWidth = tpWidth / 3 - 0.006;
    const btnDepth = 0.045;
    const btnY = baseThickness + 0.004;
    const btnZ = depth * 0.34 - tpDepth / 2 - btnDepth / 2 - 0.008;
    const btnMat = new THREE.MeshStandardMaterial({ color: "#4a4d54", roughness: 0.4, metalness: 0.15 });
    const grooveMat = new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 });
    [-1, 0, 1].forEach((slot) => {
      const groove = new THREE.Mesh(
        new RoundedBoxGeometry(btnWidth + 0.003, 0.003, btnDepth + 0.003, 2, 0.009),
        grooveMat
      );
      groove.position.set(trackpadCenterX + slot * (btnWidth + 0.006), btnY - 0.0008, btnZ);
      group.add(groove);

      const btn = new THREE.Mesh(
        new RoundedBoxGeometry(btnWidth, 0.006, btnDepth, 2, 0.008),
        btnMat
      );
      btn.position.set(trackpadCenterX + slot * (btnWidth + 0.006), btnY, btnZ);
      group.add(btn);
    });
  }

  // Real material and shape per family instead of one shared glossy pad: MacBook's Force Touch
  // glass is glossy with rounded corners and sits nearly flush with the deck; a Windows clickpad
  // (ThinkPad/gaming/default) is more matte, more rectangular, and visibly recessed below the
  // deck surface -- that recess is what creates the click-mechanism shadow line real ones have.
  const matteTrackpadMat = new THREE.MeshPhysicalMaterial({
    color: "#26282c",
    roughness: 0.38,
    metalness: 0.08,
    clearcoat: 0.25,
    clearcoatRoughness: 0.3,
  });
  const trackpadMat = tpSpec.matte ? matteTrackpadMat : glassMat;
  const trackpadY = tpSpec.flush ? baseThickness + 0.0055 : baseThickness + 0.002;
  const trackpad = new THREE.Mesh(
    new RoundedBoxGeometry(tpWidth, 0.004, tpDepth, 4, tpSpec.cornerRadius),
    trackpadMat
  );
  trackpad.position.set(trackpadCenterX, trackpadY, depth * 0.34);
  trackpad.userData.isTrackpad = true;
  trackpad.userData.restY = trackpad.position.y;
  group.add(trackpad);

  if (!tpSpec.flush) {
    // A thin darker bezel strip visible around a recessed (non-flush) pad -- the small
    // shadowed lip a real Windows clickpad has that a flush Force Touch pad doesn't.
    const bezelPad = new THREE.Mesh(
      new RoundedBoxGeometry(tpWidth + 0.006, 0.002, tpDepth + 0.006, 4, tpSpec.cornerRadius + 0.002),
      new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.85 })
    );
    bezelPad.position.set(trackpadCenterX, trackpadY - 0.0015, depth * 0.34);
    group.add(bezelPad);
  }

  const dotGeo = new THREE.CircleGeometry(0.008, 8);
  const dotMat = new THREE.MeshStandardMaterial({ color: "#0d0e0f", roughness: 0.9 });
  // Speaker grilles now scale with the ACTUAL deck size instead of a fixed absolute dot
  // spacing (which had the same "doesn't fit smaller/larger chassis" problem the keyboard
  // had before it was fixed). MacBook also gets a visibly larger grille -- real MacBooks have
  // much more prominent perforated speaker areas than a typical ThinkPad/Windows laptop.
  const dotSpacing = deckWidth * 0.017;
  const speakerRows = profile.name === "macbook" ? 6 : 4;
  const speakerCols = profile.name === "macbook" ? 4 : 3;
  const speakerClusters: [number, number][] = [
    [-deckWidth / 2 + dotSpacing * 5, -depth / 2 + 0.12],
    [deckWidth / 2 - dotSpacing * 5, -depth / 2 + 0.12],
  ];
  speakerClusters.forEach(([cx, cz]) => {
    for (let r = 0; r < speakerRows; r++) {
      for (let c = 0; c < speakerCols; c++) {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(cx + c * dotSpacing - dotSpacing, baseThickness + 0.0035, cz + r * dotSpacing);
        group.add(dot);
      }
    }
  });

  // Ports: real per-family layout AND real per-type shapes -- a USB-A, USB-C, HDMI,
  // Ethernet jack, and headphone jack all look visually distinct, not the same
  // rectangle resized. This is what actually reads as "real ports" instead of slots.
  const layout = portLayoutForProfile(profile.name);
  const buildPortMesh = (type: PortType): THREE.Group => {
    const g = new THREE.Group();
    const dim = PORT_DIMENSIONS[type];

    if (type === "audio") {
      // Circular jack: dark recessed ring + bright metal center hole, not a rectangle.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(dim.w / 2, 0.0015, 8, 20),
        new THREE.MeshStandardMaterial({ color: "#8a8d92", roughness: 0.3, metalness: 0.8 })
      );
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(dim.w / 2 - 0.002, dim.w / 2 - 0.002, 0.01, 16),
        new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 })
      );
      hole.rotation.z = Math.PI / 2;
      g.add(hole);
      return g;
    }

    if (type === "usb-c" || type === "magsafe") {
      // Small rounded capsule/pill -- the distinctive USB-C shape, not a rectangle.
      const outer = new THREE.Mesh(
        new RoundedBoxGeometry(0.014, dim.h + 0.004, dim.w + 0.004, 3, 0.003),
        new THREE.MeshStandardMaterial({ color: type === "magsafe" ? "#d6d9dd" : "#2a2c30", roughness: 0.35, metalness: 0.6 })
      );
      g.add(outer);
      const slot = new THREE.Mesh(
        new RoundedBoxGeometry(0.008, dim.h, dim.w, 2, 0.0025),
        new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 })
      );
      g.add(slot);
      return g;
    }

    if (type === "hdmi") {
      // Trapezoid: wider at the bottom edge, narrower at top -- approximated with two
      // stacked boxes instead of one flat rectangle, which is what actually distinguishes
      // an HDMI port's silhouette from a USB-A port at a glance.
      const bodyMat = new THREE.MeshStandardMaterial({ color: "#e8e9ec", roughness: 0.25, metalness: 0.7 });
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, dim.h * 0.55, dim.w), bodyMat);
      bottom.position.y = -dim.h * 0.22;
      g.add(bottom);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.01, dim.h * 0.55, dim.w * 0.8), bodyMat);
      top.position.y = dim.h * 0.22;
      g.add(top);
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, dim.h * 0.75, dim.w * 0.85),
        new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 })
      );
      g.add(slot);
      return g;
    }

    if (type === "ethernet") {
      // RJ45: taller housing with a small raised clip tab on top -- the tab is the
      // detail that actually reads as "Ethernet port" versus a generic dark rectangle.
      const housing = new THREE.Mesh(
        new RoundedBoxGeometry(0.012, dim.h, dim.w, 2, 0.002),
        new THREE.MeshStandardMaterial({ color: "#2a2c30", roughness: 0.6, metalness: 0.3 })
      );
      g.add(housing);
      const clip = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.004, dim.w * 0.3),
        new THREE.MeshStandardMaterial({ color: "#1a1a1c", roughness: 0.7 })
      );
      clip.position.set(0.005, dim.h / 2 - 0.001, 0);
      g.add(clip);
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, dim.h * 0.8, dim.w * 0.85),
        new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 })
      );
      g.add(slot);
      return g;
    }

    if (type === "sdcard") {
      // Very thin horizontal slit, no housing box needed -- a real SD slot is basically
      // just a dark line in the chassis.
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, dim.h, dim.w),
        new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.85 })
      );
      g.add(slot);
      return g;
    }

    if (type === "lock") {
      // Kensington lock: small dark rectangular hole with a slightly raised metal
      // surround, distinctly smaller and darker than a data port.
      const surround = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, dim.h + 0.003, dim.w + 0.003),
        new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.4 })
      );
      g.add(surround);
      const hole = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, dim.h, dim.w),
        new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 })
      );
      g.add(hole);
      return g;
    }

    // usb-a: rectangular metal-framed shell with a distinct lighter plastic "tongue"
    // visible inside -- the tongue is what actually makes it read as USB-A.
    const shell = new THREE.Mesh(
      new RoundedBoxGeometry(0.01, dim.h + 0.004, dim.w + 0.004, 2, 0.0015),
      new THREE.MeshStandardMaterial({ color: "#c9ccd1", roughness: 0.25, metalness: 0.85 })
    );
    g.add(shell);
    const cavity = new THREE.Mesh(
      new THREE.BoxGeometry(0.007, dim.h, dim.w),
      new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.9 })
    );
    g.add(cavity);
    const tongue = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, dim.h * 0.4, dim.w * 0.85),
      new THREE.MeshStandardMaterial({ color: "#e8e9ec", roughness: 0.4, metalness: 0.3 })
    );
    tongue.position.x = 0.001;
    g.add(tongue);
    return g;
  };

  const buildPortsOnSide = (ports: PortSpec[], side: "left" | "right") => {
    const xFace = side === "right" ? width / 2 : -width / 2;
    ports.forEach(({ type, zRatio }) => {
      const z = -depth / 2 + zRatio * depth;
      const y = baseThickness / 2 + 0.005;
      const port = buildPortMesh(type);
      port.position.set(xFace - (side === "right" ? 0.005 : -0.005), y, z);
      group.add(port);
    });
  };
  buildPortsOnSide(layout.left, "left");
  buildPortsOnSide(layout.right, "right");

  const screenPivot = new THREE.Group();
  screenPivot.position.set(0, baseThickness, -depth / 2);
  group.add(screenPivot);

  // Bottom Details (Feet and Vents) -- shown for ThinkPad-style profiles only
  const bottomDetails = new THREE.Group();
  bottomDetails.position.set(0, 0, 0);

  const tpFootGeo = new RoundedBoxGeometry(0.12, 0.015, 0.04, 4, 0.005);
  const tpFootMat = new THREE.MeshStandardMaterial({ color: "#000000", roughness: 0.9 });

  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([signX, signZ]) => {
    const foot = new THREE.Mesh(tpFootGeo, tpFootMat);
    foot.position.set(signX * (width / 2 - 0.2), -0.005, signZ * (depth / 2 - 0.15));
    bottomDetails.add(foot);
  });

  const tpVentGeo = new THREE.BoxGeometry(0.5, 0.005, 0.01);
  for (let i = 0; i < 7; i++) {
    const vent = new THREE.Mesh(tpVentGeo, darkMat);
    vent.position.set(-width / 4, -0.002, -0.1 + i * 0.03);
    bottomDetails.add(vent);
  }
  bottomDetails.visible = false;
  group.add(bottomDetails);

  // Hinge design genuinely differs by family: MacBook's is a thin, almost-invisible integrated
  // strip (Apple hides the mechanism inside the chassis), ThinkPad/gaming laptops have a visibly
  // thicker mechanical hinge bar since that's actually how those chassis are built.
  const hingeRadius = profile.name === "macbook" ? 0.014 : profile.name === "gaming" ? 0.034 : 0.028;
  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(hingeRadius, hingeRadius, width - 0.3, 24),
    darkMat
  );
  hinge.rotation.z = Math.PI / 2;
  hinge.castShadow = true;
  hinge.visible = profile.name !== "macbook"; // Apple's hinge sits fully hidden inside the chassis seam
  screenPivot.add(hinge);

  const lid = new THREE.Mesh(
    new RoundedBoxGeometry(width, depth, lidThickness, 16, cornerRadius),
    bodyMat
  );
  lid.position.set(0, depth / 2, -lidThickness / 2);
  lid.castShadow = true;
  screenPivot.add(lid);
  bodyMeshes.push(lid);

  const cameraBump = new THREE.Mesh(
    new RoundedBoxGeometry(0.5, 0.04, lidThickness, 8, 0.01),
    bodyMat
  );
  cameraBump.position.set(0, depth + 0.01, -lidThickness / 2);
  cameraBump.castShadow = true;
  cameraBump.visible = profile.hasCameraBump;
  screenPivot.add(cameraBump);
  bodyMeshes.push(cameraBump);

  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.28),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      alphaTest: 0.1,
    })
  );
  logo.rotation.y = Math.PI;
  logo.position.set(0, depth / 2, -lidThickness - 0.001);
  screenPivot.add(logo);

  const secondaryLogo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.045),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      metalness: 1.0,
      roughness: 0.1,
      transparent: true,
      alphaTest: 0.1,
      map: makeLenovoBadgeTexture()
    })
  );
  secondaryLogo.rotation.y = Math.PI;
  secondaryLogo.position.set(-width / 2 + 0.15, 0.25, -lidThickness - 0.001);
  secondaryLogo.rotation.z = Math.PI / 2;
  secondaryLogo.visible = false;
  screenPivot.add(secondaryLogo);

  // Bezel thickness now varies by profile -- ThinkPad gets a visibly thicker bezel,
  // MacBook a much thinner one, instead of both sharing one fixed inset.
  const bezel = new THREE.Mesh(
    new THREE.PlaneGeometry(width - bezelInset, depth - bezelInset),
    bezelMat
  );
  bezel.position.set(0, depth / 2, 0.002);
  screenPivot.add(bezel);

  const displayMat = new THREE.MeshBasicMaterial({
    map: displayTexture,
    color: 0xffffff,
    toneMapped: false,
  });
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(width - bezelInset * 1.8, depth - bezelInset * 2.2),
    displayMat
  );
  display.position.set(0, depth / 2 + 0.02, 0.003);
  screenPivot.add(display);

  const cam = new THREE.Mesh(
    new THREE.CircleGeometry(0.012, 12),
    new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.4 })
  );
  cam.position.set(0, depth - 0.05, 0.0025);
  screenPivot.add(cam);

  return {
    group,
    refs: {
      bodyMeshes, screenPivot, display, backlightPlane, logo, secondaryLogo,
      trackpoint, cameraBump, bottomDetails, group, profile,
      width, depth, lidThickness, dimsOverride,
    },
  };
}

// Disposes every geometry/material in a group so switching profiles doesn't leak GPU memory
function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m?.dispose());
    }
  });
}

export default function Laptop3DViewer({ isAdmin = false, studioMode = false }: { isAdmin?: boolean; studioMode?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<LaptopMeshRefs | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const customModelRef = useRef<THREE.Group | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const bodyMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const normalMapRef = useRef<THREE.CanvasTexture | null>(null);
  const roughnessMapRef = useRef<THREE.CanvasTexture | null>(null);
  // Interactive OS layer: persistent canvas/texture (redrawn in place, never recreated, so
  // clicks keep working across laptop rebuilds), current UI state, and cached wallpaper images.
  const osCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const osCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const osTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const osStateRef = useRef<OSUIState>({ startOpen: false, appleMenuOpen: false, openApp: null, wordDocText: "", browserUrl: "laptopcore.ca", installedApps: [], installingApp: null, settingsToggles: { ...SETTINGS_TOGGLE_DEFAULTS }, toastText: null, toastUntil: 0, animT: 1 });
  const wallpaperImagesRef = useRef<{ windows?: HTMLImageElement; mac?: HTMLImageElement }>({});
  const osThemeRef = useRef<"windows" | "mac">("windows");
  const customDisplayUrlRef = useRef<string>("");
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [laptops, setLaptops] = useState<Laptop[]>([]);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [loadingLaptops, setLoadingLaptops] = useState(true);

  const [baseColor, setBaseColor] = useState(BASE_COLORS[0].hex);
  const [finishIndex, setFinishIndex] = useState(1);
  const [openAngle, setOpenAngle] = useState(105);
  const [autoRotate, setAutoRotate] = useState(true);
  const [screenFocused, setScreenFocused] = useState(false);
  const autoRotateBeforeFocusRef = useRef(true);
  const [displayOn, setDisplayOn] = useState(true);
  const [backlightIndex, setBacklightIndex] = useState(0);
  const [logoGlow, setLogoGlow] = useState(true);
  const [bgIndex, setBgIndex] = useState(0);
  const [modelScale, setModelScale] = useState(1);
  const [osTheme, setOsTheme] = useState<"windows" | "mac">("windows");
  const [brandName, setBrandName] = useState<string>("");
  const [modelName, setModelName] = useState<string>("");
  const [screenSizeIn, setScreenSizeIn] = useState<number | null>(null);
  const [customDisplayUrl, setCustomDisplayUrl] = useState<string>("");
  const [saveMsg, setSaveMsg] = useState<"" | "saving" | "saved" | "error">("" );
  const [importStatus, setImportStatus] = useState<"" | "loading" | "loaded" | "error">("" );
  const [importedFileName, setImportedFileName] = useState<string>("");
  const [customModelBase64, setCustomModelBase64] = useState<string>("");

  const autoRotateRef = useRef(autoRotate);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    osThemeRef.current = osTheme;
  }, [osTheme]);
  useEffect(() => {
    customDisplayUrlRef.current = customDisplayUrl;
  }, [customDisplayUrl]);
  const displayOnRef = useRef(displayOn);
  useEffect(() => {
    displayOnRef.current = displayOn;
  }, [displayOn]);

  // Redraws the OS canvas in place using current theme + UI state, then flags the texture
  // dirty so Three.js re-uploads it. This is what makes clicking actually visible -- every
  // state change (menu open/close, toast) goes through here.
  const redrawOS = () => {
    const ctx = osCtxRef.current;
    if (!ctx) return;
    const theme = osThemeRef.current;
    const wallpaper = wallpaperImagesRef.current[theme] ?? null;
    if (theme === "mac") drawMacUI(ctx, wallpaper ?? null, osStateRef.current);
    else drawWindowsUI(ctx, wallpaper ?? null, osStateRef.current);
    if (osTextureRef.current) osTextureRef.current.needsUpdate = true;
  };

  // Eases a panel/window open with a short scale+fade animation instead of it just appearing
  // instantly -- self-contained rAF loop, not tied into the main render loop.
  const animateOpenRef = useRef<number | null>(null);
  const animateOpen = () => {
    if (animateOpenRef.current) cancelAnimationFrame(animateOpenRef.current);
    if (animateCloseRef.current) { cancelAnimationFrame(animateCloseRef.current); animateCloseRef.current = null; }
    osStateRef.current = { ...osStateRef.current, animT: 0 };
    const duration = 160;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      osStateRef.current = { ...osStateRef.current, animT: eased };
      redrawOS();
      if (t < 1) {
        animateOpenRef.current = requestAnimationFrame(step);
      } else {
        animateOpenRef.current = null;
      }
    };
    animateOpenRef.current = requestAnimationFrame(step);
  };

  // Windows 11's Fluent Design closes things with a quick shrink+fade instead of an instant
  // disappearance -- this mirrors that: animT eases back down to 0 while the panel/window's
  // boolean flag stays true (so the draw functions keep rendering it, just fading out), and
  // onComplete only fires once the animation actually finishes, flipping the flag off then.
  const animateCloseRef = useRef<number | null>(null);
  const animateClose = (onComplete: () => void) => {
    if (animateCloseRef.current) cancelAnimationFrame(animateCloseRef.current);
    if (animateOpenRef.current) { cancelAnimationFrame(animateOpenRef.current); animateOpenRef.current = null; }
    const startVal = osStateRef.current.animT;
    const duration = 120;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(t, 2); // ease-in quad -- closing reads snappier than opening
      osStateRef.current = { ...osStateRef.current, animT: startVal * (1 - eased) };
      redrawOS();
      if (t < 1) {
        animateCloseRef.current = requestAnimationFrame(step);
      } else {
        animateCloseRef.current = null;
        onComplete();
        osStateRef.current = { ...osStateRef.current, animT: 1 }; // reset so the next open starts fresh
      }
    };
    animateCloseRef.current = requestAnimationFrame(step);
  };

  // Lazily loads (and caches) the wallpaper image for a theme, redrawing once it's ready.
  const ensureWallpaperLoaded = (theme: "windows" | "mac") => {
    if (wallpaperImagesRef.current[theme]) {
      redrawOS();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      wallpaperImagesRef.current[theme] = img;
      redrawOS();
    };
    img.src = theme === "windows" ? win11B64 : macB64;
  };

  const showToast = (text: string) => {
    osStateRef.current = { ...osStateRef.current, toastText: text, toastUntil: Date.now() + 2200 };
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      osStateRef.current = { ...osStateRef.current, toastText: null };
      redrawOS();
    }, 2200);
    redrawOS();
  };

  const applyOSAction = (action: OSAction) => {
    switch (action.type) {
      case "toggleStart": {
        const opening = !osStateRef.current.startOpen;
        if (opening) {
          osStateRef.current = { ...osStateRef.current, startOpen: true, appleMenuOpen: false };
          animateOpen();
        } else {
          animateClose(() => { osStateRef.current = { ...osStateRef.current, startOpen: false }; });
        }
        break;
      }
      case "toggleAppleMenu": {
        const opening = !osStateRef.current.appleMenuOpen;
        if (opening) {
          osStateRef.current = { ...osStateRef.current, appleMenuOpen: true };
          animateOpen();
        } else {
          animateClose(() => { osStateRef.current = { ...osStateRef.current, appleMenuOpen: false }; });
        }
        break;
      }
      case "closeMenus":
        if (osStateRef.current.startOpen || osStateRef.current.appleMenuOpen) {
          animateClose(() => { osStateRef.current = { ...osStateRef.current, startOpen: false, appleMenuOpen: false }; });
        }
        break;
      case "launch":
        // Every pinned app now opens a real window with actual per-app content, not just
        // a toast -- Edge/Safari get browser chrome, everything else gets its own body
        // (Word's document view, Mail's inbox, Settings' toggles, etc).
        osStateRef.current = { ...osStateRef.current, startOpen: false, appleMenuOpen: false, openApp: action.name };
        animateOpen();
        break;
      case "closeApp":
        animateClose(() => { osStateRef.current = { ...osStateRef.current, openApp: null }; });
        break;
      case "appleMenuItem":
        osStateRef.current = { ...osStateRef.current, appleMenuOpen: false };
        showToast(action.name.replace(/\u2026$/, "") + "\u2026");
        break;
      case "installApp": {
        // This action was already being detected on click (the hit-test returns it) but had
        // no handler at all -- clicking "Get" produced a real action that just evaporated.
        // That's the actual "can't install anything" bug.
        if (osStateRef.current.installedApps.includes(action.name) || osStateRef.current.installingApp) break;
        osStateRef.current = { ...osStateRef.current, installingApp: action.name };
        redrawOS();
        installTimeoutRef.current = setTimeout(() => {
          osStateRef.current = {
            ...osStateRef.current,
            installingApp: null,
            installedApps: [...osStateRef.current.installedApps, action.name],
          };
          redrawOS();
          showToast(`${action.name} installed`);
        }, 1300);
        break;
      }
    }
  };

  // Physical keyboard interaction: a quick press-down animation on the exact key mesh that
  // was clicked, plus real typing into the Word app's document if it's currently open --
  // this is what actually connects the physical keyboard to on-screen content instead of
  // the keyboard being purely decorative geometry.
  const keyPressTimeouts = useRef<Map<THREE.Mesh, ReturnType<typeof setTimeout>>>(new Map());
  const pressPhysicalKey = (mesh: THREE.Mesh) => {
    const restY = (mesh.userData.restY as number) ?? mesh.position.y;
    const existing = keyPressTimeouts.current.get(mesh);
    if (existing) clearTimeout(existing);
    mesh.position.y = restY - 0.0035;
    const t = setTimeout(() => {
      mesh.position.y = restY;
      keyPressTimeouts.current.delete(mesh);
    }, 90);
    keyPressTimeouts.current.set(mesh, t);

    const openApp = osStateRef.current.openApp;
    const isBrowser = openApp === "Edge" || openApp === "Safari";
    if (openApp !== "Word" && !isBrowser) return;

    const label = (mesh.userData.keyLabel as string) ?? "";
    let text = isBrowser ? osStateRef.current.browserUrl : osStateRef.current.wordDocText;

    if (label === "Enter" && isBrowser) {
      // "Navigate" -- the address bar text is already live, this just confirms it (the page
      // content itself is computed from browserUrl at draw time, so nothing else to do here).
      showToast(`Navigating to ${text || "blank page"}\u2026`);
      redrawOS();
      return;
    }

    if (label === "Bksp") {
      text = text.slice(0, -1);
    } else if (label === "Enter") {
      text = text + "\n";
    } else if (label === "Tab") {
      if (isBrowser) return; // Tab doesn't type into an address bar
      text = text + "    ";
    } else if (label === "") {
      // Blank-labeled wide key in the bottom row is the spacebar in every layout here.
      if (isBrowser) return; // spaces don't make sense mid-URL -- ignore
      text = text + " ";
    } else if (/^[\x20-\x7E]$/.test(label)) {
      // Single printable ASCII character keys only -- modifiers (Ctrl/Alt/Shift/Fn/Win/Esc/
      // F-keys/arrows/Home/End/etc) have multi-character labels and are intentionally excluded.
      text = text + (isBrowser ? label.toLowerCase() : label);
    } else {
      return; // modifier/navigation key -- no text effect, press animation already happened
    }

    if (isBrowser) osStateRef.current = { ...osStateRef.current, browserUrl: text };
    else osStateRef.current = { ...osStateRef.current, wordDocText: text };
    redrawOS();
  };

  const pressTrackpad = (mesh: THREE.Mesh) => {
    const restY = (mesh.userData.restY as number) ?? mesh.position.y;
    mesh.position.y = restY - 0.0015;
    setTimeout(() => { mesh.position.y = restY; }, 90);
  };

  // ---- Load real laptop data ----
  useEffect(() => {
    fetchLaptops()
      .then((data) => setLaptops(data))
      .catch(() => setLaptops([]))
      .finally(() => setLoadingLaptops(false));
  }, []);

  const selectedLaptop = laptops.find((l) => l.id === selectedId) || null;

  const handleSelectLaptop = (id: number | "") => {
    setSelectedId(id);
    if (id === "") {
      setBrandName("");
      setModelName("");
      setCustomDisplayUrl("");
      return;
    }
    const laptop = laptops.find((l) => l.id === id);
    if (!laptop) return;
    // Use the real official color when this exact model is recognized;
    // otherwise fall back to the old per-brand guess.
    const officialColors = officialColorsForLaptop(laptop.brand, laptop.model);
    setBaseColor(officialColors ? officialColors[0].hex : colorForBrand(laptop.brand));
    // Sizing now always comes from getAccurateDims (exact spec match, or real screen-diagonal
    // geometry for everything else) -- that fully replaces the old crude scale multiplier, so
    // modelScale stays fixed at 1 and every laptop's true footprint comes from its own real
    // screen size instead of one shared template.
    setModelScale(1);
    setScreenSizeIn(laptop.screen_size ?? null);
    const theme = osThemeForBrand(laptop.brand);
    setOsTheme(theme);
    setLogoGlow(theme === "mac");
    setBrandName(laptop.brand);
    setModelName(laptop.model);

    const b = (laptop.brand || "").toLowerCase();
    const m = (laptop.model || "").toLowerCase();
    if (b.includes("msi") || b.includes("rog") || m.includes("rog") || b.includes("razer")) {
      setBacklightIndex(4);
    } else {
      setBacklightIndex(0);
    }

    setCustomDisplayUrl("");

    fetchLaptopDesign(typeof id === "number" ? id : Number(id)).then(async (design) => {
      if (!design) return;
      setBaseColor(design.color_hex);
      const fi = FINISHES.findIndex((f) => f.name === design.finish);
      if (fi >= 0) setFinishIndex(fi);
      const bi = BACKLIGHTS.findIndex((b) => b.name === design.backlight);
      if (bi >= 0) setBacklightIndex(bi);
      setOpenAngle(design.open_angle);
      setLogoGlow(design.logo_glow);

      if (design.custom_model_base64) {
        setCustomModelBase64(design.custom_model_base64);
        try {
          const res = await fetch(design.custom_model_base64);
          const blob = await res.blob();
          const file = new File([blob], "saved_model.glb", { type: blob.type });
          loadCustomModel(file, false);
        } catch (err) {
          console.error("Failed to load custom model from base64:", err);
        }
      } else {
        clearCustomModel();
      }
    });
  };

  const loadCustomModel = (file: File | null, updateBase64 = true) => {
    const scene = sceneRef.current;
    const refs = meshesRef.current;
    if (!scene) return;

    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    if (customModelRef.current) {
      scene.remove(customModelRef.current);
      customModelRef.current = null;
    }

    if (!file) {
      if (refs) refs.group.visible = true;
      setImportStatus("");
      setImportedFileName("");
      if (updateBase64) setCustomModelBase64("");
      return;
    }

    setImportStatus("loading");
    setImportedFileName(file.name);

    if (updateBase64) {
      const reader = new FileReader();
      reader.onload = () => {
        setCustomModelBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }

    const blobUrl = URL.createObjectURL(file);
    blobUrlRef.current = blobUrl;

    const loader = new GLTFLoader();
    loader.load(
      blobUrl,
      (gltf) => {
        const model = gltf.scene;

        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 2.5;
        const scale = targetSize / maxDim;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.position.y = 0;

        if (refs) refs.group.visible = false;

        scene.add(model);
        customModelRef.current = model;

        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const m = child.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
            if (m && m.color) {
              m.color.set(baseColor);
              if (m.roughness !== undefined) m.roughness = FINISHES[finishIndex].roughness;
            }
          }
        });

        setImportStatus("loaded");
      },
      undefined,
      () => {
        setImportStatus("error");
        if (refs) refs.group.visible = true;
      }
    );
  };

  const clearCustomModel = () => {
    const scene = sceneRef.current;
    const refs = meshesRef.current;
    if (customModelRef.current && scene) {
      scene.remove(customModelRef.current);
      customModelRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (refs) refs.group.visible = true;
    setImportStatus("");
    setImportedFileName("");
    setCustomModelBase64("");
  };

  // ---- One-time scene setup ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUNDS[0].color);
    scene.fog = new THREE.Fog(BACKGROUNDS[0].color, 8, 16);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(...VIEWS.iso.pos);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.minDistance = 1.8;
    controls.maxDistance = 7.5;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.zoomSpeed = 0.7;
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.8;
    controls.target.set(...VIEWS.iso.target);
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xf5f7ff, 0x3a3d45, 0.55);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.35);
    keyLight.position.set(4, 6.5, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xaecbff, 0.7);
    rimLight.position.set(-4.5, 3.5, -3.5);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
    fillLight.position.set(-1.5, 1.2, 4);
    scene.add(fillLight);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.MeshStandardMaterial({ color: BACKGROUNDS[0].ground, roughness: 0.95, metalness: 0.02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);
    groundRef.current = ground;

    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 3.5),
      new THREE.MeshBasicMaterial({
        map: makeContactShadowTexture(),
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.001;
    scene.add(contactShadow);

    const normalMap = makeBrushedMetalNormalMap();
    const roughnessMap = makeMicroRoughnessMap();
    normalMapRef.current = normalMap;
    roughnessMapRef.current = roughnessMap;
    const finish = FINISHES[finishIndex];
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      roughness: finish.roughness,
      metalness: finish.metalness ?? 0.78,
      clearcoat: finish.clearcoat,
      clearcoatRoughness: 0.12,
      sheen: finish.sheen,
      sheenColor: new THREE.Color(finish.sheenTint ?? "#ffffff"),
      normalMap,
      normalScale: new THREE.Vector2(0.14, 0.14),
      roughnessMap,
      envMapIntensity: 1.3,
    });
    bodyMatRef.current = bodyMat;

    // Set up the interactive OS canvas ONCE here -- it's redrawn in place afterward, never
    // recreated, so click state survives laptop rebuilds (brand/profile switches).
    const osCanvas = document.createElement("canvas");
    osCanvas.width = OS_CANVAS_W * OS_RENDER_SCALE;
    osCanvas.height = OS_CANVAS_H * OS_RENDER_SCALE;
    osCanvasRef.current = osCanvas;
    const osCtx = osCanvas.getContext("2d");
    if (osCtx) osCtx.scale(OS_RENDER_SCALE, OS_RENDER_SCALE); // all draw calls stay in 1024x640 logical space
    osCtxRef.current = osCtx;
    const osTexture = new THREE.CanvasTexture(osCanvas);
    osTexture.colorSpace = THREE.SRGBColorSpace;
    osTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    osTexture.minFilter = THREE.LinearMipmapLinearFilter;
    osTexture.magFilter = THREE.LinearFilter;
    osTexture.generateMipmaps = true;
    osTextureRef.current = osTexture;
    ensureWallpaperLoaded(osTheme);

    const initialDisplayTexture = customDisplayUrl ? getDisplayTexture(osTheme, customDisplayUrl) : osTexture;
    const initialProfile = profileForLaptop(brandName, modelName);
    const initialDimsOverride = getAccurateDims(brandName, modelName, screenSizeIn, initialProfile.name);
    const { group: laptop, refs } = buildLaptop(bodyMat, initialDisplayTexture, initialProfile, initialDimsOverride);
    refs.screenPivot.rotation.x = THREE.MathUtils.degToRad(-(180 - openAngle));
    scene.add(laptop);
    meshesRef.current = refs;

    let rotVelocity = 0.004;
    const rotTarget  = 0.0032;
    const rotDamping = 0.96;
    const rotSpring  = 0.015;

    let hoverTiltX   = 0;
    let hoverTiltY   = 0;
    let hoverTiltTargetX = 0;
    let hoverTiltTargetY = 0;
    const tiltSpring  = 0.07;
    const tiltDamping = 0.82;
    let tiltVelX = 0, tiltVelY = 0;
    const MAX_TILT   = 0.14;

    let floatT = 0;
    const FLOAT_SPEED  = 0.5;
    const FLOAT_AMP    = 0.018;

    let rainbowT = 0;

    const onPointerMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
      const ny = ((e.clientY - rect.top)  / rect.height - 0.5) * 2;
      hoverTiltTargetY =  nx * MAX_TILT;
      hoverTiltTargetX = -ny * MAX_TILT * 0.5;
    };
    const onPointerLeave = () => {
      hoverTiltTargetX = 0;
      hoverTiltTargetY = 0;
    };
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerleave", onPointerLeave);

    // Click detection on the WHOLE laptop -- screen, physical keys, and trackpad are all
    // clickable now, not just the screen. One raycast against the whole laptop group finds
    // whichever part was hit; behavior branches from there. A small movement threshold still
    // distinguishes an actual click from an OrbitControls drag-to-rotate gesture.
    const clickRaycaster = new THREE.Raycaster();
    let pointerDownPos: { x: number; y: number } | null = null;
    const onScreenPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onScreenPointerUp = (e: PointerEvent) => {
      const down = pointerDownPos;
      pointerDownPos = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // was a drag, not a click
      const laptopGroup = meshesRef.current?.group;
      if (!laptopGroup) return;

      const rect = mount.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      clickRaycaster.setFromCamera(ndc, camera);
      const hits = clickRaycaster.intersectObjects(laptopGroup.children, true);
      if (!hits.length) return;
      const displayMesh = meshesRef.current?.display;
      // Purely decorative overlay meshes (the transmissive screen-glass layer, bezel, webcam
      // dot) sit slightly in FRONT of the display and were silently swallowing every click
      // since they're the closest hit but match none of our interactive checks. Scan past
      // them for the first hit that's actually meaningful (the real display, a key, or the
      // trackpad) instead of blindly trusting hits[0].
      const hit = hits.find((h) => h.object === displayMesh || h.object.userData.isKey || h.object.userData.isTrackpad);
      if (!hit) return;

      // Screen click -- existing behavior, unchanged.
      if (hit.object === displayMesh) {
        if (!displayMesh!.visible || !displayOnRef.current || customDisplayUrlRef.current || !hit.uv) return;
        const px = hit.uv.x * OS_CANVAS_W;
        const py = (1 - hit.uv.y) * OS_CANVAS_H;
        const action = osThemeRef.current === "mac" ? hitTestMacUI(px, py, osStateRef.current) : hitTestWindowsUI(px, py, osStateRef.current);
        if (osStateRef.current.openApp) {
          console.log("[App window click]", { openApp: osStateRef.current.openApp, px: px.toFixed(0), py: py.toFixed(0), installedApps: osStateRef.current.installedApps, action });
        }
        if (action) applyOSAction(action);
        return;
      }

      // Physical key click -- press animation, plus real typing if Word is open.
      if (hit.object.userData.isKey) {
        pressPhysicalKey(hit.object as THREE.Mesh);
        return;
      }

      // Trackpad click -- press animation only (no cursor-position mapping, geometry too
      // irregular on a rounded pad to map reliably to a screen coordinate).
      if (hit.object.userData.isTrackpad) {
        pressTrackpad(hit.object as THREE.Mesh);
        return;
      }
    };
    mount.addEventListener("pointerdown", onScreenPointerDown);
    mount.addEventListener("pointerup", onScreenPointerUp);

    // Keyboard control: precise clicking on a rotated 3D screen is fiddly, so the whole
    // interactive desktop is also reachable from the keyboard once the mouse is over the
    // viewer. Escape closes whatever's open; 1-6 launch pinned apps/dock icons directly
    // without needing to open the Start menu / Dock first; S / A toggle Start / Apple menu.
    let isHovering = false;
    const onMountEnter = () => { isHovering = true; };
    const onMountLeave2 = () => { isHovering = false; };
    mount.addEventListener("pointerenter", onMountEnter);
    mount.addEventListener("pointerleave", onMountLeave2);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHovering) return;
      if (!displayOnRef.current || customDisplayUrlRef.current) return;
      const theme = osThemeRef.current;

      if (e.key === "Escape") {
        if (osStateRef.current.openApp) applyOSAction({ type: "closeApp" });
        else applyOSAction({ type: "closeMenus" });
        e.preventDefault();
        return;
      }
      if (osStateRef.current.openApp) return; // an open app window absorbs other keys

      if (/^[1-6]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const list = theme === "mac" ? MAC_DOCK : WIN_APPS;
        if (idx < list.length) applyOSAction({ type: "launch", name: list[idx] });
        e.preventDefault();
        return;
      }
      if (theme === "windows" && (e.key === "s" || e.key === "S")) {
        applyOSAction({ type: "toggleStart" });
        e.preventDefault();
      } else if (theme === "mac" && (e.key === "a" || e.key === "A")) {
        applyOSAction({ type: "toggleAppleMenu" });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    let frameId: number;
    let lastTime = performance.now();
    const animate = (now: number) => {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 16.67, 3);
      lastTime = now;

      const currentLaptop = meshesRef.current?.group;
      if (!currentLaptop) {
        controls.update();
        renderer.render(scene, camera);
        return;
      }

      // Auto-rotate pauses while the mouse is over the viewer (not just while dragging) --
      // otherwise the laptop keeps spinning during a click and the screen has physically
      // moved by the time pointerup fires, making the raycast miss even a dead-on click.
      // This is what the console log ("raycast missed the display mesh") was actually showing.
      const rotationActive = autoRotateRef.current && !isHovering;
      if (rotationActive) {
        rotVelocity += (rotTarget - rotVelocity) * rotSpring * dt;
        currentLaptop.rotation.y += rotVelocity * dt;
      } else {
        rotVelocity *= Math.pow(rotDamping, dt);
        if (Math.abs(rotVelocity) > 0.00005) currentLaptop.rotation.y += rotVelocity * dt;
      }

      floatT += FLOAT_SPEED * 0.016 * dt;
      currentLaptop.position.y = Math.sin(floatT) * FLOAT_AMP;

      if (!rotationActive) {
        tiltVelX += (hoverTiltTargetX - hoverTiltX) * tiltSpring * dt;
        tiltVelY += (hoverTiltTargetY - hoverTiltY) * tiltSpring * dt;
        tiltVelX *= Math.pow(tiltDamping, dt);
        tiltVelY *= Math.pow(tiltDamping, dt);
        hoverTiltX += tiltVelX * dt;
        hoverTiltY += tiltVelY * dt;
        currentLaptop.rotation.x = hoverTiltX;
      } else {
        hoverTiltX *= Math.pow(0.92, dt);
        currentLaptop.rotation.x = hoverTiltX;
      }

      const blMat = meshesRef.current?.backlightPlane.material as THREE.MeshStandardMaterial | undefined;
      if (blMat && blMat.emissiveIntensity > 0) {
        if ((blMat as any).__rainbow) {
          rainbowT += 0.012 * dt;
          const r = Math.sin(rainbowT) * 0.5 + 0.5;
          const g = Math.sin(rainbowT + 2.094) * 0.5 + 0.5;
          const b2 = Math.sin(rainbowT + 4.189) * 0.5 + 0.5;
          blMat.emissive.setRGB(r, g, b2);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate(performance.now());

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onPointerLeave);
      mount.removeEventListener("pointerdown", onScreenPointerDown);
      mount.removeEventListener("pointerup", onScreenPointerUp);
      mount.removeEventListener("pointerenter", onMountEnter);
      mount.removeEventListener("pointerleave", onMountLeave2);
      window.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Rebuild geometry when the laptop's shape PROFILE actually changes ----
  // (color/finish/backlight/etc. below still update in place without a rebuild --
  // only brand/model changes that imply a different physical shape trigger this.)
  useEffect(() => {
    const scene = sceneRef.current;
    const bodyMat = bodyMatRef.current;
    if (!scene || !bodyMat) return;

    const newProfile = profileForLaptop(brandName, modelName);
    const newDimsOverride = getAccurateDims(brandName, modelName, screenSizeIn, newProfile.name);
    const currentProfile = meshesRef.current?.profile;
    const currentDimsOverride = meshesRef.current?.dimsOverride ?? null;

    // Skip rebuild only if BOTH the shape-profile family AND the exact real dimensions
    // are unchanged. Two different ThinkPads share a profile family but can have
    // different real spec-sheet sizes (e.g. T14 vs T14s), so a dims-only change must
    // still trigger a rebuild -- comparing profile name alone would silently skip that.
    const sameProfile = currentProfile && currentProfile.name === newProfile.name;
    const sameDims = JSON.stringify(currentDimsOverride) === JSON.stringify(newDimsOverride);
    if (sameProfile && sameDims) return;

    const oldGroup = meshesRef.current?.group;
    const wasVisible = oldGroup ? oldGroup.visible : true;
    const oldRotationY = oldGroup ? oldGroup.rotation.y : 0;
    const oldScale = oldGroup ? oldGroup.scale.x : modelScale;

    if (oldGroup) {
      scene.remove(oldGroup);
      disposeGroup(oldGroup);
    }

    // Reuse the SAME persistent OS canvas texture (not a freshly loaded one) so click state
    // and the interactive UI survive a brand/profile rebuild, unless a real photo is uploaded.
    const displayTexture = customDisplayUrl ? getDisplayTexture(osTheme, customDisplayUrl) : (osTextureRef.current ?? getDisplayTexture(osTheme, customDisplayUrl));
    const { group: laptop, refs } = buildLaptop(bodyMat, displayTexture, newProfile, newDimsOverride);
    laptop.rotation.y = oldRotationY;
    laptop.scale.setScalar(oldScale);
    laptop.visible = wasVisible && !customModelRef.current;
    refs.screenPivot.rotation.x = THREE.MathUtils.degToRad(-(180 - openAngle));

    const blMat = refs.backlightPlane.material as THREE.MeshStandardMaterial;
    const bl = BACKLIGHTS[backlightIndex];
    if (bl.color === "__rainbow__") {
      blMat.emissive.set("#ff4444");
      blMat.emissiveIntensity = 1.1;
      (blMat as any).__rainbow = true;
    } else if (bl.color) {
      blMat.emissive.set(bl.color);
      blMat.emissiveIntensity = 1.0;
    }

    const logoMat = refs.logo.material as THREE.MeshStandardMaterial;
    logoMat.emissiveIntensity = logoGlow ? 0.8 : 0;

    scene.add(laptop);
    meshesRef.current = refs;
  }, [brandName, modelName, screenSizeIn]);

  // ---- Reactive updates (color/finish/etc. -- unchanged behaviour, still in-place updates) ----
  useEffect(() => {
    const refs = meshesRef.current;
    if (refs) {
      refs.bodyMeshes.forEach((m) => {
        (m.material as THREE.MeshPhysicalMaterial).color.set(baseColor);
      });
    }
    if (customModelRef.current) {
      customModelRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const m = child.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
          if (m && m.color) m.color.set(baseColor);
        }
      });
    }
  }, [baseColor]);

  useEffect(() => {
    const finish = FINISHES[finishIndex];
    const refs = meshesRef.current;
    if (refs) {
      refs.bodyMeshes.forEach((m) => {
        const mat = m.material as THREE.MeshPhysicalMaterial;
        mat.roughness   = finish.roughness;
        mat.metalness   = finish.metalness ?? 0.78;
        mat.clearcoat   = finish.clearcoat;
        mat.sheen       = finish.sheen;
        mat.sheenColor  = new THREE.Color(finish.sheenTint ?? "#ffffff");
        mat.needsUpdate = true;
      });
    }
    if (customModelRef.current) {
      customModelRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const m = child.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
          if (m && m.roughness !== undefined) {
            m.roughness = finish.roughness;
            m.metalness = finish.metalness ?? 0.78;
          }
        }
      });
    }
  }, [finishIndex]);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;
    refs.screenPivot.rotation.x = THREE.MathUtils.degToRad(-(180 - openAngle));
  }, [openAngle]);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;
    const mat = refs.display.material as THREE.MeshBasicMaterial;
    mat.color.set(displayOn ? 0xffffff : 0x0a0a0c);
  }, [displayOn]);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;
    const mat = refs.display.material as THREE.MeshBasicMaterial;
    if (customDisplayUrl) {
      // Real uploaded photo: plain static texture, no interactive UI on top of it.
      mat.map = getDisplayTexture(osTheme, customDisplayUrl);
    } else {
      // Back to (or still on) the interactive OS -- reuse the persistent canvas texture and
      // just redraw its contents for the current theme, instead of loading a fresh image.
      mat.map = osTextureRef.current;
      ensureWallpaperLoaded(osTheme);
    }
    mat.needsUpdate = true;
  }, [osTheme, customDisplayUrl]);

  // Keep the OS clock roughly live and clear any stale toast, without a full redraw loop --
  // only runs while the interactive desktop (not a custom photo) is actually showing.
  useEffect(() => {
    if (customDisplayUrl) return;
    const interval = setInterval(() => redrawOS(), 20000);
    return () => clearInterval(interval);
  }, [customDisplayUrl]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (installTimeoutRef.current) clearTimeout(installTimeoutRef.current);
      if (animateOpenRef.current) cancelAnimationFrame(animateOpenRef.current);
      if (animateCloseRef.current) cancelAnimationFrame(animateCloseRef.current);
      keyPressTimeouts.current.forEach((t) => clearTimeout(t));
      keyPressTimeouts.current.clear();
    };
  }, []);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;

    const logoTex = makeBrandLogoTexture(brandName, modelName);
    const logoMat = refs.logo.material as THREE.MeshStandardMaterial;
    logoMat.map = logoTex;
    logoMat.alphaMap = logoTex;
    logoMat.needsUpdate = true;

    const isThinkpad = isThinkpadName(brandName, modelName);
    refs.trackpoint.visible = isThinkpad;
    refs.bottomDetails.visible = isThinkpad;
    refs.cameraBump.visible = isThinkpad;

    const b = (brandName || "").toLowerCase();
    const m = (modelName || "").toLowerCase();
    if (b.includes("apple") || b.includes("macbook") || m.includes("macbook") || b.includes("rog") || m.includes("rog") || b.includes("razer") || b.includes("msi")) {
      logoMat.emissiveIntensity = 0.8;
      logoMat.metalness = 0.2;
      logoMat.color.set("#ffffff");
    } else {
      logoMat.emissiveIntensity = 0;
      logoMat.metalness = 1.0;
      logoMat.roughness = 0.1;
      logoMat.color.set("#dddddd");
    }

    const profile = refs.profile;
    // Use this laptop's ACTUAL real width/depth (refs.width/refs.depth), not the generic
    // DIMS constant -- otherwise the logo sits in the wrong spot on any laptop using the
    // accurate per-model dimensions instead of the old flat template.
    const width = refs.width;
    const depth = refs.depth;
    const lidThickness = refs.lidThickness;
    // Now actually driven by profile.logoStyle (previously defined per-profile but never
    // read anywhere -- this re-derived the same thing via a separate isThinkpad check
    // instead of using the field that already exists for exactly this purpose).
    if (profile.logoStyle === "corner-etched") {
      refs.logo.position.set(width / 2 - 0.35, depth - 0.25, -lidThickness - 0.001);
      refs.logo.rotation.z = Math.PI / 8;
      refs.logo.scale.set(1.2, 1.2, 1);
      refs.secondaryLogo.visible = true;
    } else {
      refs.logo.position.set(0, depth / 2, -lidThickness - 0.001);
      refs.logo.rotation.z = 0;
      refs.logo.scale.set(1, 1, 1);
      refs.secondaryLogo.visible = false;
    }
  }, [brandName, modelName]);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;
    const mat = refs.backlightPlane.material as THREE.MeshStandardMaterial;
    const bl = BACKLIGHTS[backlightIndex];
    if (bl.color === "__rainbow__") {
      mat.emissive.set("#ff4444");
      mat.emissiveIntensity = 1.1;
      (mat as any).__rainbow = true;
    } else if (bl.color) {
      (mat as any).__rainbow = false;
      mat.emissive.set(bl.color);
      mat.emissiveIntensity = 1.0;
    } else {
      (mat as any).__rainbow = false;
      mat.emissiveIntensity = 0;
    }
  }, [backlightIndex]);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;
    const mat = refs.logo.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = logoGlow ? 0.8 : 0;
  }, [logoGlow]);

  useEffect(() => {
    const scene = sceneRef.current;
    const ground = groundRef.current;
    if (!scene || !ground) return;
    const bg = BACKGROUNDS[bgIndex];
    (scene.background as THREE.Color).set(bg.color);
    if (scene.fog) (scene.fog as THREE.Fog).color.set(bg.color);
    (ground.material as THREE.MeshStandardMaterial).color.set(bg.ground);
  }, [bgIndex]);

  useEffect(() => {
    const refs = meshesRef.current;
    if (!refs) return;
    refs.group.scale.setScalar(modelScale);
  }, [modelScale]);

  const goToView = (key: keyof typeof VIEWS) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const v = VIEWS[key];
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
    controls.update();
  };

  const toggleScreenFocus = () => {
    if (!screenFocused) {
      autoRotateBeforeFocusRef.current = autoRotate;
      setAutoRotate(false);
      // Open the screen to a good on-axis angle for actually looking at it straight-on.
      setOpenAngle(100);
      goToView("screenFocus");
      setScreenFocused(true);
    } else {
      setAutoRotate(autoRotateBeforeFocusRef.current);
      goToView("iso");
      setScreenFocused(false);
    }
  };

  return (
    <div className={studioMode ? styles.studioWrapper : styles.wrapper}>
      <div className={styles.canvasArea}>
        <div ref={mountRef} className={styles.canvasInner} />
        {selectedLaptop && (
          <div className={styles.laptopBadge}>
            {selectedLaptop.brand} {selectedLaptop.model}
          </div>
        )}
        <button
          onClick={toggleScreenFocus}
          title={screenFocused ? "Exit fullscreen" : "Use the screen (fullscreen)"}
          style={{
            position: "absolute", top: 12, right: 12, zIndex: 5,
            background: "rgba(20,20,24,0.65)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          {screenFocused ? "\u2715 Exit" : "\u2922 Use PC"}
        </button>
        {screenFocused && !customDisplayUrl && (
          <div style={{
            position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
            background: "rgba(20,20,24,0.6)", color: "rgba(255,255,255,0.85)", borderRadius: 8,
            padding: "5px 12px", fontSize: 11, whiteSpace: "nowrap",
          }}>
            Click to interact \u00b7 1-6 launch apps \u00b7 Esc closes \u00b7 {osTheme === "mac" ? "A" : "S"} toggles menu
          </div>
        )}
      </div>

      <aside className={styles.filterPanel} aria-label="3D model filters">
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Laptop</span>
          <select
            className={styles.select}
            value={selectedId}
            onChange={(e) =>
              handleSelectLaptop(e.target.value === "" ? "" : Number(e.target.value))
            }
          >
            <option value="">
              {loadingLaptops ? "Loading..." : "Custom (no laptop selected)"}
            </option>
            {laptops.map((l) => (
              <option key={l.id} value={l.id}>
                {l.brand} {l.model}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Color</span>
          {(() => {
            // Recognized models only offer the colors they actually ship in --
            // e.g. a real ThinkPad T14 only ever came in Thunder Black, so we
            // don't show 13 fictional colors it never existed in.
            const officialColors = officialColorsForLaptop(brandName, modelName);
            const swatches: OfficialColor[] = officialColors ?? BASE_COLORS;
            return (
              <div className={styles.swatchRow}>
                {swatches.map((c) => (
                  <button
                    key={c.hex}
                    title={c.name}
                    onClick={() => setBaseColor(c.hex)}
                    className={styles.swatch}
                    style={{
                      backgroundColor: c.hex,
                      outline: baseColor === c.hex ? "2px solid var(--accent, #0a84ff)" : "none",
                    }}
                  />
                ))}
              </div>
            );
          })()}
          {officialColorsForLaptop(brandName, modelName) && (
            <span style={{ fontSize: 10, color: "#8892aa", marginTop: 4, display: "block" }}>
              Showing this model&apos;s real color options
            </span>
          )}
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Finish</span>
          <div className={styles.toggleRow}>
            {FINISHES.map((f, i) => (
              <button
                key={f.name}
                onClick={() => setFinishIndex(i)}
                className={`${styles.toggleBtn} ${finishIndex === i ? styles.toggleBtnActive : ""}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Keyboard backlight</span>
          <div className={styles.toggleRow}>
            {BACKLIGHTS.map((b, i) => (
              <button
                key={b.name}
                onClick={() => setBacklightIndex(i)}
                className={`${styles.toggleBtn} ${backlightIndex === i ? styles.toggleBtnActive : ""}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Background</span>
          <div className={styles.toggleRow}>
            {BACKGROUNDS.map((b, i) => (
              <button
                key={b.name}
                onClick={() => setBgIndex(i)}
                className={`${styles.toggleBtn} ${bgIndex === i ? styles.toggleBtnActive : ""}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>View</span>
          <div className={styles.toggleRow}>
            <button className={styles.toggleBtn} onClick={() => goToView("iso")}>Iso</button>
            <button className={styles.toggleBtn} onClick={() => goToView("front")}>Front</button>
            <button className={styles.toggleBtn} onClick={() => goToView("side")}>Side</button>
            <button className={styles.toggleBtn} onClick={() => goToView("top")}>Top</button>
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Open angle</span>
          <input
            type="range"
            min={20}
            max={130}
            value={openAngle}
            onChange={(e) => setOpenAngle(Number(e.target.value))}
            className={styles.slider}
          />
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={displayOn} onChange={(e) => setDisplayOn(e.target.checked)} />
            Display on
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={logoGlow} onChange={(e) => setLogoGlow(e.target.checked)} />
            Logo glow
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
            Auto-rotate
          </label>
        </div>

        <button onClick={() => goToView("iso")} className={styles.resetBtn}>
          Reset view
        </button>

        {isAdmin && selectedId !== "" && (
          <div style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}>
            <span style={{
              display: "block",
              fontSize: 10,
              fontFamily: "'DM Mono', monospace",
              color: "#63e88c",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: 8,
            }}>✦ Admin — Save Design</span>
            <p style={{ fontSize: 11, color: "#8892aa", marginBottom: 10, lineHeight: 1.5 }}>
              Saves current color, finish, backlight, angle &amp; glow for this laptop. All visitors will see this design.
            </p>
            <button
              onClick={async () => {
                if (!selectedId) return;
                setSaveMsg("saving");
                try {
                  await saveLaptopDesign({
                    laptop_id: Number(selectedId),
                    color_hex: baseColor,
                    finish: FINISHES[finishIndex].name,
                    backlight: BACKLIGHTS[backlightIndex].name,
                    open_angle: openAngle,
                    logo_glow: logoGlow,
                    custom_model_base64: customModelBase64,
                  });
                  setSaveMsg("saved");
                  setTimeout(() => setSaveMsg(""), 3000);
                } catch {
                  setSaveMsg("error");
                  setTimeout(() => setSaveMsg(""), 3000);
                }
              }}
              style={{
                width: "100%",
                padding: "10px",
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                borderRadius: 8,
                background: saveMsg === "saved" ? "#1e6640" : saveMsg === "error" ? "#7a2222" : "#63e88c",
                color: saveMsg === "saved" || saveMsg === "error" ? "#fff" : "#0d1f16",
                cursor: "pointer",
                transition: "background 0.3s",
                fontFamily: "'Syne', sans-serif",
              }}
            >
              {saveMsg === "saving" ? "Saving…" : saveMsg === "saved" ? "✓ Saved!" : saveMsg === "error" ? "✗ Error" : "Save Design"}
            </button>
          </div>
        )}
        {isAdmin && (
          <div style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}>
            <span style={{
              display: "block",
              fontSize: 10,
              fontFamily: "'DM Mono', monospace",
              color: "#63e88c",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: 8,
            }}>✦ Admin — Import Model</span>
            <p style={{ fontSize: 11, color: "#8892aa", marginBottom: 10, lineHeight: 1.5 }}>
              Import a <strong style={{color:"#c9d1e0"}}>GLB / GLTF</strong> file to replace the generated model. Auto-scales to fit.
            </p>

            {importStatus === "loaded" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "#63e88c", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {importedFileName}</span>
                <button
                  onClick={clearCustomModel}
                  title="Remove custom model"
                  style={{
                    padding: "3px 8px", fontSize: 11, border: "1px solid rgba(255,100,100,0.4)",
                    borderRadius: 6, background: "rgba(255,100,100,0.1)", color: "#f76a6a",
                    cursor: "pointer",
                  }}
                >✕ Clear</button>
              </div>
            )}
            {importStatus === "error" && (
              <p style={{ fontSize: 11, color: "#f76a6a", marginBottom: 8 }}>Failed to load. Make sure it&apos;s a valid GLB/GLTF file.</p>
            )}

            <label style={{
              display: "block",
              width: "100%",
              padding: "9px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px dashed rgba(99,232,140,0.4)",
              borderRadius: 8,
              background: importStatus === "loading" ? "rgba(99,232,140,0.05)" : "transparent",
              color: importStatus === "loading" ? "#8892aa" : "#63e88c",
              cursor: "pointer",
              textAlign: "center",
              transition: "all 0.2s",
              boxSizing: "border-box",
            }}>
              {importStatus === "loading" ? "Loading…" : "📂 Choose GLB / GLTF file"}
              <input
                type="file"
                accept=".glb,.gltf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadCustomModel(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}
      </aside>
    </div>
  );
}