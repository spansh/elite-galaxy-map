import { buildMarkerSymbol } from './markerSymbol.js';

// A key to the highlight markers, in a corner of the map: one line for each
// kind of marker, drawn as the map draws it (shape, colour and any centre
// dot), with a label and an optional count. Set by the legend option or the
// setLegend command; hidden while it has no entries.

export const LEGEND_CORNERS = Object.freeze(['topRight', 'topLeft', 'bottomRight', 'bottomLeft']);

const STYLES = `
    .egm-legend {
        position: absolute;
        z-index: 2;
        padding: 6px 10px;
        border-radius: 4px;
        background: rgba(3, 6, 10, 0.78);
        color: #b9d3e2;
        font: 12px/1.6 system-ui, sans-serif;
        pointer-events: none;
        user-select: none;
    }
    .egm-legend[hidden] {
        display: none;
    }
    .egm-legend-entry {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }
    .egm-legend-symbol {
        width: 14px;
        height: 14px;
        flex: none;
    }
    .egm-legend-count {
        margin-left: auto;
        padding-left: 12px;
        color: #7d97a6;
        font-variant-numeric: tabular-nums;
    }
`;

let stylesAreAdded = false;
function addStylesOnce() {
    if (stylesAreAdded) {
        return;
    }
    const styleElement = document.createElement('style');
    styleElement.textContent = STYLES;
    document.head.append(styleElement);
    stylesAreAdded = true;
}

const CORNER_POSITIONS = {
    topRight: { top: '10px', right: '10px' },
    topLeft: { top: '10px', left: '10px' },
    bottomRight: { bottom: '10px', right: '10px' },
    // Above the loading bar's status line.
    bottomLeft: { bottom: '34px', left: '10px' },
};

export class Legend {
    // defaultColour is used for entries that give none: the map's
    // highlight colour, as for highlights without a colour.
    constructor(containerElement, { corner = 'topRight', defaultColour }) {
        addStylesOnce();
        this.defaultColour = defaultColour;
        this.entries = [];
        this.isEnabled = true;
        this.element = document.createElement('div');
        this.element.className = 'egm-legend';
        this.element.setAttribute('role', 'list');
        this.element.setAttribute('aria-label', 'Legend');
        Object.assign(this.element.style, CORNER_POSITIONS[corner]);
        containerElement.append(this.element);
        this.update();
    }

    // entries: [{ label, colour?, shape?, centreDot?, count? }]
    setEntries(entries) {
        this.entries = entries.map(entry => ({ ...entry }));
        this.update();
    }

    getEntries() {
        return this.entries.map(entry => ({ ...entry }));
    }

    // Switched off, it stays hidden whatever entries it is given.
    setEnabled(isEnabled) {
        this.isEnabled = isEnabled;
        this.update();
    }

    update() {
        this.element.hidden = !this.isEnabled || this.entries.length === 0;
        this.element.replaceChildren(...this.entries.map(entry => {
            const line = document.createElement('div');
            line.className = 'egm-legend-entry';
            line.setAttribute('role', 'listitem');
            const symbol = buildMarkerSymbol({ ...entry, colour: entry.colour ?? this.defaultColour }, { className: 'egm-legend-symbol' });
            const label = document.createElement('span');
            label.textContent = entry.label;
            line.append(symbol, label);
            if (entry.count !== undefined) {
                const count = document.createElement('span');
                count.className = 'egm-legend-count';
                count.textContent = entry.count.toLocaleString();
                line.append(count);
            }
            return line;
        }));
    }

    dispose() {
        this.element.remove();
    }
}
