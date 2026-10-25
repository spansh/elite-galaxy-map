// A thin progress bar and status line along the bottom of the map, driven by
// the loadingProgress / loadingFinished / loadingFailed commands.

function formatMegabytes(byteCount) {
    return `${(byteCount / 1048576).toFixed(0)} MB`;
}

export class LoadingOverlay {
    constructor(containerElement) {
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

    showProgress({ loadedBytes, totalBytes, systemCount }) {
        if (!this.isEnabled) {
            return;
        }
        this.element.style.display = 'block';
        this.progressTrack.style.display = 'block';
        const systemsText = systemCount === undefined ? '' : `${systemCount.toLocaleString()} systems, `;
        if (totalBytes) {
            const fraction = Math.min(loadedBytes / totalBytes, 1);
            this.progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;
            this.statusText.textContent = `Loading ${systemsText}${formatMegabytes(loadedBytes)} of ${formatMegabytes(totalBytes)}`;
        } else {
            this.progressBar.style.width = '100%';
            this.statusText.textContent = `Loading ${systemsText}${formatMegabytes(loadedBytes)}`;
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
        this.statusText.textContent = `Loading failed: ${message}`;
    }

    dispose() {
        this.element.remove();
    }
}
