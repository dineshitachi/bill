export const MAX_LOGO_DATA_URL_LENGTH = 240_000;

const companyLogoPattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isCompanyLogoDataUrl(value: string): boolean {
  return value.length <= MAX_LOGO_DATA_URL_LENGTH && companyLogoPattern.test(value);
}
