import { buildFunnel, rate, THIN_BASE, worstDrop, type StepCount } from './funnel';

describe('rate', () => {
  it('is a percentage to one decimal place', () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(50, 200)).toBe(25);
    expect(rate(7, 7)).toBe(100);
  });

  it('is NULL over a base of zero, never 0 and never NaN', () => {
    // The whole reason this function exists rather than a bare division: a
    // screen showing "0%" for a step nobody reached reads as a failure, and a
    // NaN reads as a broken product.
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
  });

  it('refuses anything that is not a finite number', () => {
    expect(rate(NaN, 10)).toBeNull();
    expect(rate(10, NaN)).toBeNull();
    expect(rate(Infinity, 10)).toBeNull();
  });
});

describe('buildFunnel', () => {
  const steps: StepCount[] = [
    { key: 'opened', label: 'Opened the app', count: 1000 },
    { key: 'asked', label: 'Asked for a code', count: 600 },
    { key: 'verified', label: 'Entered the code', count: 540 },
    { key: 'setup', label: 'Finished setup', count: 300 },
  ];

  it('leaves the first step without a percentage', () => {
    const [first] = buildFunnel(steps);
    expect(first.ofPrevious).toBeNull();
    expect(first.ofStart).toBeNull();
    expect(first.dropped).toBe(0);
  });

  it('measures each step against the one before it AND against the top', () => {
    const [, asked, verified] = buildFunnel(steps);
    expect(asked.ofPrevious).toBe(60);
    expect(asked.ofStart).toBe(60);
    expect(verified.ofPrevious).toBe(90);
    expect(verified.ofStart).toBe(54);
  });

  it('counts the people who did not make it to the next step', () => {
    const [, asked, verified, setup] = buildFunnel(steps);
    expect(asked.dropped).toBe(400);
    expect(verified.dropped).toBe(60);
    expect(setup.dropped).toBe(240);
  });

  it('reports a step that GREW rather than pretending it did not', () => {
    // Real and ordinary over a fixed window: people who started setup yesterday
    // finish it today. Clamping this would hide something true.
    const grew = buildFunnel([
      { key: 'a', label: 'Started', count: 100 },
      { key: 'b', label: 'Finished', count: 120 },
    ]);
    expect(grew[1].count).toBe(120);
    expect(grew[1].ofPrevious).toBe(120);
    expect(grew[1].dropped).toBe(0);
  });

  it('marks a percentage as thin when hardly anybody reached the step above', () => {
    const tiny = buildFunnel([
      { key: 'a', label: 'Started', count: 4 },
      { key: 'b', label: 'Finished', count: 2 },
    ]);
    expect(tiny[1].ofPrevious).toBe(50);
    expect(tiny[1].thin).toBe(true);
  });

  it('stops calling it thin once the base is big enough', () => {
    const enough = buildFunnel([
      { key: 'a', label: 'Started', count: THIN_BASE },
      { key: 'b', label: 'Finished', count: 10 },
    ]);
    expect(enough[1].thin).toBe(false);
  });

  it('survives a funnel where nobody did anything', () => {
    const empty = buildFunnel([
      { key: 'a', label: 'Started', count: 0 },
      { key: 'b', label: 'Finished', count: 0 },
    ]);
    expect(empty[1].ofPrevious).toBeNull();
    expect(empty[1].dropped).toBe(0);
  });

  it('survives no steps at all', () => {
    expect(buildFunnel([])).toEqual([]);
  });
});

describe('worstDrop', () => {
  it('finds the step that lost the most people', () => {
    const built = buildFunnel([
      { key: 'a', label: 'A', count: 1000 },
      { key: 'b', label: 'B', count: 600 },
      { key: 'c', label: 'C', count: 550 },
      { key: 'd', label: 'D', count: 300 },
    ]);
    expect(worstDrop(built)?.key).toBe('b');
  });

  it('breaks a tie in favour of the EARLIER step', () => {
    // A leak high up costs more, because every step below it draws from what
    // survives this one.
    const built = buildFunnel([
      { key: 'a', label: 'A', count: 100 },
      { key: 'b', label: 'B', count: 80 },
      { key: 'c', label: 'C', count: 60 },
    ]);
    expect(worstDrop(built)?.key).toBe('b');
  });

  it('is null when nobody dropped out anywhere', () => {
    const built = buildFunnel([
      { key: 'a', label: 'A', count: 10 },
      { key: 'b', label: 'B', count: 10 },
    ]);
    expect(worstDrop(built)).toBeNull();
  });
});
