/**
 * A few cross-screen notifications.
 *
 * The tier badge lives in the navigation and the control that changes it lives
 * on the settings screen, with the router between them. Rather than adding a
 * state library for one value, the settings screen announces the change and
 * anything showing the tier listens. Nothing else in the app shares state this
 * way, so the pattern stays easy to follow.
 */

const TIER_CHANGED = "rib:tier-changed";

export function announceTierChange(tier: string): void {
  window.dispatchEvent(new CustomEvent(TIER_CHANGED, { detail: tier }));
}

export function onTierChange(listener: (tier: string) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (typeof detail === "string") listener(detail);
  };
  window.addEventListener(TIER_CHANGED, handler);
  return () => window.removeEventListener(TIER_CHANGED, handler);
}
