import { Animated, Easing } from 'react-native';

/**
 * Every effect animates only `opacity` and `transform`, which React Native can
 * run entirely on the native side: no React re-render and no JS-thread work per
 * frame. That matters here — the Drive screen once starved its own
 * accelerometer by repainting too much — and the whole app must stay light
 * while someone is driving. Tests flip `useNativeDriver` off (Jest has no
 * native driver, so values would never move) to observe the animation.
 */
export const animationConfig = { useNativeDriver: true };

/** animateTo eases `value` to `toValue` over `durationMs`. */
export function animateTo(
  value: Animated.Value,
  toValue: number,
  durationMs: number,
  easing: (t: number) => number = Easing.out(Easing.cubic),
): Animated.CompositeAnimation {
  return Animated.timing(value, {
    toValue,
    duration: durationMs,
    easing,
    useNativeDriver: animationConfig.useNativeDriver,
  });
}
