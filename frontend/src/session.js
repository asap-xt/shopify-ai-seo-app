// Minimal helpers. Works even when host/token are missing.
export function getHost() {
  const u = new URL(window.location.href);
  return u.searchParams.get('host') || '';
}

export function getShop() {
  const u = new URL(window.location.href);
  // pass-through shop if present; otherwise let user type it
  return u.searchParams.get('shop') || '';
}

// Optional: token exchange if you decide to use it later
export async function getSessionTokenOrNull() {
  try {
    // If you wire App Bridge v4, you can request a token here.
    // For now we return null to keep UI resilient.
    return null;
  } catch {
    return null;
  }
}
