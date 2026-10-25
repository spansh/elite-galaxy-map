import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

// A density map is a top-down picture of the galaxy: brighter pixels mean
// more stars. The top row of the image is the far side of the galaxy (highest
// galactic z) and the left column is the lowest galactic x.
//
// The bundled default, assets/galaxy-density.png, was built from Spansh's
// full systems dump by scripts/build-density-map.mjs, which can build one
// from any dump.

// The area of the galaxy a density map covers, in galactic coordinates:
// 104,000 ly square, centred near the core. Maps built by
// scripts/build-density-map.mjs cover this area, so any of them can be used
// without other changes.
export const GALAXY_DENSITY_MAP_AREA = Object.freeze({ centreX: 25, centreZ: 25900, widthInLightYears: 104000 });

export async function loadDensityMap(imageUrl, area = GALAXY_DENSITY_MAP_AREA) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Could not load density map ${imageUrl}: ${response.status} ${response.statusText}`);
    }
    const imageBitmap = await createImageBitmap(await response.blob());
    // Drawn onto a canvas, which three.js uploads the right way up.
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    canvas.getContext('2d').drawImage(imageBitmap, 0, 0);
    imageBitmap.close();

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;

    return { width: canvas.width, height: canvas.height, texture, area };
}
