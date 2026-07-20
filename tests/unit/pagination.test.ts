import { describe, expect, it } from 'vitest';

import { cursorArgs, toPage } from '@/lib/pagination';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

describe('cursorArgs', () => {
  it('takes one extra row and skips the cursor on later pages', () => {
    expect(cursorArgs(undefined, 10)).toEqual({ take: 11 });
    expect(cursorArgs('id-9', 10)).toEqual({ take: 11, cursor: { id: 'id-9' }, skip: 1 });
  });
});

describe('toPage', () => {
  it('returns all rows and no cursor when the extra row is absent', () => {
    const page = toPage(rows(10), 10); // exactly a full page, no sentinel
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
  });

  it('trims the sentinel row and sets the next cursor to the last kept id', () => {
    const page = toPage(rows(11), 10); // limit+1 fetched
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe('id-9');
  });

  it('handles a short final page', () => {
    const page = toPage(rows(3), 10);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });
});
