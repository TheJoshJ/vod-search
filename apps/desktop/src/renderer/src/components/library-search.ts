export type LibrarySearchSubmitAction = "search" | "clear" | "none"

export function getLibrarySearchSubmitAction(query: string, searched: boolean): LibrarySearchSubmitAction {
  if (query.trim()) return "search"
  return searched ? "clear" : "none"
}
