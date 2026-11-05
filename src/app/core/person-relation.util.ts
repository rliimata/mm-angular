/** Reverse person-relation labels (PHP get_reverse_relation / get_reverse_relationid). */

export function reverseRelationLabel(relationId: number, sourceGender: number): string {
  const male = sourceGender === 0;
  switch (relationId) {
    case 1:
    case 2:
      return male ? 'Poika' : 'Tytär';
    case 3:
    case 4:
      return male ? 'Veli' : 'Sisko';
    case 5:
    case 6:
      return male ? 'Isä' : 'Äiti';
    case 7:
    case 8:
      return male ? 'Veljen-/siskonpoika' : 'Veljen-/siskontytär';
    case 9:
    case 10:
      return male ? 'Setä/eno' : 'Täti';
    case 11:
      return 'Serkku';
    case 12:
    case 13:
      return male ? 'Kummipoika' : 'Kummityttö';
    case 14:
    case 15:
      return male ? 'Kummisetä' : 'Kummitäti';
    case 16:
    case 17:
      return male ? 'Lapsen poika' : 'Lapsen tytär';
    case 18:
    case 19:
      return male ? 'Isoisä' : 'Isoäiti';
    default:
      return '';
  }
}

/** Sort key for reverse relations (numeric id; serkku → 11). */
export function reverseRelationSortId(relationId: number, sourceGender: number): number {
  const male = sourceGender === 0;
  switch (relationId) {
    case 1:
    case 2:
      return male ? 5 : 6;
    case 3:
    case 4:
      return male ? 3 : 4;
    case 5:
    case 6:
      return male ? 1 : 2;
    case 7:
    case 8:
      return male ? 9 : 10;
    case 9:
    case 10:
      return male ? 7 : 8;
    case 11:
      return 11;
    case 12:
    case 13:
      return male ? 14 : 15;
    case 14:
    case 15:
      return male ? 12 : 13;
    case 16:
    case 17:
      return male ? 18 : 19;
    case 18:
    case 19:
      return male ? 16 : 17;
    default:
      return relationId;
  }
}
