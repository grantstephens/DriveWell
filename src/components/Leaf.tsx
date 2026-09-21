import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * The leaf. One silhouette, colored by the caller — domain/leaf.ts decides
 * what color a given smoothness maps to; this component only draws it.
 */
export function Leaf({ color, size = 220 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" testID="leaf">
      <Path
        testID="leaf-path"
        d="M100,12 C165,45 185,115 100,188 C15,115 35,45 100,12 Z"
        fill={color}
      />
      <Path d="M100,178 L100,32" stroke="#00000022" strokeWidth={3} />
    </Svg>
  );
}
