import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { edgeGlowLevels } from '../domain/leafEffects';
import { animateTo } from './animation';

const AMBER = '#f9a825';
const RED = '#c62828';

/** How strong the glow is at its fullest (0-1): enough to notice in peripheral vision, never to dazzle. */
const GLOW_MAX_OPACITY = 0.6;
/** Red only starts breathing once it's properly red. */
const PULSE_FROM_RED = 0.3;
/** The pulse swings between this fraction of full strength and full — a breath, never a flash. */
const PULSE_LOW = 0.75;
const PULSE_HALF_PERIOD_MS = 1100;
const FADE_MS = 500;

/**
 * EdgeGlow washes the edges of the screen amber and then red as the drive
 * gets rougher. The centre stays clear. It's there for the corner of the
 * eye: a driver should be able to tell something's going wrong without
 * looking at the leaf, and without it ever demanding a look.
 *
 * Two fixed layers (amber, red) whose *opacity* is animated, rather than one
 * layer recoloured: opacity runs natively with no repaint, where recolouring
 * the gradient would redraw an SVG over the whole screen several times a
 * second.
 */
export function EdgeGlow({ severity, reduceMotion = false }: { severity: number; reduceMotion?: boolean }) {
  const { amber, red } = edgeGlowLevels(severity);
  const amberValue = useRef(new Animated.Value(amber)).current;
  const redValue = useRef(new Animated.Value(red)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      amberValue.setValue(amber);
      redValue.setValue(red);
      return undefined;
    }
    const fades = Animated.parallel([
      animateTo(amberValue, amber, FADE_MS, Easing.inOut(Easing.quad)),
      animateTo(redValue, red, FADE_MS, Easing.inOut(Easing.quad)),
    ]);
    fades.start();
    return () => fades.stop();
  }, [amber, red, reduceMotion, amberValue, redValue]);

  const pulsing = !reduceMotion && red > PULSE_FROM_RED;
  useEffect(() => {
    if (!pulsing) {
      pulse.setValue(1);
      return undefined;
    }
    const breathe = Animated.loop(
      Animated.sequence([
        animateTo(pulse, PULSE_LOW, PULSE_HALF_PERIOD_MS, Easing.inOut(Easing.sin)),
        animateTo(pulse, 1, PULSE_HALF_PERIOD_MS, Easing.inOut(Easing.sin)),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [pulsing, pulse]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="edge-glow">
      <Layer
        testID="edge-glow-amber"
        color={AMBER}
        opacity={Animated.multiply(amberValue, GLOW_MAX_OPACITY)}
      />
      <Layer
        testID="edge-glow-red"
        color={RED}
        opacity={Animated.multiply(Animated.multiply(redValue, pulse), GLOW_MAX_OPACITY)}
      />
    </View>
  );
}

function Layer({
  testID,
  color,
  opacity,
}: {
  testID: string;
  color: string;
  opacity: Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number>;
}) {
  const id = `${testID}-gradient`;
  return (
    <Animated.View testID={testID} style={[StyleSheet.absoluteFill, { opacity }]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="72%">
            <Stop offset="55%" stopColor={color} stopOpacity={0} />
            <Stop offset="100%" stopColor={color} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}
