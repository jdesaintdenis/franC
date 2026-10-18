/** The form values the badge counts; a server page calls it, so it cannot live in the client filters sheet. */
export interface CountableFilters {
  from: string;
  to: string;
  category: string;
  account: string;
  tag: string;
  min: string;
  max: string;
  direction: string;
  transfers: string;
  ignored: string;
  review: string;
}

/** How many filters are on (the Filtres button's badge). */
export function countActiveFilters(values: CountableFilters): number {
  return (
    (values.from || values.to ? 1 : 0) +
    (values.category ? 1 : 0) +
    (values.account ? 1 : 0) +
    (values.tag ? 1 : 0) +
    (values.min || values.max ? 1 : 0) +
    (values.direction !== "all" ? 1 : 0) +
    (values.transfers ? 1 : 0) +
    (values.ignored ? 1 : 0) +
    (values.review ? 1 : 0)
  );
}
