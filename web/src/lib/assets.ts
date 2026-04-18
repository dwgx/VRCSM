const assetRevision = __VRCSM_ASSET_REV__;

function withAssetRevision(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${normalizedPath}${separator}rev=${encodeURIComponent(assetRevision)}`;
}

export const APP_ICON_URL = withAssetRevision("/app-icon.png");
export const SPECIAL_THANKS_1033484989_URL = withAssetRevision("/special-thanks-1033484989.png");

