import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness() {
  const instances: any[] = [];
  class Native extends EventTarget {
    src = ''; paused = true; currentTime = 0; hidden = false;
    pause() { this.paused = true; }
    load() { this.dispatchEvent(new Event('emptied')); }
    removeAttribute() { this.src = ''; }
  }
  const context: any = { EventTarget, Event, URL, performance, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {}, location: { origin: 'http://localhost:3000' },
    document: { createElement: () => ({}) },
    window: { YT: { Player: class {
      time = 0; destroyed = false;
      constructor(_: unknown, public options: any) { instances.push(this); }
      getCurrentTime() { return this.time; }
      getDuration() { return 120; }
      seekTo(time: number) { this.time = time; }
      playVideo() { this.options.events.onStateChange({ data: 3 }); this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.options.events.onStateChange({ data: 2 }); }
      destroy() { this.destroyed = true; }
    } } },
  };
  runInNewContext(readFileSync(new URL('../public/subtitles-player.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
  const native = new Native(), container = { hidden: true, append() {}, replaceChildren() {} };
  return { native, container, instances, player: context.subtitlePlayer(native, container) };
}

test('embedded player exposes playback and seek events without loading a local MP4', async () => {
  const { player, instances, native } = harness();
  const events: string[] = [];
  for (const name of ['play', 'pause', 'seeked', 'loadedmetadata']) player.addEventListener(name, () => events.push(name));
  player.src = 'https://www.youtube.com/watch?v=tpUx1nA3WqU'; await Promise.resolve();
  instances[0].options.events.onReady(); await player.ready;
  assert.equal(player.duration, 120); assert.equal(native.src, ''); assert.equal(native.hidden, true);
  await player.play(); assert.equal(player.paused, false); assert.ok(events.includes('play'));
  player.currentTime = 65; player.sample();
  assert.equal(player.currentTime, 65); assert.equal(player.seeking, false); assert.ok(events.includes('seeked'));
  player.pause(); assert.equal(player.paused, true); assert.ok(events.includes('pause'));
});

test('switching media ignores late iframe events and restores native playback', async () => {
  const { player, instances, native, container } = harness();
  player.src = 'https://www.youtube.com/watch?v=tpUx1nA3WqU'; await Promise.resolve();
  const pending = player.ready;
  player.src = '/example/story.mp3';
  instances[0].options.events.onReady(); await pending;
  instances[0].options.events.onStateChange({ data: 1 });
  assert.equal(instances[0].destroyed, true); assert.equal(player.embedded, false);
  assert.equal(native.hidden, false); assert.equal(container.hidden, true); assert.equal(native.src, '/example/story.mp3');
});

test('pausing before iframe readiness cancels a queued play request', async () => {
  const { player, instances } = harness();
  player.src = 'https://www.youtube.com/watch?v=tpUx1nA3WqU'; await Promise.resolve();
  const play = player.play(); player.pause();
  instances[0].options.events.onReady();
  await assert.rejects(play, /avbrutt/);
  assert.equal(player.paused, true);
});
