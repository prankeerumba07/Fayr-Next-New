// AM I BEING DRAWN INSIDE THE JOURNEY?
//
// Every journey screen can also be opened on its own, and the two cases want
// different spacing at the top: on its own a screen owns the space above its body,
// and inside the journey the strip above it already owns that space. See
// src/ui/journeySpacing.js for the measurements and where they come from.
//
// A CONTEXT, NOT A PROP, and that is the same choice already made one line away in
// JourneyScreen for the notch: passing a flag down into a dozen screens means a
// dozen places that can forget to pass it on. The router says it once, everything
// inside hears it, and a screen opened on its own hears nothing and behaves exactly
// as it did before.
import { createContext, useContext } from 'react';

/** False everywhere except inside the journey's own stage. */
export const InsideJourneyContext = createContext(false);

/** True when the thing calling this is being drawn inside the journey. */
export function useInsideJourney() {
  return useContext(InsideJourneyContext) === true;
}
