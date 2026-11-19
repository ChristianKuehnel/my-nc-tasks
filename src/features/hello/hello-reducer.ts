/**
 * Phase 0.5 Hello World state logic (issue #4).
 *
 * The counter logic is a pure reducer so it can be unit tested without a
 * renderer. The screen (src/app/index.tsx) is a thin wrapper around it.
 */

export type HelloState = Readonly<{
  /** Number of times the Hello World button has been pressed. */
  count: number;
}>;

export type HelloAction = Readonly<{
  type: 'increment';
}>;

export const initialHelloState: HelloState = { count: 0 };

export function helloReducer(state: HelloState, action: HelloAction): HelloState {
  switch (action.type) {
    case 'increment':
      return { count: state.count + 1 };
    default:
      return state;
  }
}
