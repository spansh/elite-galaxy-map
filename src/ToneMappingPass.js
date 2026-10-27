import {
  BufferAttribute, BufferGeometry, Color, HalfFloatType, Mesh, OrthographicCamera, Scene, ShaderMaterial, WebGLRenderTarget,
} from 'three';

// Millions of stars are drawn additively, so a dense region like the core
// adds up to far more light than a normal 8-bit canvas can hold and clips to
// flat white. Instead, the stars and backdrop are drawn into a half-float
// buffer, where brightness can go well past 1, and this pass then squeezes
// the highlights back into range (1 - e^(-light x exposure)). Faint areas
// come through almost unchanged; dense areas keep their shape instead of
// clipping.

const vertexShader = /* glsl */ `
  varying vec2 screenPosition;
  void main() {
    screenPosition = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D accumulatedLight;
  uniform float exposure;
  uniform vec3 backgroundColour;
  varying vec2 screenPosition;

  vec3 linearToSrgb(vec3 linearColour) {
    vec3 lowPart = linearColour * 12.92;
    vec3 highPart = 1.055 * pow(linearColour, vec3(1.0 / 2.4)) - 0.055;
    return mix(lowPart, highPart, step(vec3(0.0031308), linearColour));
  }

  void main() {
    vec3 light = texture2D(accumulatedLight, screenPosition).rgb;
    vec3 compressedLight = 1.0 - exp(-max(light, vec3(0.0)) * exposure);
    gl_FragColor = vec4(linearToSrgb(backgroundColour + compressedLight), 1.0);
  }
`;

export class ToneMappingPass {
  constructor({ backgroundColour, exposure = 1.2 }) {
    // Two buffers: one at full resolution, and a smaller one used while
    // the view is moving (see setResolutionScale). Keeping both avoids
    // reallocating one every time movement starts and stops.
    this.fullResolutionTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.reducedResolutionTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.accumulationTarget = this.fullResolutionTarget;
    this.drawingBufferWidth = 1;
    this.drawingBufferHeight = 1;
    this.reducedScale = 1;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        accumulatedLight: { value: this.accumulationTarget.texture },
        exposure: { value: exposure },
        backgroundColour: { value: new Color(backgroundColour) },
      },
      depthTest: false,
      depthWrite: false,
    });
    // One triangle that covers the whole screen.
    const triangle = new BufferGeometry();
    triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const fullScreenTriangle = new Mesh(triangle, this.material);
    fullScreenTriangle.frustumCulled = false;
    this.scene = new Scene();
    this.scene.add(fullScreenTriangle);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(drawingBufferWidth, drawingBufferHeight) {
    this.drawingBufferWidth = drawingBufferWidth;
    this.drawingBufferHeight = drawingBufferHeight;
    this.fullResolutionTarget.setSize(drawingBufferWidth, drawingBufferHeight);
    this.sizeReducedTarget();
  }

  sizeReducedTarget() {
    this.reducedResolutionTarget.setSize(
      Math.max(1, Math.round(this.drawingBufferWidth * this.reducedScale)),
      Math.max(1, Math.round(this.drawingBufferHeight * this.reducedScale)),
    );
  }

  // Draws the stars and backdrop at this fraction of full resolution (1 for
  // full). The result is stretched back up to fill the screen; text and
  // markers are always drawn at full resolution.
  setResolutionScale(scale) {
    if (scale >= 1) {
      this.accumulationTarget = this.fullResolutionTarget;
    } else {
      if (scale !== this.reducedScale) {
        this.reducedScale = scale;
        this.sizeReducedTarget();
      }
      this.accumulationTarget = this.reducedResolutionTarget;
    }
    this.material.uniforms.accumulatedLight.value = this.accumulationTarget.texture;
  }

  setExposure(exposure) {
    this.material.uniforms.exposure.value = exposure;
  }

  // Draws lightScene through the tone mapping, then overlayScene (labels
  // and markers) straight on top, so text stays crisp and true to colour.
  render(renderer, lightScene, overlayScene, camera) {
    const previousClearColour = renderer.getClearColor(new Color());
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.accumulationTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(lightScene, camera);
    renderer.setClearColor(previousClearColour, previousClearAlpha);

    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlayScene, camera);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.fullResolutionTarget.dispose();
    this.reducedResolutionTarget.dispose();
    this.material.dispose();
    this.scene.children[0].geometry.dispose();
  }
}
