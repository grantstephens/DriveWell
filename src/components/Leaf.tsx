import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { animateTo } from './animation';

/** How far the leaf tips over, and how much it shrinks, at full droop. */
const WILT_DEGREES = -14;
const WILT_SCALE = 0.9;
const WILT_DROP_PX = 10;
const WILT_MS = 600;
const RIPPLE_MS = 800;
const BLOOM_MS = 1000;

/**
 * The leaf. `MaterialIcons`'s "eco" glyph is the artwork — a real, detailed
 * silhouette rather than a hand-drawn approximation — tinted by the
 * caller's color. domain/leaf.ts still owns what color a given smoothness
 * maps to; this component only draws it, plus a soft radial glow behind it
 * that grows with smoothness so a fully green leaf visibly radiates rather
 * than just changing color.
 *
 * The glow uses `smoothness²` rather than smoothness directly: barely
 * visible through the middle of the range, so it reads as a payoff that
 * arrives near the top rather than a linear gauge.
 *
 * On top of colour it carries the effects that don't depend on telling red
 * from green: it *wilts* (tips over and shrinks a little) as driving gets
 * rough and perks back up when it recovers; a single ring *ripples* out when
 * a harsh event lands; and a soft *bloom* swells when a rough patch is over.
 * All of it animates only opacity and transform, so none of it costs a
 * repaint, and with `reduceMotion` the wilt is applied at once and the
 * ripple and bloom are skipped altogether.
 */
export function Leaf({
  color,
  smoothness,
  size = 220,
  droop = 0,
  impactSignal = 0,
  recoverySignal = 0,
  reduceMotion = false,
}: {
  color: string;
  /** 0-100, the same value that produced `color`. Drives the glow's intensity. */
  smoothness: number;
  size?: number;
  /** 0 (upright) to 1 (fully wilted). */
  droop?: number;
  /** Increases by one each time a harsh event should ripple. Changing it is the trigger; mounting is not. */
  impactSignal?: number;
  /** Increases by one each time a recovery should bloom. */
  recoverySignal?: number;
  reduceMotion?: boolean;
}) {
  const glowIntensity = (Math.min(100, Math.max(0, smoothness)) / 100) ** 2;
  const glowSize = size * 1.8;

  const wilt = useRef(new Animated.Value(droop)).current;
  useEffect(() => {
    if (reduceMotion) {
      wilt.setValue(droop);
      return undefined;
    }
    const tween = animateTo(wilt, droop, WILT_MS, Easing.inOut(Easing.quad));
    tween.start();
    return () => tween.stop();
  }, [droop, reduceMotion, wilt]);

  const ripple = useRef(new Animated.Value(1)).current;
  const previousImpact = useRef(impactSignal);
  useEffect(() => {
    if (impactSignal === previousImpact.current) return;
    previousImpact.current = impactSignal;
    if (reduceMotion) return;
    ripple.setValue(0);
    animateTo(ripple, 1, RIPPLE_MS).start();
  }, [impactSignal, reduceMotion, ripple]);

  const bloom = useRef(new Animated.Value(1)).current;
  const previousRecovery = useRef(recoverySignal);
  useEffect(() => {
    if (recoverySignal === previousRecovery.current) return;
    previousRecovery.current = recoverySignal;
    if (reduceMotion) return;
    bloom.setValue(0);
    animateTo(bloom, 1, BLOOM_MS, Easing.inOut(Easing.quad)).start();
  }, [recoverySignal, reduceMotion, bloom]);

  const wiltStyle = {
    transform: [
      { translateY: wilt.interpolate({ inputRange: [0, 1], outputRange: [0, WILT_DROP_PX] }) },
      { rotate: wilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${WILT_DEGREES}deg`] }) },
      { scale: wilt.interpolate({ inputRange: [0, 1], outputRange: [1, WILT_SCALE] }) },
    ],
  };
  const ringSize = size * 1.15;

  return (
    <View
      style={{ width: glowSize, height: glowSize, alignItems: 'center', justifyContent: 'center' }}
      testID="leaf"
    >
      {glowIntensity > 0.02 && (
        <Svg
          width={glowSize}
          height={glowSize}
          style={StyleSheet.absoluteFill}
          testID="leaf-glow"
        >
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={color} stopOpacity={glowIntensity * 0.6} />
              <Stop offset="55%" stopColor={color} stopOpacity={glowIntensity * 0.22} />
              <Stop offset="100%" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill="url(#glow)" />
        </Svg>
      )}

      <Animated.View
        testID="leaf-bloom"
        pointerEvents="none"
        style={[
          styles.centred,
          {
            width: size * 1.3,
            height: size * 1.3,
            borderRadius: size * 0.65,
            backgroundColor: color,
            opacity: bloom.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.4, 0] }),
            transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.45] }) }],
          },
        ]}
      />
      <Animated.View
        testID="leaf-ripple"
        pointerEvents="none"
        style={[
          styles.centred,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: 3,
            borderColor: color,
            opacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.7] }) }],
          },
        ]}
      />

      <Animated.View testID="leaf-wilt" style={wiltStyle}>
        <MaterialIcons name="eco" size={size} color={color} testID="leaf-path" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  centred: { position: 'absolute' },
});
