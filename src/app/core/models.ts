/** Postgres composite datetime(year, month, day, hour, minute, second, millisecond) */
export interface AppDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export interface Movie {
  Id: number;
  Title: string;
  Year: number | null;
  VersionId: number | null;
  RatioId: number | null;
  DistributionId: number | null;
  TitleLanguageId: number | null;
  Age: number | null;
  Pal: number | null;
  Ntsc: number | null;
  Budget: number | null;
  CurrencyId: number | null;
  TmdbId: number | null;
}

export interface Person {
  Id: number;
  Name: string;
  RealName: string | null;
  BirthCountryId: number | null;
  DeathCountryId: number | null;
  DeathReasonId: number | null;
  Type: number | null;
  Gender: number | null;
  BirthDate: AppDateTime | string | null;
  DeathDate: AppDateTime | string | null;
}

export interface AppUser {
  Id: number;
  Email: string;
  FirstName: string;
  LastName: string;
  SuperUser: number;
  AuthUserId: string | null;
  LastLogin: AppDateTime | string | null;
}

export interface UserLink {
  MovieId: number;
  UserId: number;
  ScoreId: number | null;
  Text: string | null;
}

export interface Ownership {
  Id: number;
  UserId: number;
  Name: string;
  Notes: string | null;
  ReleaseRegionId: number | null;
  ReleaseConditionId: number | null;
  ReleasePublisherId: number | null;
  OwnershipTypeId: number | null;
}

export interface OwnershipMovie {
  Id: number;
  OwnershipId: number;
  MovieId: number;
  Sequence: number;
}

/** OwnershipFormat.ContentType */
export const OWNERSHIP_CONTENT_FEATURE = 1;
export const OWNERSHIP_CONTENT_BONUS = 2;

export interface OwnershipFormat {
  Id: number;
  OwnershipMovieId: number;
  MediaFormatId: number;
  Sequence: number;
  ReleasePictureId: number | null;
  RatioId: number | null;
  ContentType: number;
  MediaConditionId: number | null;
}

export interface OwnershipFormatDraft {
  /** Local UI key so multiple rows can share the same MediaFormatId. */
  key: string;
  mediaFormatId: number;
  ratioId: number | null;
  /** 1 = Feature, 2 = Bonus Disc */
  contentType: number;
  /** Disc/cassette condition (ReleaseCondition id). */
  mediaConditionId: number | null;
  /**
   * Digital Copy only: true = physical disc (ask condition), false = code-only.
   * Ignored for other formats.
   */
  digitalHasDisc?: boolean;
  /** ReleaseAudio ids — e.g. Finnish dialogue checkbox. */
  audioIds: number[];
  /** ReleaseSubtitle ids — FI/EN checkboxes. */
  subtitleIds: number[];
  /**
   * Other movies that share this same physical medium
   * (cuts of the same film, or different titles on one disc).
   */
  linkedMovieIds?: number[];
  /**
   * Stable id for one physical medium across linked movies.
   * Persisted as OwnershipFormat.Sequence so reload can re-merge.
   */
  mediaGroupId?: number;
}

export interface OwnershipMovieDraft {
  movieId: number;
  title: string;
  titleLanguageId: number | null;
  year: number | null;
  /** Movie.RatioId (unused in UI after original-hint removal; kept for data). */
  ratioId: number | null;
  versionLabel?: string | null;
  formats: OwnershipFormatDraft[];
}

export interface OwnershipDraft {
  id?: number;
  name: string;
  notes: string;
  releaseRegionId: number | null;
  releaseConditionId: number | null;
  releasePublisherId: number | null;
  ownershipTypeId: number | null;
  movies: OwnershipMovieDraft[];
}

export interface LookupRow {
  Id: number;
  Value: string | number;
}
