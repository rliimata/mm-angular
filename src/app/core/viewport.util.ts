/** Phone-only: hide edit entry points and block edit routes. Pads keep editing. */
export const PHONE_MEDIA_QUERY = '(max-width: 640px)';

export function isPhoneViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(PHONE_MEDIA_QUERY).matches
  );
}
