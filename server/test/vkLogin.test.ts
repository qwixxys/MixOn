import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { VK_USER_AGENT, VkProvider } from '../src/providers/vk.js';
import { createTestApp, fakeFetch, register } from './helpers.js';

const options = { apiVersion: '5.131', userAgent: VK_USER_AGENT };
const login = { username: '+79990000000', password: 'secret' };
const query = (url: string) => new URL(url).searchParams;
const twoFactor = {
  error: 'need_validation',
  error_description: 'sms sent, use code param',
  validation_type: '2fa_sms',
  validation_sid: 'sid-1',
  phone_mask: '+7 *** *** ** 00',
};

describe('VK sign-in with a login and password', () => {
  it('signs in as the official VK app', async () => {
    const { impl, calls } = fakeFetch([['oauth.vk.com/token', { access_token: 'vk-token', user_id: 1, expires_in: 0 }]]);
    const step = await new VkProvider(options, impl).loginWithPassword(login);
    assert.deepEqual(step, { status: 'ok', token: 'vk-token' });
    const params = query(calls[0].url);
    assert.equal(params.get('grant_type'), 'password');
    assert.equal(params.get('client_id'), '2274003');
    assert.equal(params.get('username'), '+79990000000');
    assert.equal(params.get('scope'), 'audio,offline');
    assert.equal(params.get('2fa_supported'), '1');
    assert.match((calls[0].init?.headers as Record<string, string>)['user-agent'], /^VKAndroidApp\//);
  });

  it('asks for the confirmation code, has VK send it, and accepts it', async () => {
    const { impl, calls } = fakeFetch([
      ['oauth.vk.com/token', (url: string) => (query(url).get('code') === '12345' ? { access_token: 'vk-token' } : twoFactor)],
      ['auth.validatePhone', { response: { sid: 'sid-1', delay: 60, validation_type: 'sms' } }],
    ]);
    const provider = new VkProvider(options, impl);
    const step = await provider.loginWithPassword(login);
    assert.deepEqual(step, { status: 'code', via: 'sms', phoneMask: '+7 *** *** ** 00', wrongCode: false });
    assert.equal(query(calls.find((c) => c.url.includes('auth.validatePhone'))!.url).get('sid'), 'sid-1');
    assert.deepEqual(await provider.loginWithPassword({ ...login, code: '12345' }), { status: 'ok', token: 'vk-token' });
  });

  it('says when the code is wrong', async () => {
    const { impl } = fakeFetch([['oauth.vk.com/token', { error: 'invalid_request', error_type: 'wrong_otp', error_description: 'Wrong code' }, 401]]);
    const step = await new VkProvider(options, impl).loginWithPassword({ ...login, code: '00000' });
    assert.equal(step.status === 'code' && step.wrongCode, true);
  });

  it('passes captchas back and forwards their answers', async () => {
    const page = 'https://id.vk.com/not_robot_captcha?session_token=abc';
    const { impl, calls } = fakeFetch([
      ['oauth.vk.com/token', (url: string) => (query(url).get('success_token') ? { access_token: 'vk-token' } : { error: 'need_captcha', redirect_uri: page })],
    ]);
    const provider = new VkProvider(options, impl);
    assert.deepEqual(await provider.loginWithPassword(login), { status: 'captcha', image: null, sid: null, page });
    assert.equal((await provider.loginWithPassword({ ...login, captchaToken: 'proof' })).status, 'ok');
    assert.equal(query(calls[1].url).get('success_token'), 'proof');

    const picture = fakeFetch([['oauth.vk.com/token', { error: 'need_captcha', captcha_sid: 77, captcha_img: 'https://api.vk.com/captcha.php?sid=77' }, 401]]);
    const pictureProvider = new VkProvider(options, picture.impl);
    assert.deepEqual(await pictureProvider.loginWithPassword(login), {
      status: 'captcha',
      image: 'https://api.vk.com/captcha.php?sid=77',
      sid: '77',
      page: null,
    });
    await pictureProvider.loginWithPassword({ ...login, captchaSid: '77', captchaKey: 'abcd' });
    assert.equal(query(picture.calls[1].url).get('captcha_key'), 'abcd');
  });

  it('explains wrong passwords and too many attempts', async () => {
    const wrong = fakeFetch([
      ['oauth.vk.com/token', { error: 'invalid_client', error_type: 'username_or_password_is_incorrect', error_description: 'Username or password is incorrect' }, 401],
    ]);
    await assert.rejects(new VkProvider(options, wrong.impl).loginWithPassword(login), /Неверный логин или пароль/);
    const flood = fakeFetch([['oauth.vk.com/token', { error: 'invalid_client', error_type: 'password_bruteforce_attempt' }, 401]]);
    await assert.rejects(new VkProvider(options, flood.impl).loginWithPassword(login), /слишком много попыток/);
  });
});

describe('POST /api/services/vk/login', () => {
  let audioUrl = 'https://cs1.vkuseraudio.net/1.mp3';
  const { impl } = fakeFetch([
    ['oauth.vk.com/token', (url: string) => (query(url).get('code') ? { access_token: 'vk-token' } : twoFactor)],
    ['auth.validatePhone', { response: {} }],
    ['users.get', { response: [{ id: 5, first_name: 'Иван', last_name: 'Петров' }] }],
    ['audio.get', () => ({ response: { count: 1, items: [{ id: 1, owner_id: 5, artist: 'A', title: 'B', duration: 100, url: audioUrl }] } })],
  ]);
  const t = createTestApp([new VkProvider(options, impl)], impl);
  after(t.cleanup);

  it('connects the account after the code, without keeping the password', async () => {
    const user = await register(t.request, 'listener');
    await t.request.post('/api/services/vk/login').send(login).expect(401);
    const first = await t.request.post('/api/services/vk/login').set(user.auth).send(login).expect(200);
    assert.equal(first.body.status, 'code');
    const done = await t.request.post('/api/services/vk/login').set(user.auth).send({ ...login, code: '123456' }).expect(200);
    assert.equal(done.body.status, 'ok');
    assert.equal(done.body.service.connected, true);
    assert.equal(done.body.service.account.displayName, 'Иван Петров');
    const services = await t.request.get('/api/services').set(user.auth).expect(200);
    assert.equal(services.body.find((s: { id: string }) => s.id === 'vk').canLogin, true);
    const stored = JSON.stringify(t.ctx.db.prepare('SELECT * FROM service_connections').all());
    assert.ok(stored.includes('vk-token') && !stored.includes('secret'), 'the token is kept, the password is not');
  });

  it('does not connect when VK gives no audio to the token', async () => {
    audioUrl = 'https://vk.com/mp3/audio_api_unavailable.mp3';
    const user = await register(t.request, 'second');
    const res = await t.request.post('/api/services/vk/login').set(user.auth).send({ ...login, code: '123456' }).expect(502);
    assert.match(res.body.error, /не даёт доступа к аудио/);
    const services = await t.request.get('/api/services').set(user.auth).expect(200);
    assert.equal(services.body.find((s: { id: string }) => s.id === 'vk').connected, false);
  });
});
