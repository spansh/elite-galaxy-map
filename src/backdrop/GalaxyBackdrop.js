import { Group } from 'three';
import { GalaxyImage } from './GalaxyImage.js';
import { VolumetricBackdrop } from './VolumetricBackdrop.js';
import { GALAXY_DENSITY_MAP_AREA, loadDensityMap } from './densityMap.js';

// The galaxy decoration drawn behind the stars, made of two parts built from
// one density map, each shown or hidden on its own:
//   the glow    a volume of light ray-marched through the galaxy
//               (VolumetricBackdrop); style 'volumetric' shows it, 'none' hides it
//   the image   the density map as a flat picture, faded in when zoomed out
//               (GalaxyImage)
// The map talks only to this class, which loads the density map, builds
// both parts and decides each frame how strongly to draw them.

export const BACKDROP_STYLES = Object.freeze(['volumetric', 'none']);

function checkStyle(style) {
  if (!BACKDROP_STYLES.includes(style)) {
    throw new Error(`Unknown backdrop style "${style}"; expected one of ${BACKDROP_STYLES.join(', ')}`);
  }
}

export class GalaxyBackdrop {
  constructor({ densityMapUrl, densityMapArea = GALAXY_DENSITY_MAP_AREA, style, showGalaxyImage, volumetricSettings, onReady }) {
    checkStyle(style);
    this.sceneObject = new Group();
    this.sceneObject.name = 'galaxy backdrop';
    this.style = style;
    this.showGalaxyImage = showGalaxyImage;
    this.dimming = 1;
    this.densityMap = null;
    this.glow = null;
    this.galaxyImage = null;
    this.isDisposed = false;
    this.loadingPromise = loadDensityMap(densityMapUrl, densityMapArea).then(densityMap => {
      // The map may have been taken down while the image loaded.
      if (this.isDisposed) {
        densityMap.texture.dispose();
        return;
      }
      this.densityMap = densityMap;
      this.glow = new VolumetricBackdrop(densityMap, volumetricSettings);
      this.galaxyImage = new GalaxyImage(densityMap);
      this.glow.sceneObject.visible = false;
      this.galaxyImage.sceneObject.visible = false;
      this.sceneObject.add(this.glow.sceneObject, this.galaxyImage.sceneObject);
      onReady?.();
    });
  }

  // 'volumetric' to show the glow, 'none' to hide it.
  setStyle(style) {
    checkStyle(style);
    this.style = style;
  }

  setGalaxyImageVisible(isVisible) {
    this.showGalaxyImage = isVisible;
  }

  // Below 1 to dim the backdrop, so highlighted systems stand out.
  setDimming(dimming) {
    this.dimming = dimming;
  }

  updateForCamera(cameraState) {
    if (this.densityMap === null) {
      return;
    }
    // The glow is dimmed when zoomed in among the stars, where it should
    // be a hint of colour rather than compete with them.
    const showGlow = this.style === 'volumetric';
    this.glow.sceneObject.visible = showGlow;
    if (showGlow) {
      const zoomedOutAmount = Math.min(Math.max((cameraState.cameraDistanceFromTarget - 1500) / 25000, 0), 1);
      this.glow.updateForCamera({ ...cameraState, opacity: (0.35 + 0.65 * zoomedOutAmount) * this.dimming });
    }
    if (this.showGalaxyImage) {
      // Shows itself only once zoomed out far enough.
      this.galaxyImage.updateForCamera({ ...cameraState, opacity: this.dimming });
    } else {
      this.galaxyImage.sceneObject.visible = false;
    }
  }

  dispose() {
    this.isDisposed = true;
    this.glow?.dispose();
    this.galaxyImage?.dispose();
    this.densityMap?.texture.dispose();
  }
}
