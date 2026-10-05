/**
 * What the Drive screen does besides colouring the leaf — the pure rules
 * behind its effects, kept out of the components so they can be tested
 * without animating anything.
 *
 * The design rule: the *level* of how the drive is going is shown calmly
 * (colour, a drooping leaf, a soft glow at the screen edge — something a
 * driver registers in peripheral vision, never anything that flashes), and a
 * one-off *event* gets one brief effect and then silence. A screen that
 * keeps moving while you drive well, or twitches on every bump, is a
 * distraction, which is the opposite of the point.
 */

/** At and above this smoothness nothing is shown: ordinary smooth driving lives here. */
const SEVERITY_ZERO_AT = 88;
/** At and below this smoothness the warning is at full strength. */
const SEVERITY_FULL_AT = 35;

/**
 * leafSeverity is how wrong things look, 0 (fine) to 1 (as bad as it gets):
 * the one number the leaf's droop and the screen-edge glow are both driven
 * from, so they always agree with each other and with the colour.
 */
export function leafSeverity(smoothness: number): number {
  const s = (SEVERITY_ZERO_AT - smoothness) / (SEVERITY_ZERO_AT - SEVERITY_FULL_AT);
  return Math.min(1, Math.max(0, s));
}

/**
 * edgeGlowLevels splits a severity into how much amber and how much red glow
 * to show: amber builds first and peaks halfway, then hands over to red.
 * Both are 0-1; the component decides how strong "1" actually looks.
 */
export function edgeGlowLevels(severity: number): { amber: number; red: number } {
  const red = Math.min(1, Math.max(0, (severity - 0.5) / 0.5));
  const amber = Math.min(1, severity / 0.5) * (1 - red);
  return { amber, red };
}

/** Smoothness below which a drop counts as an impact. */
const IMPACT_BELOW = 65;
/**
 * Smoothness at or above which an impact can happen again. Lower than
 * RECOVER_AT on purpose: a rough road can sit in the 80s all the way and never
 * reach "green", and a genuinely harsh event on it must still register.
 */
const ARM_AT = 75;
/** Smoothness back at or above which a rough patch counts as recovered. */
const RECOVER_AT = SEVERITY_ZERO_AT;

export type LeafEvent = 'impact' | 'recovery';

/**
 * LeafEventDetector turns the smoothness reading into at most one 'impact'
 * per rough patch and one 'recovery' when it ends. Hysteresis does the work:
 * after an impact it stays quiet until smoothness has climbed back to ARM_AT,
 * so a long rough road hovering around the threshold produces one ripple, not
 * a strobe. A drive that *starts* rough isn't an impact until it has been
 * better first, and its eventual recovery isn't rewarded either.
 */
export class LeafEventDetector {
  private armed = false;
  private hurt = false;

  update(smoothness: number): LeafEvent | null {
    if (!this.armed && smoothness >= ARM_AT) this.armed = true;
    if (this.armed && smoothness < IMPACT_BELOW) {
      this.armed = false;
      this.hurt = true;
      return 'impact';
    }
    if (this.hurt && smoothness >= RECOVER_AT) {
      this.hurt = false;
      return 'recovery';
    }
    return null;
  }
}
