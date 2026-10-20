// Image candidates beyond og:image: a YouTube thumbnail, a GitHub social preview, the first real image in the article.

const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const GITHUB = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/;
const GITHUB_RESERVED = new Set([
  "orgs",
  "topics",
  "features",
  "marketplace",
  "settings",
  "login",
  "sponsors",
  "about",
  "collections",
  "trending",
  "explore",
]);
const NOT_CONTENT = /logo|icon|avatar|pixel|1x1/i;

export function youtubeThumb(url: string): string | undefined {
  const m = url.match(YOUTUBE);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : undefined;
}

export function githubPreview(url: string): string | undefined {
  const m = url.match(GITHUB);
  if (!m || GITHUB_RESERVED.has(m[1])) return undefined;
  return `https://opengraph.githubassets.com/1/${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

export function firstContentImage(md: string | undefined): string | undefined {
  for (const m of (md ?? "").matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/g))
    if (!NOT_CONTENT.test(m[1])) return m[1];
  return undefined;
}

export function imageCandidates(input: {
  url: string;
  imageUrl?: string;
  contentMd?: string;
}): string[] {
  const all = [
    input.imageUrl,
    youtubeThumb(input.url),
    githubPreview(input.url),
    firstContentImage(input.contentMd),
  ];
  return [...new Set(all.filter((u): u is string => !!u))];
}
