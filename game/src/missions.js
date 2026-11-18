// The story of Solmar Bay: six missions for Danny Vale, a wheelman for hire.
// Each mission is a list of steps; a step is done when the player reaches its
// target (or survives its condition), then the next step begins. Rewards pay
// cash, and the final mission ends the story and unlocks free roam.

import { PLACES } from './city.js';
import { dist } from './util.js';

export const MISSIONS = [
  {
    id: 1,
    title: 'First Wheels',
    brief: "Vic needs a driver. Steal any car on the street, then bring it to Vic's Garage.",
    reward: 500,
    steps: [
      { kind: 'car', text: 'Get in a car — walk up to one and press E', target: null },
      { kind: 'goto', text: "Drive to Vic's Garage", target: PLACES.garage, radius: 90 },
    ],
  },
  {
    id: 2,
    title: 'The Pickup',
    brief: 'A package is waiting at the Solmar Docks. Fetch it, then drop it at Club Neón up north.',
    reward: 900,
    steps: [
      { kind: 'goto', text: 'Drive to the Solmar Docks', target: PLACES.docks, radius: 90 },
      { kind: 'goto', text: 'Deliver the package to Club Neón', target: PLACES.club, radius: 90 },
    ],
  },
  {
    id: 3,
    title: 'Hot Pursuit',
    brief: 'The Bay PD has your plate. Lose the heat — get your wanted level back to zero.',
    reward: 1200,
    steps: [
      { kind: 'wanted', text: 'The cops are on you — lose them (wanted level to 0)', target: null, wanted: 2 },
    ],
  },
  {
    id: 4,
    title: 'The Getaway',
    brief: 'Bank job went loud. Hit three drop points across town before the timer runs out — with the PD on your tail.',
    reward: 2000,
    timeLimit: 90,
    steps: [
      { kind: 'goto', text: 'Drop point 1 of 3 — Bay Federal Bank', target: PLACES.bank, radius: 90, wanted: 2 },
      { kind: 'goto', text: 'Drop point 2 of 3 — Palmetto Park', target: PLACES.park, radius: 90 },
      { kind: 'goto', text: 'Drop point 3 of 3 — Harbor View Tower', target: PLACES.rooftop, radius: 90 },
    ],
  },
  {
    id: 5,
    title: 'The Exchange',
    brief: 'Meet the contact in Palmetto Park. The meet is burned — shake a three-star wanted level after.',
    reward: 3000,
    steps: [
      { kind: 'goto', text: 'Meet the contact in Palmetto Park', target: PLACES.park, radius: 90 },
      { kind: 'wanted', text: 'The meet was a setup — lose the three-star heat', target: null, wanted: 3 },
    ],
  },
  {
    id: 6,
    title: 'King of Solmar',
    brief: 'One last run: the docks, the bank, the club — then home to the garage. Do it clean and the city is yours.',
    reward: 5000,
    timeLimit: 150,
    steps: [
      { kind: 'goto', text: 'Final run 1 of 4 — Solmar Docks', target: PLACES.docks, radius: 90, wanted: 3 },
      { kind: 'goto', text: 'Final run 2 of 4 — Bay Federal Bank', target: PLACES.bank, radius: 90 },
      { kind: 'goto', text: 'Final run 3 of 4 — Club Neón', target: PLACES.club, radius: 90 },
      { kind: 'goto', text: 'Final run 4 of 4 — home to Vic’s Garage', target: PLACES.garage, radius: 90 },
    ],
  },
];

/** Fresh mission progress: mission index and step index. */
export function freshMissionState() {
  return { index: 0, step: 0, timeLeft: null, banner: '', bannerT: 0, done: false, celebrated: false };
}

/** The mission currently in progress, or null when the story is finished. */
export function currentMission(state) {
  if (state.index >= MISSIONS.length) return null;
  return MISSIONS[state.index];
}

/** The step currently in progress, or null. */
export function currentStep(state) {
  const m = currentMission(state);
  if (!m) return null;
  return m.steps[state.step] ?? null;
}

/**
 * Advance the mission state for one frame. Returns an event string:
 * 'step' (step finished), 'mission' (mission finished), 'failed' (timer ran out)
 * or null. Mutates `state` and may set wanted levels through `hooks`.
 */
export function updateMission(state, player, wanted, hooks, dt) {
  const m = currentMission(state);
  if (!m) return null;
  let step = currentStep(state);
  if (!step) return null;

  // A step that sets a wanted level does so once, on entry.
  if (step.wanted !== undefined && !step._wantedSet) {
    step._wantedSet = true;
    hooks.setWanted(Math.max(wanted, step.wanted));
  }
  // A timed mission starts its clock on the first step.
  if (m.timeLimit && state.timeLeft === null) state.timeLeft = m.timeLimit;
  if (state.timeLeft !== null) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = null;
      return 'failed';
    }
  }

  let advance = false;
  if (step.kind === 'car') {
    if (player.inCar) advance = true;
  } else if (step.kind === 'goto') {
    if (step.target && dist(player.x, player.y, step.target.x, step.target.y) < step.radius) advance = true;
  } else if (step.kind === 'wanted') {
    if (wanted === 0) advance = true;
  }

  if (!advance) return null;
  state.step++;
  if (state.step >= m.steps.length) {
    // Mission complete: pay out and move on.
    player.cash += m.reward;
    hooks.onMissionDone(m);
    state.index++;
    state.step = 0;
    state.timeLeft = null;
    // Clear one-off flags on the next mission's steps.
    const next = currentMission(state);
    if (next) for (const s of next.steps) delete s._wantedSet;
    if (state.index >= MISSIONS.length) state.done = true;
    return 'mission';
  }
  return 'step';
}

/** Reset the current mission to its first step (after a timer failure). */
export function resetMission(state) {
  state.step = 0;
  state.timeLeft = null;
  const m = currentMission(state);
  if (m) for (const s of m.steps) delete s._wantedSet;
}
