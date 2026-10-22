import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dbStore, openDatabase } from '../src/db/index.js';
import { createProviders } from '../src/providers/index.js';
import { ServiceSettings } from '../src/settings.js';
import { createTestApp, fakeFetch, register, sineWav, testConfig } from './helpers.js';

describe('service keys entered in the app', () => {
  const { impl } = fakeFetch([['api.genius.com/search', { meta: { status: 200 }, response: { hits: [] } }]]);
  const t = createTestApp(createProviders(testConfig(), undefined, impl).list(), impl);
  after(t.cleanup);
  let owner: { auth: Record<string, string>; user: { owner: boolean } };
  let guest: { auth: Record<string, string>; user: { owner: boolean } };
  const services = async () =>
    Object.fromEntries(
      ((await t.request.get('/api/services').set(owner.auth).expect(200)).body as { id: string; configured: boolean; unofficial: boolean }[]).map(
        (s) => [s.id, s],
      ),
    );

  before(async () => {
    owner = await register(t.request, 'owner');
    guest = await register(t.request, 'guest');
  });

  it('lets only the first account manage keys', async () => {
    assert.equal(owner.user.owner, true);
    assert.equal(guest.user.owner, false);
    const me = await t.request.get('/api/auth/me').set(owner.auth).expect(200);
    assert.equal(me.body.user.owner, true);
    await t.request.get('/api/settings/keys').expect(401);
    await t.request.get('/api/settings/keys').set(guest.auth).expect(403);
    await t.request.put('/api/settings/keys').set(guest.auth).send({ values: { GENIUS_ACCESS_TOKEN: 'x' } }).expect(403);
    const keys = await t.request.get('/api/settings/keys').set(owner.auth).expect(200);
    assert.deepEqual(
      keys.body.map((k: { name: string; source: string | null }) => [k.name, k.source]),
      [
        ['SOUNDCLOUD_CLIENT_ID', null],
        ['SOUNDCLOUD_CLIENT_SECRET', null],
        ['SOUNDCLOUD_PUBLIC_CLIENT', null],
        ['GENIUS_ACCESS_TOKEN', null],
        ['JAMENDO_CLIENT_ID', null],
        ['YOUTUBE_API_KEY', null],
      ],
    );
  });

  it('switches services on at once and never sends secrets back', async () => {
    assert.equal((await services()).soundcloud.configured, false);
    const secret = 'super-secret-value-123456';
    const saved = await t.request
      .put('/api/settings/keys')
      .set(owner.auth)
      .send({ values: { SOUNDCLOUD_CLIENT_ID: 'client-id-abcdef-1234', SOUNDCLOUD_CLIENT_SECRET: secret, JAMENDO_CLIENT_ID: 'jam123' } })
      .expect(200);
    assert.ok(!JSON.stringify(saved.body).includes(secret), 'the secret is masked');
    const sc = saved.body.find((k: { name: string }) => k.name === 'SOUNDCLOUD_CLIENT_SECRET');
    assert.deepEqual([sc.source, sc.preview], ['app', '••••3456']);

    const now = await services();
    assert.equal(now.soundcloud.configured, true);
    assert.equal(now.soundcloud.unofficial, false);
    assert.equal(now.jamendo.configured, true);
  });

  it('turns Genius on without a restart', async () => {
    const up = await t.request
      .post('/api/tracks')
      .set(owner.auth)
      .field('title', 'Песня')
      .attach('audio', sineWav(), { filename: 'a.wav', contentType: 'audio/wav' })
      .expect(201);
    assert.equal((await t.request.get(`/api/tracks/${up.body.id}/genius`).expect(200)).body.configured, false);
    await t.request.put('/api/settings/keys').set(owner.auth).send({ values: { GENIUS_ACCESS_TOKEN: 'genius-token' } }).expect(200);
    assert.equal((await t.request.get(`/api/tracks/${up.body.id}/genius`).expect(200)).body.configured, true);
  });

  it('removes keys and switches to the keyless SoundCloud mode', async () => {
    await t.request
      .put('/api/settings/keys')
      .set(owner.auth)
      .send({ values: { SOUNDCLOUD_CLIENT_ID: null, SOUNDCLOUD_CLIENT_SECRET: '', SOUNDCLOUD_PUBLIC_CLIENT: '1' } })
      .expect(200);
    const now = await services();
    assert.equal(now.soundcloud.unofficial, true);
    await t.request.put('/api/settings/keys').set(owner.auth).send({ values: { SOUNDCLOUD_PUBLIC_CLIENT: '0' } }).expect(200);
    assert.equal((await services()).soundcloud.configured, false);
  });

  it('rejects unknown keys', async () => {
    await t.request.put('/api/settings/keys').set(owner.auth).send({ values: { JWT_SECRET: 'x' } }).expect(400);
  });
});

describe('ServiceSettings', () => {
  it('prefers the environment, keeps saved keys across restarts and drops a stale SoundCloud token', () => {
    const store = dbStore(openDatabase(':memory:'));
    const config = testConfig();
    const settings = new ServiceSettings(store, config, { GENIUS_ACCESS_TOKEN: 'from-env' });
    assert.equal(config.genius.accessToken, 'from-env');
    assert.equal(settings.isFromEnv('GENIUS_ACCESS_TOKEN'), true);

    store.set('soundcloud.app_token', '{"token":"old","expiresAt":9999999999999}');
    settings.save({ SOUNDCLOUD_CLIENT_ID: 'new-id', SOUNDCLOUD_CLIENT_SECRET: 'new-secret' });
    assert.equal(store.get('soundcloud.app_token'), '');
    assert.throws(() => settings.save({ GENIUS_ACCESS_TOKEN: 'other' }), /окружения/);

    const restarted = testConfig();
    new ServiceSettings(store, restarted, {});
    assert.equal(restarted.soundcloud.clientId, 'new-id');
    assert.equal(restarted.soundcloud.clientSecret, 'new-secret');
    assert.equal(restarted.genius.accessToken, null);
  });
});
