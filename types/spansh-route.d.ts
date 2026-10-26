// Types for elite-galaxy-map/spansh-route.js (also exported by the map).

import type { HighlightedSystem, LegendEntry, MarkerShape } from './index';

export const ROUTE_STOP_COLOURS: Readonly<{
    neutronBoost: string;
    refuel: string;
    neutronBoostAndRefuel: string;
}>;

export type RouteStopKind = 'neutronBoost' | 'refuel' | 'neutronBoostAndRefuel' | 'other';

export const ROUTE_STOP_LABELS: Readonly<Record<RouteStopKind, string>>;

/** The fields of a jump that mark it as a neutron boost or a refuel stop. */
export interface RouteJump {
    /** Exact plotter. */
    has_neutron?: boolean;
    /** Neutron plotter. */
    neutron_star?: boolean;
    must_refuel?: boolean;
    [field: string]: unknown;
}

/** How a stop is marked: add these fields to its system. Empty for an ordinary stop. */
export interface RouteStopMarker {
    colour?: string;
    shape?: MarkerShape;
    centreDot?: boolean;
}

export function routeStopMarker(jump: RouteJump): RouteStopMarker;

/** Legend entries, with counts, for the kinds of stop a route has; empty when every stop is ordinary. */
export function routeStopLegend(
    systems: HighlightedSystem[],
    options?: { labels?: Partial<Record<RouteStopKind, string>> },
): LegendEntry[];

/** A Spansh plotter result (exact, neutron, tourist or road to riches) as systems to highlight as a route. */
export function routeSystemsFromSpanshResult(routeResult: unknown): HighlightedSystem[];
