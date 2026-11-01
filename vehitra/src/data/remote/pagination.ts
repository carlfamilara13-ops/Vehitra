const PAGE_SIZE = 1000;

type PageFetcher<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export type FetchedPages<T> =
  | { ok: true; rows: T[] }
  | { ok: false; message: string };

export async function fetchAllPages<T>(fetchPage: PageFetcher<T>): Promise<FetchedPages<T>> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, message: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length === 0) return { ok: true, rows };
    from += page.length;
  }
}
