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

export interface OwnershipFormat {
  Id: number;
  OwnershipMovieId: number;
  MediaFormatId: number;
  Sequence: number;
  ReleasePictureId: number | null;
}

export interface OwnershipFormatDraft {
  mediaFormatId: number;
  releasePictureId: number | null;
  audioIds: number[];
  subtitleIds: number[];
}

export interface OwnershipMovieDraft {
  movieId: number;
  title: string;
  titleLanguageId: number | null;
  year: number | null;
  /** Stable reference for multi-check binding; kept in sync with formats. */
  formatIds: number[];
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
