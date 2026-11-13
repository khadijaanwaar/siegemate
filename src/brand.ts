/** The game's name and lines, in one place (renaming is a one-line change). */
export const APP_NAME = "Siegemate";
export const TAGLINE = "Living armies wage chess on your table.";
/** The build's git commit (set by the deploy), so a bug report can say which version it is. */
export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? "dev";
