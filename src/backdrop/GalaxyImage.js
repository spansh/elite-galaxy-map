import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { galacticZToSceneZ } from '../coordinates.js';

// The density map drawn as a flat picture on the galactic plane: the panel's
// "Galaxy image". It fades in as the camera pulls back, where it reads as the
// familiar top-down picture of the galaxy, and is invisible close up.

export class GalaxyImage {
  constructor(densityMap, { planeGalacticHeight = -21 } = {}) {
    const area = densityMap.area;
    this.material = new MeshBasicMaterial({
      map: densityMap.texture,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    const planeGeometry = new PlaneGeometry(area.widthInLightYears, area.widthInLightYears);
    // PlaneGeometry stands upright with the top of the image towards +y.
    // Laying it down with -90 degrees about x puts the top of the image
    // towards scene -z, which is galactic +z: the far side of the galaxy.
    planeGeometry.rotateX(-Math.PI / 2);
    this.sceneObject = new Mesh(planeGeometry, this.material);
    this.sceneObject.position.set(area.centreX, planeGalacticHeight, galacticZToSceneZ(area.centreZ));
    this.sceneObject.name = 'galaxy image';
    this.sceneObject.renderOrder = -30;
  }

  updateForCamera({ cameraDistanceFromTarget, opacity }) {
    const farViewAmount = Math.min(Math.max((cameraDistanceFromTarget - 15000) / 45000, 0), 1);
    this.material.opacity = 0.4 * farViewAmount * opacity;
    this.sceneObject.visible = this.material.opacity > 0.002;
  }

  dispose() {
    this.sceneObject.geometry.dispose();
    this.material.dispose();
  }
}
