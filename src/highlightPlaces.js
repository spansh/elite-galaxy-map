// Highlighted systems at the same place (a route coming back, or two
// stations in one star system) share one marker. Its label lists each of
// them; on a route, a place with several stops numbers them, counting the
// first system as 1. Stops that give the same `system` and each a `station`
// are listed under the system's name:
//
//     Cemiess
//       3. Meech Dock
//       5. Titius Station

import { DEFAULT_TEXT } from './mapText.js';

// The same distance isSameSystem allows: coordinates from different sources
// for one system can differ by a little.
const SAME_PLACE_TOLERANCE_LIGHT_YEARS = 0.1;

// Which place each system is at, as an index into the places in the order
// they first appear. Places are found through a grid of cells the size of
// the tolerance, so a route of thousands of stops is still quick.
export function findPlaceOfEachSystem(systems) {
  const cellOf = value => Math.floor(value / SAME_PLACE_TOLERANCE_LIGHT_YEARS);
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  const placesByCell = new Map();
  const placeCoordinates = [];
  return systems.map(system => {
    const { x, y, z } = system.coordinates;
    const cellX = cellOf(x);
    const cellY = cellOf(y);
    const cellZ = cellOf(z);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
          const nearbyPlaces = placesByCell.get(cellKey(cellX + offsetX, cellY + offsetY, cellZ + offsetZ)) ?? [];
          const samePlace = nearbyPlaces.find(placeIndex => {
            const place = placeCoordinates[placeIndex];
            return Math.abs(place.x - x) < SAME_PLACE_TOLERANCE_LIGHT_YEARS
              && Math.abs(place.y - y) < SAME_PLACE_TOLERANCE_LIGHT_YEARS
              && Math.abs(place.z - z) < SAME_PLACE_TOLERANCE_LIGHT_YEARS;
          });
          if (samePlace !== undefined) {
            return samePlace;
          }
        }
      }
    }
    const newPlace = placeCoordinates.length;
    placeCoordinates.push({ x, y, z });
    const key = cellKey(cellX, cellY, cellZ);
    placesByCell.set(key, [...(placesByCell.get(key) ?? []), newPlace]);
    return newPlace;
  });
}

const NAMING_RULE_STRENGTHS = new Map([[false, 0], ['ifRoom', 1], [true, 2]]);

// A rule the map doesn't know counts as the weakest.
function strongestNamingRule(namingRules) {
  const strengthOf = namingRule => NAMING_RULE_STRENGTHS.get(namingRule) ?? -1;
  return namingRules.reduce((strongest, namingRule) => strengthOf(namingRule) > strengthOf(strongest) ? namingRule : strongest);
}

// One line per distinct name, in the order the names first appear, or the
// system's name and then one indented line per station, where there is more
// than one station or the stops are numbered.
function placeLabelText(entries, { numbersStops, unnamedSystemText }) {
  const systemName = entries[0].system.system;
  const isStationOfThisSystem = system => typeof system.station === 'string' && system.system === systemName;
  const stationCount = new Set(entries.map(({ system }) => system.station)).size;
  const isStationsInOneSystem = typeof systemName === 'string' && entries.every(({ system }) => isStationOfThisSystem(system))
    && (stationCount > 1 || numbersStops);
  const stopNumbersByLine = new Map();
  for (const { system, stopNumber } of entries) {
    const line = isStationsInOneSystem ? system.station : system.name ?? unnamedSystemText;
    stopNumbersByLine.set(line, [...(stopNumbersByLine.get(line) ?? []), stopNumber]);
  }
  const lines = [...stopNumbersByLine].map(([line, stopNumbers]) => numbersStops ? `${stopNumbers.join(', ')}. ${line}` : line);
  return isStationsInOneSystem
    ? [systemName, ...lines.map(line => `  ${line}`)].join('\n')
    : lines.join('\n');
}

// Returns one place per distinct position, in the order each first appears:
//   system       the entry picking and selection use: the first one named
//                in the label
//   systems      every entry there, in order
//   labelText    the name label; entries given showName: false are left out
//                of it, unless every entry there is
//   namingRule   the most eager of the entries' rules
//   colour, shape, centreDot
//                the shape of the first entry with one, and its colour (or
//                the first entry's colour with no shape there), and a centre
//                dot if any entry has one, so no entry's shape is lost
// placeOfEachSystem: from findPlaceOfEachSystem, when already worked out.
// unnamedSystemText: the name for systems without one.
export function groupHighlightsByPlace(systems, {
  asRoute = false,
  showNames = true,
  placeOfEachSystem = findPlaceOfEachSystem(systems),
  unnamedSystemText = DEFAULT_TEXT.unnamedSystem,
} = {}) {
  const entriesOfEachPlace = [];
  placeOfEachSystem.forEach((placeIndex, index) => {
    entriesOfEachPlace[placeIndex] ??= [];
    entriesOfEachPlace[placeIndex].push({ system: systems[index], stopNumber: index + 1, namingRule: systems[index].showName ?? showNames });
  });
  return entriesOfEachPlace.map(entries => {
    const placeSystems = entries.map(entry => entry.system);
    const namedEntries = entries.filter(entry => entry.system.showName !== false);
    const labelledEntries = namedEntries.length > 0 ? namedEntries : entries;
    const firstWithShape = placeSystems.find(system => system.shape !== undefined && system.shape !== 'circle');
    const firstWithColour = placeSystems.find(system => system.colour !== undefined);
    return {
      system: labelledEntries[0].system,
      systems: placeSystems,
      labelText: placeLabelText(labelledEntries, { numbersStops: asRoute && entries.length > 1, unnamedSystemText }),
      namingRule: strongestNamingRule(entries.map(entry => entry.namingRule)),
      colour: (firstWithShape ?? firstWithColour)?.colour,
      shape: firstWithShape?.shape,
      centreDot: placeSystems.some(system => system.centreDot === true),
    };
  });
}

// For each leg of a route (leg i runs from stop i to stop i + 1), whether the
// route also travels it the other way. A leg within one place has no length
// and is never counted.
// placeOfEachStop: from findPlaceOfEachSystem.
export function findLegsTravelledBothWays(placeOfEachStop) {
  const legs = placeOfEachStop.slice(0, -1).map((from, legIndex) => ({ from, to: placeOfEachStop[legIndex + 1] }));
  const legsTravelled = new Set(legs.map(leg => `${leg.from}>${leg.to}`));
  return legs.map(leg => leg.from !== leg.to && legsTravelled.has(`${leg.to}>${leg.from}`));
}
