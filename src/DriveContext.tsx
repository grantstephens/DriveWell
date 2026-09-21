import React, { createContext, useContext, useMemo, useState } from 'react';

import type { Store } from './domain/store';

export interface DriveValue {
  store: Store;
  /** revision changes whenever stored data changed underneath the screens. */
  revision: number;
  /** bump announces that stored data changed. */
  bump: () => void;
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

  const value = useMemo<DriveValue>(
    () => ({ store, revision, bump: () => setRevision((r) => r + 1) }),
    [store, revision],
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
