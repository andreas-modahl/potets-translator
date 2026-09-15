let apiPromise;
function youtubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return apiPromise ||= new Promise((resolve, reject) => {
    const timer = setTimeout(() => { apiPromise = undefined; reject(new Error('YouTube svarte ikke. Last siden på nytt.')); }, 20000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT); };
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); apiPromise = undefined; reject(new Error('Kunne ikke laste YouTube-spilleren.')); };
    document.head.append(script);
  });
}

export function youtubeId(source) {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
      : ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
        ? (url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1]) : undefined;
    if (id && /^[\w-]{11}$/.test(id)) return id;
  } catch {}
}

/** Keep existing subtitle controls on one media interface for local and YouTube playback. */
export function subtitlePlayer(native, container) {
  class Player extends EventTarget {
    constructor() {
      super(); this.native = native; this.version = 0; this.playVersion = 0; this._position = 0; this._duration = NaN; this._rate = 1;
      this._paused = true; this._ended = false; this._seeking = false; this._readyState = 0;
      for (const name of ['play','playing','pause','ended','waiting','seeking','seeked','emptied','error','loadedmetadata','durationchange','timeupdate','ratechange','resize']) {
        native.addEventListener(name, () => { if (!this.embedded) this.emit(name); });
      }
    }
    emit(name) { this.dispatchEvent(new Event(name)); }
    get embedded() { return Boolean(this.id); }
    get src() { return this.embedded ? this.url : native.src; }
    set src(source) {
      this.reset();
      const id = youtubeId(source);
      if (!id) { native.src = source; return; }
      this.id = id; this.url = source; native.hidden = true; container.hidden = false;
      const version = this.version;
      this.ready = this.open(id, version).catch(error => {
        if (version === this.version) { this._error = { message: error.message }; this.emit('error'); }
      });
    }
    reset() {
      this.version++; this.playVersion++; clearInterval(this.timer); this.api?.destroy(); this.api = undefined;
      this.id = undefined; this.url = undefined; this._position = 0; this._duration = NaN;
      this._readyState = 0; this._paused = true; this._ended = false; this._seeking = false; this._error = undefined;
      this.seekTarget = undefined; this._rate = 1;
      container.replaceChildren(); container.hidden = true; native.hidden = false;
      native.pause(); native.removeAttribute('src'); native.load();
    }
    async open(id, version) {
      const YT = await youtubeApi(); if (version !== this.version) return;
      const mount = document.createElement('div'); container.append(mount);
      await new Promise((resolve, reject) => {
        this.api = new YT.Player(mount, { videoId: id, width: '100%', height: '100%',
          playerVars: { playsinline: 1, origin: location.origin, fs: 0, rel: 0 },
          events: {
            onReady: () => {
              if (version !== this.version) { resolve(); return; }
              this.timer = setInterval(() => this.sample(), 50); this.sample(); resolve();
            },
            onError: event => {
              if (version !== this.version) return;
              this._error = { message: `YouTube kan ikke spille denne videoen her (feil ${event.data}). Åpne den på YouTube.` };
              this.emit('error'); reject(new Error(this._error.message));
            },
            onStateChange: event => {
              if (version !== this.version) return;
              const wasPaused = this._paused;
              if (event.data !== 3) this._paused = event.data !== 1;
              this._ended = event.data === 0;
              this.sample();
              if (event.data === 1) { if (wasPaused) this.emit('play'); this.emit('playing'); }
              if (event.data === 2) this.emit('pause');
              if (event.data === 3) this.emit('waiting');
              if (event.data === 0) { this.emit('pause'); this.emit('ended'); }
            },
            onPlaybackRateChange: event => { if (version === this.version) { this._rate = event.data; this.emit('ratechange'); } },
            onAutoplayBlocked: () => { if (version === this.version) { this._paused = true; this.emit('pause'); this.emit('autoplayblocked'); } },
          } });
      });
    }
    sample() {
      if (!this.api?.getCurrentTime) return;
      const duration = this.api.getDuration();
      if (duration > 0 && duration !== this._duration) {
        const first = !this._readyState; this._duration = duration; this._readyState = 4;
        this.emit('durationchange'); if (first) { this.emit('loadedmetadata'); this.emit('resize'); }
      }
      const time = this.api.getCurrentTime();
      if (!Number.isFinite(time)) return;
      if (this.seekTarget !== undefined) {
        if (Math.abs(time - this.seekTarget) > .5 && performance.now() < this.seekDeadline) return;
        this.seekTarget = undefined; this._position = time; this._seeking = false; this.emit('seeked');
      } else if (Math.abs(time - this._position) > .5) {
        this._position = time; this._seeking = true; this.emit('seeking'); this._seeking = false; this.emit('seeked');
      }
      this._position = time; this.emit('timeupdate');
    }
    get currentTime() { return this.embedded ? this._position : native.currentTime; }
    set currentTime(time) {
      if (!this.embedded) { native.currentTime = time; return; }
      this._position = Math.max(0, Math.min(Number.isFinite(this.duration) ? this.duration : time, time));
      this.seekTarget = this._position; this.seekDeadline = performance.now() + 3000;
      this._seeking = true; this.emit('seeking'); this.api?.seekTo?.(this._position, true);
    }
    get duration() { return this.embedded ? this._duration : native.duration; }
    get paused() { return this.embedded ? this._paused : native.paused; }
    get ended() { return this.embedded ? this._ended : native.ended; }
    get seeking() { return this.embedded ? this._seeking : native.seeking; }
    get readyState() { return this.embedded ? this._readyState : native.readyState; }
    get error() { return this.embedded ? this._error : native.error; }
    get videoWidth() { return this.embedded ? 1280 : native.videoWidth; }
    get videoHeight() { return this.embedded ? 720 : native.videoHeight; }
    get playbackRate() { return this.embedded ? this._rate : native.playbackRate; }
    set playbackRate(rate) { if (this.embedded) this.api?.setPlaybackRate?.(rate); else native.playbackRate = rate; }
    get controls() { return native.controls; }
    set controls(value) { native.controls = value; }
    async play() {
      if (!this.embedded) return native.play();
      const version = this.version, playVersion = this.playVersion; await this.ready;
      if (version !== this.version || playVersion !== this.playVersion || this.error) throw new Error(this.error?.message || 'Avspillingen ble avbrutt.');
      this.api.playVideo();
    }
    pause() { this.playVersion++; if (this.embedded) this.api?.pauseVideo?.(); else native.pause(); }
    getAttribute(name) { return name === 'src' && this.embedded ? this.url : native.getAttribute(name); }
    removeAttribute(name) { if (name === 'src') this.reset(); else native.removeAttribute(name); }
    load() { if (!this.embedded) native.load(); }
    addTextTrack(...args) { return native.addTextTrack(...args); }
    get classList() { return native.classList; }
  }
  return new Player();
}
