import { helloReducer, initialHelloState } from '@/features/hello/hello-reducer';

describe('helloReducer (Phase 0.5 counter logic)', () => {
  it('starts at zero', () => {
    expect(initialHelloState.count).toBe(0);
  });

  it('increments by one per action', () => {
    const once = helloReducer(initialHelloState, { type: 'increment' });
    expect(once.count).toBe(1);
    const twice = helloReducer(once, { type: 'increment' });
    expect(twice.count).toBe(2);
  });

  it('returns a new state object (no mutation)', () => {
    const next = helloReducer(initialHelloState, { type: 'increment' });
    expect(next).not.toBe(initialHelloState);
    expect(initialHelloState.count).toBe(0);
  });
});
