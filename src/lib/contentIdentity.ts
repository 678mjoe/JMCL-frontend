/** Core 97b65186 set-version matches the first project ID OR slug, regardless
 * of provider. Refuse ambiguous selectors rather than guessing registry order.
 * This is advisory; the native CF bridge also checks a fresh Core listing. */
export function hasAmbiguousContentProject(entries: readonly { source: { provider: string; project_id?: string | null; slug?: string | null } }[], projectId: string): boolean {
  return entries.filter(({ source }) => source.provider !== "manual" && (source.project_id === projectId || source.slug === projectId)).length > 1;
}
