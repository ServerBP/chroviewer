export const clock = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60))}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

/** Minutes, seconds and milliseconds, for telling apart cuts a few frames apart */
export const preciseClock = (seconds: number) => {
  const value = Math.max(0, seconds);
  return `${clock(value)}.${String(Math.floor((value % 1) * 1000)).padStart(3, '0')}`;
};

export const number = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : value.toFixed(Math.abs(value) >= 100 ? 0 : digits);

// Past 99% the decimal matters: 99.8% of pairs is not every pair
export const closerShare = (share: number) =>
  share >= 0.99 && share < 1 ? Math.min(99.9, share * 100).toFixed(1) : String(Math.round(share * 100));
