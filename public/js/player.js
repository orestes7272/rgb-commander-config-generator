import { splitDelay } from './core/rgba.js';

/**
 * Plays frames the way RGBcommander does: each frame is written to the board
 * (which takes a while over USB) and then held for its delay. Holds longer than
 * 255 ms are split into repeated frames on export, and each piece pays the
 * write time again, so the schedule is built from the split frames.
 */
export function buildSchedule(frames, { simulateHardware = true, frameWriteMs = 0 } = {}) {
  const schedule = [];
  frames.forEach((f, index) => {
    for (const delay of splitDelay(f.ms)) {
      schedule.push({ index, pins: f.pins, ms: delay + (simulateHardware ? frameWriteMs : 0) });
    }
  });
  return schedule;
}

export function scheduleLength(schedule) {
  return schedule.reduce((n, s) => n + s.ms, 0);
}

export class Player {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.timer = null;
    this.playing = false;
  }

  play(schedule, { speed = 1, startAt = 0 } = {}) {
    this.stop();
    if (!schedule.length) return;
    this.schedule = schedule;
    this.speed = speed;
    this.playing = true;
    this.step = startAt % schedule.length;
    this.next = performance.now();
    this.tick();
  }

  tick = () => {
    if (!this.playing) return;
    const entry = this.schedule[this.step];
    this.onFrame(entry.index, entry.pins, this.step);
    // Minimum 16 ms so 0 ms frames still show up for a screen refresh.
    this.next += Math.max(16, entry.ms / this.speed);
    this.step = (this.step + 1) % this.schedule.length;
    this.timer = setTimeout(this.tick, Math.max(0, this.next - performance.now()));
  };

  stop() {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
