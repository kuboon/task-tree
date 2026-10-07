/**
 * The social cards: one PNG per page, drawn on request.
 *
 * A page already says what its card should say — `title` and `description` are the two things
 * every page module exports — so a card is registered from the same values the `<head>` gets,
 * rather than from a second list of pages that could fall out of step with the first.
 *
 * `ogImage()` does both halves at once: it records how to draw the card and hands back the URL to
 * put in `<meta property="og:image">`. That is what keeps the two in step — there is no way to
 * register a card without getting its URL, and none to write the URL without registering the card.
 *
 * The registration is eager and the drawing is not: what a card says may be worked out when it is
 * first asked for (an article's title lives in a file), so the dev server does not read every
 * article at startup to fill in cards nobody may ask for.
 *
 * Where the site is deployed comes from `RP_ORIGIN` (`config.ts`). `og:image` is fetched by
 * someone else's server, from someone else's page, so a path is not an address — which is why a
 * server with no configured origin writes the tag relative rather than inventing a host.
 */

import { getConfig } from "../config.ts";
import { type Card, renderCard } from "./card.ts";

/** The eyebrow every card carries unless a page asks for its own. */
const SITE_NAME = "Task Tree";

/** What a page tells its card — the two things every page module already exports. */
export interface OgPage {
  title: string;
  description?: string;
  /** The small line above the title. Defaults to the site's name. */
  eyebrow?: string;
}

/**
 * Where the site is deployed, or `null` when nobody said.
 *
 * `RP_ORIGIN` is the app's public origin; locally it is unset and there is no origin — so a local
 * server has no absolute URL to write, and says so rather than guessing one.
 */
const siteUrl = ((): URL | null => {
  const raw = getConfig().rpOrigin.trim();
  return /^https?:\/\//.test(raw) ? new URL(raw) : null;
})();

/** Image path -> how to fill in its card. */
const cards = new Map<string, () => OgPage | Promise<OgPage>>();

/**
 * Registers a page's card and returns the URL to point `og:image` at.
 *
 * @param pagePath The page's own path, as `href()` gives it
 * @param page What the card says, or a function returning it when the page has to be read first
 * @returns The card's URL: absolute when the deploy origin is known, and a path when it is not
 */
export function ogImage(
  pagePath: string,
  page: OgPage | (() => OgPage | Promise<OgPage>),
): string {
  const path = imagePath(pagePath);
  cards.set(path, typeof page === "function" ? page : () => page);
  return siteUrl ? new URL(path, siteUrl.origin).href : path;
}

/**
 * Serves one card.
 *
 * @param request The request, as the wildcard route received it
 * @returns The PNG, or a 404 for a path no page registered
 */
export async function serveOgImage(request: Request): Promise<Response> {
  const path = decodeURIComponent(new URL(request.url).pathname);
  const page = cards.get(path);
  if (page === undefined) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(await renderCard(toCard(path, await page())), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}

/**
 * The card for a page, filled out.
 *
 * The footer is the page's own address rather than anything the page said: a card is read away
 * from the site, and where it came from is the one thing its own words never say.
 *
 * @param path The card's path
 * @param page What the page told it
 * @returns The card, ready to draw
 */
function toCard(path: string, page: OgPage): Card {
  const location = path.replace(/^\/og\//, "/").replace(
    /(?:index)?\.png$/,
    "",
  );

  return {
    eyebrow: page.eyebrow ?? SITE_NAME,
    title: page.title,
    description: page.description,
    footer: siteUrl ? `${siteUrl.host}${location}` : location,
  };
}

/**
 * The card's path for a page's path.
 *
 * `/blog` becomes `/og/blog.png` and the home page becomes `/og/index.png`.
 *
 * @param pagePath The page's path
 * @returns The card's path
 */
function imagePath(pagePath: string): string {
  const within = decodeURIComponent(pagePath).replace(/^\/+|\/+$/g, "");
  return `/og/${within === "" ? "index" : within}.png`;
}
