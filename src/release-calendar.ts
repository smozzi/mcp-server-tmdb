interface Env {
  TMDB_API_KEY?: string;
  TMDB_BASE_URL?: string;
}

interface ReleaseCalendarInput {
  country?: string;
  language?: string;
  genre?: string;
  days?: string;
  recentDays?: string;
  services?: string[];
  minRating?: string;
  maxResults?: string;
}

interface MovieSummary {
  id: number;
  title: string;
  release_date?: string;
  original_language?: string;
  vote_average: number;
  vote_count?: number;
  popularity?: number;
  overview: string;
  genre_ids?: number[];
}

interface MovieDetails extends MovieSummary {
  runtime?: number;
  genres?: Array<{ id: number; name: string }>;
  "watch/providers"?: WatchProvidersResponse;
}

interface TMDBListResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
}

interface WatchProvider {
  provider_name: string;
}

interface WatchProviderResult {
  link?: string;
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

interface WatchProvidersResponse {
  results: Record<string, WatchProviderResult>;
}

interface GenreResponse {
  genres: Array<{ id: number; name: string }>;
}

export interface ReleaseCalendarPick {
  id: number;
  title: string;
  year: string;
  releaseDate?: string;
  rating: number;
  runtime?: number;
  language?: string;
  genres: string[];
  overview: string;
  providers: {
    streaming: string[];
    rent: string[];
    buy: string[];
    link?: string;
  };
  watchLaterScore: number;
  releaseStatus: "released" | "upcoming";
  reasons: string[];
}

export interface ReleaseCalendarResult {
  generatedAt: string;
  country: string;
  language: string;
  genre: string;
  services: string[];
  windowStart: string;
  windowEnd: string;
  days: number;
  recentDays: number;
  picks: ReleaseCalendarPick[];
  familyBaseline: ReleaseCalendarPick[];
  providerReady: ReleaseCalendarPick[];
  decision: string[];
  notes: string[];
}

function normalizeCountry(country?: string): string {
  return (country || "IN").trim().slice(0, 2).toUpperCase() || "IN";
}

function normalizeLanguage(language?: string): string {
  return (language || "any").trim().toLowerCase() || "any";
}

function normalizeGenre(genre?: string): string {
  return (genre || "any").trim() || "any";
}

function normalizeServices(services?: string[]): string[] {
  return (services || []).map((service) => service.trim()).filter(Boolean);
}

function parseDays(days?: string): number {
  const parsed = Number(days || "90");
  if (!Number.isFinite(parsed)) return 90;
  return Math.min(180, Math.max(7, Math.round(parsed)));
}

function parseRecentDays(recentDays?: string): number {
  const parsed = Number(recentDays || "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(0, Math.round(parsed)));
}

function parseMinRating(minRating?: string): number {
  const parsed = Number(minRating || "0");
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(9, Math.max(0, parsed));
}

function parseMaxResults(maxResults?: string): number {
  const parsed = Number(maxResults || "8");
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(12, Math.max(3, Math.round(parsed)));
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function yearFrom(date?: string): string {
  return date?.split("-")[0] || "unknown";
}

function providerNames(providers?: WatchProvider[]): string[] {
  return providers?.map((provider) => provider.provider_name).filter(Boolean) || [];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serviceMatches(providers: string[], services: string[]): string[] {
  if (services.length === 0) return [];
  return providers.filter((provider) =>
    services.some((service) => {
      const providerKey = normalize(provider);
      const serviceKey = normalize(service);
      return providerKey.includes(serviceKey) || serviceKey.includes(providerKey);
    }),
  );
}

async function fetchFromTMDB<T>(
  env: Env,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!env.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is not configured.");
  }

  const baseUrl = env.TMDB_BASE_URL || "https://api.themoviedb.org/3";
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set("api_key", env.TMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") url.searchParams.set(key, value);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 400));
          continue;
        }
        throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
      }
      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TMDB request failed.");
}

async function genreIdFor(env: Env, genre: string): Promise<{ id?: number; available: string[] }> {
  const data = await fetchFromTMDB<GenreResponse>(env, "/genre/movie/list");
  const match = data.genres.find((item) => item.name.toLowerCase() === genre.toLowerCase());
  return {
    id: match?.id,
    available: data.genres.map((item) => item.name),
  };
}

function releaseStatus(releaseDate?: string): "released" | "upcoming" {
  if (!releaseDate) return "upcoming";
  return releaseDate <= isoDate(0) ? "released" : "upcoming";
}

function scorePick(
  movie: MovieDetails,
  countryProviders: WatchProviderResult | undefined,
  requestedServices: string[],
): number {
  const streaming = providerNames(countryProviders?.flatrate);
  const rent = providerNames(countryProviders?.rent);
  const buy = providerNames(countryProviders?.buy);
  const allProviders = [...streaming, ...rent, ...buy];
  let score = (movie.vote_average || 0) * 10;
  score += Math.min(movie.popularity || 0, 100) / 4;
  score += Math.min(movie.vote_count || 0, 1000) / 100;
  if (releaseStatus(movie.release_date) === "upcoming") score += 8;
  if (streaming.length > 0) score += 16;
  if (rent.length > 0 || buy.length > 0) score += 8;
  score += serviceMatches(allProviders, requestedServices).length * 18;
  return Math.round(score);
}

function toPick(movie: MovieDetails, country: string, requestedServices: string[]): ReleaseCalendarPick {
  const providers = movie["watch/providers"]?.results?.[country];
  const streaming = providerNames(providers?.flatrate);
  const rent = providerNames(providers?.rent);
  const buy = providerNames(providers?.buy);
  const allProviders = [...streaming, ...rent, ...buy];
  const preferredMatches = serviceMatches(allProviders, requestedServices);
  const status = releaseStatus(movie.release_date);
  const reasons = [
    status === "upcoming" ? "Upcoming in the selected release window." : "Recently released in the selected window.",
    movie.vote_average >= 7 ? "Strong early TMDB rating signal." : undefined,
    streaming.length > 0 ? "Subscription provider data is already available." : undefined,
    preferredMatches.length > 0 ? `Matches preferred services: ${preferredMatches.join(", ")}.` : undefined,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    id: movie.id,
    title: movie.title,
    year: yearFrom(movie.release_date),
    releaseDate: movie.release_date,
    rating: movie.vote_average || 0,
    runtime: movie.runtime,
    language: movie.original_language,
    genres: movie.genres?.map((genre) => genre.name) || [],
    overview: movie.overview,
    providers: {
      streaming,
      rent,
      buy,
      link: providers?.link,
    },
    watchLaterScore: scorePick(movie, providers, requestedServices),
    releaseStatus: status,
    reasons,
  };
}

function isFamilyBaseline(movie: ReleaseCalendarPick): boolean {
  const matureGenres = new Set(["Horror", "Thriller", "Crime", "War"]);
  return movie.rating >= 6.2 && !movie.genres.some((genre) => matureGenres.has(genre));
}

export async function buildReleaseCalendarWatchlist(
  env: Env,
  rawInput: ReleaseCalendarInput,
): Promise<ReleaseCalendarResult> {
  const country = normalizeCountry(rawInput.country);
  const language = normalizeLanguage(rawInput.language);
  const genre = normalizeGenre(rawInput.genre);
  const services = normalizeServices(rawInput.services);
  const days = parseDays(rawInput.days);
  const recentDays = parseRecentDays(rawInput.recentDays);
  const minRating = parseMinRating(rawInput.minRating);
  const maxResults = parseMaxResults(rawInput.maxResults);
  const windowStart = isoDate(-recentDays);
  const windowEnd = isoDate(days);
  const params: Record<string, string> = {
    region: country,
    sort_by: "popularity.desc",
    "primary_release_date.gte": windowStart,
    "primary_release_date.lte": windowEnd,
    "vote_average.gte": String(minRating),
    "vote_count.gte": "5",
    include_adult: "false",
  };

  const notes: string[] = [
    "Release windows use TMDB primary release dates and include recent releases plus upcoming titles.",
    "Provider availability is checked after discovery and may lag theatrical releases.",
  ];

  if (language !== "any") params.with_original_language = language;
  if (genre !== "any") {
    const genreMatch = await genreIdFor(env, genre);
    if (!genreMatch.id) {
      throw new Error(`Genre "${genre}" not found. Available genres: ${genreMatch.available.join(", ")}`);
    }
    params.with_genres = String(genreMatch.id);
  }

  const discovered = await fetchFromTMDB<TMDBListResponse<MovieSummary>>(env, "/discover/movie", params);
  const candidates = discovered.results.slice(0, 18);
  const detailedResults = await Promise.allSettled(
    candidates.map((movie) =>
      fetchFromTMDB<MovieDetails>(env, `/movie/${movie.id}`, {
        append_to_response: "watch/providers",
      }),
    ),
  );
  const detailed = detailedResults
    .filter((result): result is PromiseFulfilledResult<MovieDetails> => result.status === "fulfilled")
    .map((result) => result.value);
  if (detailed.length < candidates.length) {
    notes.push("Some release candidates were skipped because TMDB detail requests failed.");
  }

  const picks = detailed
    .map((movie) => toPick(movie, country, services))
    .sort((a, b) => b.watchLaterScore - a.watchLaterScore)
    .slice(0, maxResults);
  const providerReady = picks.filter((pick) =>
    pick.providers.streaming.length > 0 || pick.providers.rent.length > 0 || pick.providers.buy.length > 0,
  );
  const familyBaseline = picks.filter(isFamilyBaseline).slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    country,
    language,
    genre,
    services,
    windowStart,
    windowEnd,
    days,
    recentDays,
    picks,
    familyBaseline,
    providerReady,
    decision: [
      picks[0] ? `Track ${picks[0].title} first; it has the strongest release-window score.` : "No release-window candidates found.",
      providerReady[0] ? `${providerReady.length} picks already have provider data for ${country}.` : `No picks have provider data yet for ${country}.`,
      familyBaseline[0] ? `${familyBaseline.length} picks look safer as broad-room baselines.` : "No broad-room baseline picks survived the current filters.",
      services.length > 0 ? "Preferred services were boosted when provider data matched." : "Add services to make this more watch-now oriented.",
    ],
    notes,
  };
}

function formatRuntime(minutes?: number): string {
  if (!minutes) return "runtime unknown";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

function availabilityLine(pick: ReleaseCalendarPick): string {
  if (pick.providers.streaming.length > 0) return `Streaming: ${pick.providers.streaming.slice(0, 4).join(", ")}`;
  if (pick.providers.rent.length > 0) return `Rent: ${pick.providers.rent.slice(0, 4).join(", ")}`;
  if (pick.providers.buy.length > 0) return `Buy: ${pick.providers.buy.slice(0, 4).join(", ")}`;
  return "Availability: no providers found";
}

function renderPick(pick: ReleaseCalendarPick, index: number): string {
  return `${index + 1}. ${pick.title} (${pick.year}) - ID: ${pick.id}\n` +
    `Release: ${pick.releaseDate || "unknown"} | Status: ${pick.releaseStatus}\n` +
    `Rating: ${pick.rating.toFixed(1)}/10 | Runtime: ${formatRuntime(pick.runtime)} | Watch-later score: ${pick.watchLaterScore}\n` +
    `${availabilityLine(pick)}\n` +
    `Why: ${pick.reasons.join("; ") || "Release-window candidate."}\n` +
    `Overview: ${pick.overview}`;
}

export function releaseCalendarWatchlistSummary(result: ReleaseCalendarResult): string {
  const picks = result.picks.map(renderPick).join("\n---\n") || "No release-window candidates found.";
  const providerReady = result.providerReady.map(renderPick).join("\n---\n") || "No provider-ready picks found.";
  const familyBaseline = result.familyBaseline.map(renderPick).join("\n---\n") || "No family baseline picks found.";

  return `Release Calendar Watchlist\n` +
    `Country: ${result.country}\n` +
    `Language: ${result.language}\n` +
    `Genre: ${result.genre}\n` +
    `Window: ${result.windowStart} to ${result.windowEnd} (${result.recentDays} recent days + ${result.days} upcoming days)\n\n` +
    `Decision:\n${result.decision.map((line) => `- ${line}`).join("\n")}\n\n` +
    `Watch-Later Candidates:\n${picks}\n\n` +
    `Provider-Ready Picks:\n${providerReady}\n\n` +
    `Broad-Room Baseline:\n${familyBaseline}\n\n` +
    `Notes:\n${result.notes.map((note) => `- ${note}`).join("\n")}`;
}
