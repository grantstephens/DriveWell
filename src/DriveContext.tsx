import React, { createContext, useContext, useMemo, useState } from 'react';

import { Capture } from './debug/capture';
import type { Store } from './domain/store';

export interface DriveValue {
  store: Store;
  /** revision changes whenever stored data changed underneath the screens. */
  revision: number;
  /** bump announces that stored data changed. */
  bump: () => void;
  /**
   * capture is the current app-session's per-sample diagnostic buffer (see
   * debug/capture.ts) — null until a drive has started at least once this
   * session. Lives here, not in Drive's own state, so Settings' "Export
   * last drive" action can read it after the Drive screen has moved on.
   */
  capture: Capture | null;
  /** startCapture begins a fresh capture, replacing any prior one, and returns it to push samples into. */
  startCapture: () => Capture;
}

const DriveReactContext = createContext<DriveValue | null>(null);

export function DriveProvider({
  store,
  children,
}: {
  store: Store;
  children: React.ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const [capture, setCapture] = useState<Capture | null>(null);

  const value = useMemo<DriveValue>(
    () => ({
      store,
      revision,
      bump: () => setRevision((r) => r + 1),
      capture,
      startCapture: () => {
        const c = new Capture();
        setCapture(c);
        return c;
      },
    }),
    [store, revision, capture],
  );

  return <DriveReactContext.Provider value={value}>{children}</DriveReactContext.Provider>;
}

export function useDrive(): DriveValue {
  const value = useContext(DriveReactContext);
  if (value === null) {
    throw new Error('useDrive must be used inside a DriveProvider');
  }
  return value;
}
