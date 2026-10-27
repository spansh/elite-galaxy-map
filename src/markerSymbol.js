import { CENTRE_DOT_RADIUS, markerOutlineCorners } from './markerShapes.js';

// A small picture of a highlight marker, drawn as the map draws it: its
// shape, colour and any centre dot. For legends.
export function buildMarkerSymbol({ colour, shape = 'circle', centreDot = false }, { className = '' } = {}) {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const symbol = document.createElementNS(svgNamespace, 'svg');
  if (className !== '') {
    symbol.setAttribute('class', className);
  }
  symbol.setAttribute('viewBox', '-8 -8 16 16');
  symbol.setAttribute('aria-hidden', 'true');
  const markerRadius = 6;
  // SVG's y points down, the map's up.
  const corners = markerOutlineCorners(shape, markerRadius)
    .map(corner => `${corner.x.toFixed(2)},${(-corner.y).toFixed(2)}`)
    .join(' ');
  const outline = document.createElementNS(svgNamespace, 'polygon');
  outline.setAttribute('points', corners);
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', colour);
  outline.setAttribute('stroke-width', '1.6');
  symbol.append(outline);
  if (centreDot) {
    const dot = document.createElementNS(svgNamespace, 'circle');
    dot.setAttribute('r', String(CENTRE_DOT_RADIUS * markerRadius));
    dot.setAttribute('fill', colour);
    symbol.append(dot);
  }
  return symbol;
}
