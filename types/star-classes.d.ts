// Types for elite-galaxy-map/star-classes.js, the example loader's sorting of main stars into layers.

import type { DefineLayerCommand } from './index';

/** A layer description: a defineLayer command without its type. */
export type StarClassLayer = Omit<DefineLayerCommand, 'type'> & { label: string; order: number; colour: string };

export const STAR_CLASS_LAYERS: Readonly<Record<
    'o' | 'b' | 'a' | 'f' | 'g' | 'k' | 'm' | 'l' | 't' | 'y'
    | 'young' | 'wolfRayet' | 'carbon' | 'sType' | 'whiteDwarf' | 'neutron' | 'blackHole' | 'other',
    StarClassLayer
>>;

/** The layer for a main star type (as in Spansh dumps), or the "other" layer if unrecognised. */
export function layerForMainStar(mainStar: string | null | undefined): StarClassLayer;
