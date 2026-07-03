type IpcKey<TMethod extends string, TParams> = readonly [TMethod, TParams];

const ipcKey = <TMethod extends string, TParams>(
  method: TMethod,
  params: TParams,
): IpcKey<TMethod, TParams> => [method, params] as const;

const rootKey = <TMethod extends string>(method: TMethod): readonly [TMethod] =>
  [method] as const;

export const qk = {
  auth: {
    root: rootKey("auth"),
    statusRoot: rootKey("auth.status"),
    meRoot: rootKey("user.me"),
    status: () => ipcKey("auth.status", undefined as undefined),
    me: () => ipcKey("user.me", undefined as undefined),
  },
  friends: {
    root: rootKey("friends.list"),
    list: () => ipcKey("friends.list", undefined as undefined),
    logRoot: rootKey("friendLog.recent"),
    logRecent: (params: Readonly<{ limit?: number; offset?: number }> = {}) =>
      ipcKey("friendLog.recent", params),
  },
  feed: {
    root: rootKey("feed.unified"),
    unified: (params: Readonly<Record<string, unknown>> = {}) =>
      ipcKey("feed.unified", params),
  },
  users: {
    root: rootKey("user.getProfile"),
    profileRoot: rootKey("user.getProfile"),
    profile: (userId: string) => ipcKey("user.getProfile", { userId }),
  },
  worlds: {
    root: rootKey("world.details"),
    detailsRoot: rootKey("world.details"),
    details: (id: string) => ipcKey("world.details", { id }),
  },
  avatars: {
    root: rootKey("avatar.details"),
    detailsRoot: rootKey("avatar.details"),
    historyRoot: rootKey("db.avatarHistory.list"),
    details: (id: string) => ipcKey("avatar.details", { id }),
    search: (params: Readonly<Record<string, unknown>>) =>
      ipcKey("avatar.search", params),
    history: (params: Readonly<Record<string, unknown>>) =>
      ipcKey("db.avatarHistory.list", params),
  },
  assets: {
    root: rootKey("assets.resolve"),
    resolveRoot: rootKey("assets.resolve"),
    resolve: (params: Readonly<Record<string, unknown>>) =>
      ipcKey("assets.resolve", params),
  },
  favorites: {
    listsRoot: rootKey("favorites.lists"),
    lists: () => ipcKey("favorites.lists", undefined as undefined),
    itemsRoot: rootKey("favorites.items"),
    items: (listName: string) => ipcKey("favorites.items", { list_name: listName }),
  },
  groups: {
    root: rootKey("groups.list"),
    listRoot: rootKey("groups.list"),
    list: () => ipcKey("groups.list", undefined as undefined),
  },
} as const;

export type QueryKeys = typeof qk;
