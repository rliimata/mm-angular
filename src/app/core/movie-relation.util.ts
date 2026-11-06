/**
 * Reverse MovieLink labels when viewing the destination movie.
 *
 * Link is stored as Source → Destination with RelationId describing the destination
 * relative to the source (e.g. Part One → Part Two / Jatkoa; Theatrical → DC).
 *
 * PHP get_label("IS_SEQUEL_TO") / get_label("ORIGINAL_VERSION").
 */
export function reverseMovieRelationLabel(relationId: number): string {
  switch (relationId) {
    case 1:
      return 'Jatkoa elokuvalle';
    case 2:
      return 'Remake elokuvasta';
    case 16:
      return 'Spin-off elokuvasta';
    case 17:
      return 'Reboot elokuvasta';
    case 3: // Special Edition
    case 4: // Director's Cut
    case 5: // Expanded version
    case 6: // TV-version
    case 7: // Lyhennetty versio
    case 8: // Sensuroimaton versio
    case 9: // Alkuperäinen versio (rare reverse storage)
    case 10: // US-versio
    case 11: // Pidennetty versio
    case 12: // Extended Edition
    case 13: // Teatteriversio
    case 14: // Videoversio
    case 15: // Workprint
      return 'Alkuperäisversio';
    default:
      return 'Elokuvalinkit';
  }
}
