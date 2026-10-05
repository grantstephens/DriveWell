import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * useReduceMotion follows the phone's "remove animations" accessibility
 * setting. Every effect on the Drive screen checks it: the information (the
 * colour, the droop, the glow) is still shown, it just appears at once and
 * holds still instead of fading, rippling or pulsing.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}
