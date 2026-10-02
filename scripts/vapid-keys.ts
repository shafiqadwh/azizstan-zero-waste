/**
 * Prints a new VAPID key pair for web push (14-deployment §2 step 4), ready to paste into `.env`.
 *   local:     pnpm vapid:generate
 *   container: docker run --rm azizstan-zero-waste node scripts/vapid-keys.js   (no Node.js needed on the host)
 * Generate once: changing the keys later drops every phone's push subscription.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
