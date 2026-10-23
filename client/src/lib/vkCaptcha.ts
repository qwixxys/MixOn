import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * VK's "not a robot" check (VK ID captcha) when signing in to VK. Its page refuses to open inside soundFy's page, so
 * on the phone the native plugin (VkCaptchaPlugin.java) shows it in a window of its own and returns the success_token
 * VK's page receives once it is passed. Outside the app there is no such window, so the sign-in cannot clear it.
 */
interface VkCaptchaPlugin {
  open(options: { url: string }): Promise<{ token: string | null }>;
}

const plugin = registerPlugin<VkCaptchaPlugin>('VkCaptcha');

/** Whether the captcha page can be shown (only inside the Android app). */
export function canSolveVkCaptcha(): boolean {
  return Capacitor.isNativePlatform();
}

/** Opens VK's captcha page and resolves with its success_token, or null if the listener closed it. */
export async function solveVkCaptcha(page: string): Promise<string | null> {
  const { token } = await plugin.open({ url: page });
  return token;
}
