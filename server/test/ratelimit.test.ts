import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter } from '../src/lib/http.js';

describe('RateLimiter lanes', () => {
  it('lets a song about to play skip the queue, and what a listener waits on go before background work', async () => {
    const limiter = new RateLimiter(40);
    const order: string[] = [];
    const go = (lane: 'urgent' | 'normal' | 'background', name: string) => limiter.wait(lane).then(() => order.push(name));
    const started = Date.now();
    const all = [go('background', 'b1'), go('background', 'b2'), go('background', 'b3'), go('normal', 'n1')];
    // A queue of lookups is waiting; the song to play waits one interval, not for the queue.
    await go('urgent', 'play');
    assert.ok(Date.now() - started < 70, `urgent went next (${Date.now() - started} ms)`);
    await Promise.all(all);
    assert.deepEqual(order, ['b1', 'play', 'n1', 'b2', 'b3']);
  });

  it('spaces every request, urgent ones too', async () => {
    const limiter = new RateLimiter(30);
    const times: number[] = [];
    const lanes = ['normal', 'urgent', 'background', 'urgent'] as const;
    await Promise.all(lanes.map((lane) => limiter.wait(lane).then(() => times.push(Date.now()))));
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 28, `spaced: ${times.map((t) => t - times[0]).join(', ')}`);
  });
});
