// A thin progress bar and status line along the bottom of the map, driven by
// the loadingProgress / loadingFinished / loadingFailed commands.

const BYTES_PER_MEGABYTE = 1048576;

export class LoadingOverlay {
  // mapText: the map's text (see mapText.js).
  constructor(containerElement, mapText) {
    this.mapText = mapText;
    // What the status line shows, kept so it can be shown again in new text.
    this.status = null;
    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      position: 'absolute', left: '0', right: '0', bottom: '0', padding: '6px 10px',
      font: '12px system-ui, sans-serif', color: '#b9d3e2', background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.6))',
      pointerEvents: 'none', display: 'none',
    });
    this.statusText = document.createElement('div');
    this.progressTrack = document.createElement('div');
    Object.assign(this.progressTrack.style, { height: '2px', marginTop: '4px', background: 'rgba(255, 255, 255, 0.12)' });
    this.progressBar = document.createElement('div');
    Object.assign(this.progressBar.style, { height: '100%', width: '0%', background: '#ff9a2e', transition: 'width 0.2s' });
    this.progressTrack.appendChild(this.progressBar);
    this.element.append(this.statusText, this.progressTrack);
    containerElement.appendChild(this.element);
    this.isEnabled = true;
  }

  // Switched off, it stays hidden whatever loading messages arrive.
  setEnabled(isEnabled) {
    this.isEnabled = isEnabled;
    if (!isEnabled) {
      this.hide();
    }
  }

  setText(mapText) {
    this.mapText = mapText;
    this.showStatus();
  }

  showProgress({ loadedBytes, totalBytes, systemCount }) {
    if (!this.isEnabled) {
      return;
    }
    this.element.style.display = 'block';
    this.progressTrack.style.display = 'block';
    const values = {
      systemCount,
      loadedMegabytes: Math.round(loadedBytes / BYTES_PER_MEGABYTE),
      totalMegabytes: Math.round(totalBytes / BYTES_PER_MEGABYTE),
    };
    if (totalBytes) {
      const fraction = Math.min(loadedBytes / totalBytes, 1);
      this.progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;
      this.status = { key: systemCount === undefined ? 'loadingOfSize' : 'loadingSystemsOfSize', values };
    } else {
      this.progressBar.style.width = '100%';
      this.status = { key: systemCount === undefined ? 'loading' : 'loadingSystems', values };
    }
    this.showStatus();
  }

  showStatus() {
    if (this.status !== null) {
      this.statusText.textContent = this.mapText.format(this.status.key, this.status.values);
    }
  }

  hide() {
    this.element.style.display = 'none';
  }

  showFailure(message) {
    if (!this.isEnabled) {
      return;
    }
    this.element.style.display = 'block';
    this.progressTrack.style.display = 'none';
    this.status = { key: 'loadingFailed', values: { message } };
    this.showStatus();
  }

  dispose() {
    this.element.remove();
  }
}
