import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/**
 * The leaf. `MaterialCommunityIcons`'s "leaf-maple" glyph is the artwork —
 * a real, detailed silhouette (five lobes, branching veins) rather than a
 * hand-drawn approximation — tinted by the caller's color. domain/leaf.ts
 * still owns what color a given smoothness maps to; this component only
 * draws it, plus a soft radial glow behind it that grows with smoothness so
 * a fully green leaf visibly radiates rather than just changing color.
 *
 * The glow uses `smoothness²` rather than smoothness directly: barely
 * visible through the middle of the range, so it reads as a payoff that
 * arrives near the top rather than a linear gauge.
 */
export function Leaf({
  color,
  smoothness,
  size = 220,
}: {
  color: string;
  /** 0-100, the same value that produced `color`. Drives the glow's intensity. */
  smoothness: number;
  size?: number;
}) {
  const glowIntensity = (Math.min(100, Math.max(0, smoothness)) / 100) ** 2;
  const glowSize = size * 1.8;

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
      <MaterialCommunityIcons name="leaf-maple" size={size} color={color} testID="leaf-path" />
    </View>
  );
}
