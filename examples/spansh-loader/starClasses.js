// Sorts systems into map layers by the class of their main star, as Spansh
// dumps name it ("K (Yellow-Orange) Star", "White Dwarf (DA) Star", ...).
//
// Ordinary stars go by their spectral letter, hottest first (O B A F G K M,
// then the brown dwarfs L T Y); giants and supergiants go with their letter.
// Stars that are not on that sequence get layers of their own.
//
// The common classes have millions of stars that pile up when zoomed out, so
// each distant one is drawn very faint (minimumBrightness 0.03) to stop the
// core turning solid white. Rare classes stay brighter so they can be found.

const FAINT = 0.03;

export const STAR_CLASS_LAYERS = Object.freeze({
  o: { layer: 'class-o', label: 'O stars', order: 1, colour: '#9bb0ff', minimumBrightness: 0.3 },
  b: { layer: 'class-b', label: 'B stars', order: 2, colour: '#aabfff', minimumBrightness: 0.1 },
  a: { layer: 'class-a', label: 'A stars', order: 3, colour: '#cad7ff', minimumBrightness: FAINT },
  f: { layer: 'class-f', label: 'F stars', order: 4, colour: '#f2f0e6', minimumBrightness: FAINT },
  g: { layer: 'class-g', label: 'G stars', order: 5, colour: '#fff1c9', minimumBrightness: FAINT },
  k: { layer: 'class-k', label: 'K stars', order: 6, colour: '#ffc98a', minimumBrightness: FAINT },
  m: { layer: 'class-m', label: 'M stars', order: 7, colour: '#ff9e6b', minimumBrightness: FAINT },
  l: { layer: 'class-l', label: 'L brown dwarfs', order: 8, colour: '#c46a4a', minimumBrightness: FAINT },
  t: { layer: 'class-t', label: 'T brown dwarfs', order: 9, colour: '#9a4f3e', minimumBrightness: FAINT },
  y: { layer: 'class-y', label: 'Y brown dwarfs', order: 10, colour: '#6e3b3b', minimumBrightness: FAINT },
  young: { layer: 'young', label: 'T Tauri and Herbig stars', order: 11, colour: '#ffe08a', minimumBrightness: FAINT },
  wolfRayet: { layer: 'wolf-rayet', label: 'Wolf-Rayet stars', order: 12, colour: '#c9a6ff', minimumBrightness: 0.5 },
  carbon: { layer: 'carbon', label: 'Carbon stars', order: 13, colour: '#ff6a3d', minimumBrightness: 0.3 },
  sType: { layer: 's-type', label: 'S and MS type stars', order: 14, colour: '#ff8f6a', minimumBrightness: 0.3 },
  whiteDwarf: { layer: 'white-dwarf', label: 'White dwarfs', order: 15, colour: '#e8f2ff', minimumBrightness: 0.1 },
  neutron: { layer: 'neutron', label: 'Neutron stars', order: 16, colour: '#7cc4ff', minimumBrightness: FAINT },
  blackHole: { layer: 'black-hole', label: 'Black holes', order: 17, colour: '#d07bff', starSizeInLightYears: 6, minimumBrightness: 0.5 },
  // Systems whose main star is missing or not recognised.
  other: { layer: 'other', label: 'Other stars', order: 18, colour: '#b4c2d6', minimumBrightness: FAINT },
});

const SPECTRAL_LETTER = /^([OBAFGKMLTY]) \(/;
// C, CN, CJ, CH and CHd stars.
const CARBON_STAR = /^C[A-Za-z]* Star$/;

// The layer description (a defineLayer command, less its type) for a main
// star type, or the "other" layer for anything unrecognised.
export function layerForMainStar(mainStar) {
  if (typeof mainStar !== 'string' || mainStar === '') {
    return STAR_CLASS_LAYERS.other;
  }
  if (mainStar === 'Neutron Star') {
    return STAR_CLASS_LAYERS.neutron;
  }
  if (mainStar.includes('Black Hole')) {
    return STAR_CLASS_LAYERS.blackHole;
  }
  if (mainStar.startsWith('White Dwarf')) {
    return STAR_CLASS_LAYERS.whiteDwarf;
  }
  if (mainStar.startsWith('Wolf-Rayet')) {
    return STAR_CLASS_LAYERS.wolfRayet;
  }
  // Checked before the spectral letters, so "T Tauri Star" isn't taken
  // for a T brown dwarf.
  if (mainStar.startsWith('T Tauri') || mainStar.startsWith('Herbig')) {
    return STAR_CLASS_LAYERS.young;
  }
  if (mainStar === 'S-type Star' || mainStar === 'MS-type Star') {
    return STAR_CLASS_LAYERS.sType;
  }
  if (CARBON_STAR.test(mainStar)) {
    return STAR_CLASS_LAYERS.carbon;
  }
  const spectralMatch = SPECTRAL_LETTER.exec(mainStar);
  if (spectralMatch !== null) {
    return STAR_CLASS_LAYERS[spectralMatch[1].toLowerCase()];
  }
  return STAR_CLASS_LAYERS.other;
}
