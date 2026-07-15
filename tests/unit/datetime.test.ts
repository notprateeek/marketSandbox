import { describe, it, expect } from 'vitest';
import { formatIST, formatISTDate, formatISTTime, formatISTDateTime } from '@/lib/finance/datetime';

describe('Datetime Formatter', () => {
  // Use a fixed date for reliable testing: 2026-07-14T12:00:00.000Z
  const fixedDate = new Date('2026-07-14T12:00:00.000Z');

  describe('formatIST', () => {
    it('formats date in IST timezone correctly', () => {
      expect(formatIST(fixedDate)).toBe('14/7/2026');
    });
  });

  describe('formatISTDate', () => {
    it('formats as short date', () => {
      expect(formatISTDate(fixedDate)).toBe('14 Jul 2026');
    });
  });

  describe('formatISTTime', () => {
    it('formats as time string', () => {
      // Node 18+ Intl.DateTimeFormat might produce variations in non-breaking spaces or similar,
      // so checking for general format is safer than exact strict equality if locales differ slightly.
      // But we will test strict assuming standard Node output for en-IN
      const timeStr = formatISTTime(fixedDate);
      expect(timeStr).toMatch(/5:30:00\s(pm|PM)/i);
    });
  });

  describe('formatISTDateTime', () => {
    it('formats as full datetime', () => {
      const dtStr = formatISTDateTime(fixedDate);
      expect(dtStr).toMatch(/14 Jul 2026,\s5:30\s(pm|PM)/i);
    });
  });
});
