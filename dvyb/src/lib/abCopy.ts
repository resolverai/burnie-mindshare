/**
 * A/B Copy selection for onboarding flow.
 * Copy B: random in [0, 0.49] (both inclusive) - existing Dvyb flow
 * Copy A: random in (0.49, 1] - wander-and-seek UI flow
 *
 * URL param: ?copy=a or ?copy=b - use this copy and persist to localStorage for consistency.
 * When param is not present: use stored value if set, otherwise random on first visit.
 *
 * For debugging: set dvyb_ab_copy_override in localStorage to "A" or "B" to force a copy.
 * Or set dvyb_ab_copy_random to a number 0-1 to override the random value.
 */
export type OnboardingCopy = "A" | "B";

const STORAGE_KEY_COPY = "dvyb_onboarding_copy";
const STORAGE_KEY_OVERRIDE = "dvyb_ab_copy_override";
const STORAGE_KEY_RANDOM = "dvyb_ab_copy_random";

export function getOnboardingCopy(): OnboardingCopy {
  if (typeof window === "undefined") return "B";

  const override = localStorage.getItem(STORAGE_KEY_OVERRIDE);
  if (override === "A" || override === "B") {
    return override;
  }

  let rand: number;
  const storedRandom = localStorage.getItem(STORAGE_KEY_RANDOM);
  if (storedRandom != null) {
    const parsed = parseFloat(storedRandom);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      rand = parsed;
    } else {
      rand = Math.random();
    }
  } else {
    rand = Math.random();
  }

  // Copy B: [0, 0.49] inclusive. Copy A: (0.49, 1]
  const copy: OnboardingCopy = rand >= 0 && rand <= 0.49 ? "B" : "A";
  localStorage.setItem(STORAGE_KEY_COPY, copy);
  return copy;
}

/** Returns the currently stored copy (from a previous getOnboardingCopy call). */
export function getStoredOnboardingCopy(): OnboardingCopy | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY_COPY);
  return stored === "A" || stored === "B" ? stored : null;
}

/**
 * Use this for page routing.
 * Priority: 1) URL param ?copy=a or ?copy=b, 2) stored copy (localStorage), 3) random (getOnboardingCopy).
 * When URL param is present, persist it to localStorage for consistency.
 */
export function getOnboardingCopyForPage(searchParams?: URLSearchParams | { get(key: string): string | null } | null): OnboardingCopy {
  if (typeof window === "undefined") return "B";

  const copyParam = searchParams?.get("copy")?.toLowerCase();
  if (copyParam === "a" || copyParam === "b") {
    const copy: OnboardingCopy = copyParam === "a" ? "A" : "B";
    localStorage.setItem(STORAGE_KEY_COPY, copy);
    return copy;
  }

  const stored = getStoredOnboardingCopy();
  if (stored) return stored;
  return getOnboardingCopy();
}
