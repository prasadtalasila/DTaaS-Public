import { z } from 'zod';
import { NAME, snapshotName } from '../snapshot/store.js';

// The extended form of a time in the basic form of the names of
// snapshots, such as 20261123T060000000Z
export const isoOf = (time: string): string =>
  time.replace(
    /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(\d{3})Z$/,
    '$1-$2-$3T$4:$5:$6.$7Z',
  );

// A real time in that form: 20261332T... has the form but is no time
const isTime = (time: string): boolean => {
  const date = new Date(isoOf(time));
  return (
    !Number.isNaN(date.getTime()) && snapshotName(date.toISOString()) === time
  );
};

// A time as an operator writes it, read as the extended form
export const timeSchema = z
  .string()
  .regex(NAME, 'must be a time in the form YYYYMMDDTHHMMSSmmmZ')
  .refine(isTime, 'must be a time in the form YYYYMMDDTHHMMSSmmmZ')
  .transform(isoOf);

// Milliseconds from the first time to the second, over the speed
export const gap = (from: string, to: string, speed: number): number =>
  Math.max(0, (Date.parse(to) - Date.parse(from)) / speed);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
