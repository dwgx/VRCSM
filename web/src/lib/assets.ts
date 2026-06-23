function qqAvatarUrl(qq: string, size: 100 | 140 | 640 = 640): string {
  return `https://q.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=${size}`;
}

export const APP_ICON_URL = qqAvatarUrl("136666451");
