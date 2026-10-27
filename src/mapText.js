import { IntlMessageFormat } from 'intl-messageformat';
import { ROUTE_STOP_LABELS } from './spanshRoute.js';

// Every piece of text the map shows, as ICU messages (the format ember-intl
// and most translation tools use). Pages pass their own with the `text`
// option or the setText command; anything left out stays in English.
export const DEFAULT_TEXT = Object.freeze({
  // Control panel
  panelTitle: 'Galaxy map',
  foldPanel: 'Fold the panel away',
  openPanel: 'Open the panel',
  dataHeading: 'Data',
  dumpAddress: 'Address of a systems dump',
  load: 'Load',
  stop: 'Stop',
  clearStars: 'Clear stars',
  layersHeading: 'Layers',
  layersSummary: '{visibleCount, number} of {layerCount, number} shown, {starCount, number} stars',
  showLayers: 'Show the layers',
  foldLayers: 'Fold the layers away',
  noStarsLoaded: 'No stars loaded.',
  routeHeading: 'Route',
  routeFile: 'Spansh route file',
  noRouteLoaded: 'No route loaded.',
  clearRoute: 'Clear route',
  routeFileUnreadable: 'Could not read {fileName}: {message}',
  routeUnreadable: 'Could not read the route: {message}',
  routeEmpty: 'That route has no systems in it.',
  routeSummary: '{start} to {end}, {jumpCount, plural, one {# jump} other {# jumps}}.',
  tradeRouteSummary: '{start} to {end}, {hopCount, plural, one {# hop} other {# hops}}.',
  displayHeading: 'Display',
  galaxyGlow: 'Galaxy glow',
  galaxyImage: 'Galaxy image',
  grid: 'Grid',
  regions: 'Regions',
  selectedSystemHeading: 'Selected system',
  selectPrompt: 'Click a star to select it.',
  selectedSystemCoordinates: '{x, number, ::.00 group-off}, {y, number, ::.00 group-off}, {z, number, ::.00 group-off}',
  distanceFromSol: '{distance, number} ly from Sol',
  // Labels and the legend
  unnamedSystem: '(unnamed system)',
  legend: 'Legend',
  neutronBoostStop: ROUTE_STOP_LABELS.neutronBoost,
  refuelStop: ROUTE_STOP_LABELS.refuel,
  neutronBoostAndRefuelStop: ROUTE_STOP_LABELS.neutronBoostAndRefuel,
  otherStop: ROUTE_STOP_LABELS.other,
  // Loading bar
  loadingSystemsOfSize: 'Loading {systemCount, number} systems, {loadedMegabytes, number} MB of {totalMegabytes, number} MB',
  loadingSystems: 'Loading {systemCount, number} systems, {loadedMegabytes, number} MB',
  loadingOfSize: 'Loading {loadedMegabytes, number} MB of {totalMegabytes, number} MB',
  loading: 'Loading {loadedMegabytes, number} MB',
  loadingFailed: 'Loading failed: {message}',
});

function browserLocale() {
  return globalThis.navigator?.language ?? 'en';
}

function checkLocale(locale) {
  if (locale === null || locale === undefined) {
    return;
  }
  let isLanguageTag = typeof locale === 'string';
  try {
    Intl.getCanonicalLocales(locale);
  } catch {
    isLanguageTag = false;
  }
  if (!isLanguageTag) {
    throw new Error(`The map's locale must be a language tag such as 'fr' or 'en-GB', not ${JSON.stringify(locale)}`);
  }
}

// The placeholders a message uses, such as start and jumpCount in
// '{start}, {jumpCount, plural, one {# jump} other {# jumps}}'.
function placeholderNames(parts) {
  return parts.flatMap(part => [
    ...(typeof part.value === 'string' && part.type !== 0 ? [part.value] : []),
    ...Object.values(part.options ?? {}).flatMap(option => placeholderNames(option.value)),
    ...placeholderNames(part.children ?? []),
  ]);
}

// Values for every placeholder each English message uses, to try a page's
// message out with, so one using another placeholder (or a tag) fails when
// it is given rather than when it is shown.
const SAMPLE_VALUES_BY_KEY = new Map(Object.entries(DEFAULT_TEXT).map(([key, message]) => [
  key,
  Object.fromEntries(placeholderNames(new IntlMessageFormat(message, 'en').getAst()).map(name => [name, 1])),
]));

// Turns each message into a formatter, throwing an error that names the
// first unknown key or message that isn't valid ICU.
function compileMessages(text, locale) {
  if (typeof text !== 'object' || text === null || Array.isArray(text)) {
    throw new Error('The map\'s text must be an object of messages by key, such as { load: \'Charger\' }');
  }
  const unknownKeys = Object.keys(text).filter(key => !Object.hasOwn(DEFAULT_TEXT, key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown text ${unknownKeys.map(key => `"${key}"`).join(', ')}; the keys are listed in DEFAULT_TEXT`);
  }
  const messagesByKey = new Map();
  for (const [key, defaultMessage] of Object.entries(DEFAULT_TEXT)) {
    const message = text[key] ?? defaultMessage;
    if (typeof message !== 'string') {
      throw new Error(`The text for "${key}" must be a string`);
    }
    let compiledMessage;
    try {
      compiledMessage = new IntlMessageFormat(message, locale);
    } catch (error) {
      throw new Error(`The text for "${key}" is not a valid ICU message: ${error.message}`, { cause: error });
    }
    const sampleValues = SAMPLE_VALUES_BY_KEY.get(key);
    try {
      compiledMessage.format(sampleValues);
    } catch (error) {
      const placeholders = Object.keys(sampleValues).map(name => `{${name}}`).join(', ') || 'none';
      throw new Error(`The text for "${key}" can't be shown (${error.message}); its placeholders are ${placeholders}`, { cause: error });
    }
    messagesByKey.set(key, compiledMessage);
  }
  return messagesByKey;
}

// Throws if `text` (and `locale`) can't be used, as the map's constructor
// and the setText command would.
export function checkText(text, locale) {
  checkLocale(locale);
  compileMessages(text, locale ?? browserLocale());
}

export class MapText {
  // locale: a BCP 47 language tag such as 'fr' or 'en-GB', for plurals and
  // numbers; null for the browser's language.
  constructor(text = {}, locale = null) {
    checkLocale(locale);
    this.locale = locale ?? browserLocale();
    this.messagesByKey = compileMessages(text, this.locale);
    this.numberFormat = new Intl.NumberFormat(this.locale);
  }

  format(key, values = {}) {
    const message = this.messagesByKey.get(key);
    if (message === undefined) {
      throw new Error(`No text called "${key}"`);
    }
    return message.format(values);
  }

  formatNumber(number) {
    return this.numberFormat.format(number);
  }
}
