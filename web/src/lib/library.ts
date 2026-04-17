import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useIpcQuery } from "@/hooks/useIpcQuery";
import { ipc } from "@/lib/ipc";
import type { FavoriteItem, FavoriteListSummary } from "@/lib/types";

export const LIBRARY_LIST_NAME = "Library";

export type FavoriteEntityType = "avatar" | "world" | "user" | "other";

export interface FavoriteToggleInput {
  type: string;
  target_id: string;
  list_name?: string;
  display_name?: string;
  thumbnail_url?: string | null;
}

export interface FavoriteMetadataInput {
  type: string;
  target_id: string;
  list_name?: string;
}

export function normalizeFavoriteType(type: string | null | undefined): FavoriteEntityType {
  if (type === "avatar" || type === "world" || type === "user") {
    return type;
  }
  return "other";
}

export function useFavoriteLists(enabled = true) {
  const query = useIpcQuery<undefined, { lists: FavoriteListSummary[] }>(
    "favorites.lists",
    undefined as undefined,
    {
      enabled,
      staleTime: 15_000,
    },
  );

  const mergedLists = useMemo(() => {
    const map = new Map<
      string,
      FavoriteListSummary & { types: FavoriteEntityType[] }
    >();

    for (const row of query.data?.lists ?? []) {
      const key = row.list_name;
      const existing = map.get(key);
      const normalizedType = normalizeFavoriteType(row.type);
      if (existing) {
        existing.item_count += row.item_count;
        if ((row.latest_added_at ?? "") > (existing.latest_added_at ?? "")) {
          existing.latest_added_at = row.latest_added_at;
        }
        if (!existing.types.includes(normalizedType)) {
          existing.types.push(normalizedType);
        }
        continue;
      }

      map.set(key, {
        ...row,
        types: [normalizedType],
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      (b.latest_added_at ?? "").localeCompare(a.latest_added_at ?? ""),
    );
  }, [query.data?.lists]);

  return {
    ...query,
    lists: query.data?.lists ?? [],
    mergedLists,
  };
}

export function useFavoriteItems(listName: string, enabled = true) {
  const query = useIpcQuery<{ list_name: string }, { items: FavoriteItem[] }>(
    "favorites.items",
    { list_name: listName },
    {
      enabled,
      staleTime: 15_000,
    },
  );

  const items = query.data?.items ?? [];
  const byType = useMemo(() => {
    return {
      avatar: new Set(
        items
          .filter((item) => normalizeFavoriteType(item.type) === "avatar")
          .map((item) => item.target_id),
      ),
      world: new Set(
        items
          .filter((item) => normalizeFavoriteType(item.type) === "world")
          .map((item) => item.target_id),
      ),
      user: new Set(
        items
          .filter((item) => normalizeFavoriteType(item.type) === "user")
          .map((item) => item.target_id),
      ),
      other: new Set(
        items
          .filter((item) => normalizeFavoriteType(item.type) === "other")
          .map((item) => item.target_id),
      ),
    };
  }, [items]);

  return {
    ...query,
    items,
    byType,
  };
}

async function invalidateFavoriteQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["favorites.lists"] }),
    queryClient.invalidateQueries({ queryKey: ["favorites.items"] }),
  ]);
}

export function useFavoriteActions(defaultListName = LIBRARY_LIST_NAME) {
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: async (input: FavoriteToggleInput) =>
      ipc.favoriteAdd({
        ...input,
        list_name: input.list_name ?? defaultListName,
        thumbnail_url: input.thumbnail_url ?? undefined,
      }),
    onSuccess: async () => invalidateFavoriteQueries(queryClient),
  });

  const removeMutation = useMutation({
    mutationFn: async (input: FavoriteToggleInput) =>
      ipc.favoriteRemove(
        input.type,
        input.target_id,
        input.list_name ?? defaultListName,
      ),
    onSuccess: async () => invalidateFavoriteQueries(queryClient),
  });

  const noteMutation = useMutation({
    mutationFn: async (input: FavoriteMetadataInput & { note: string }) =>
      ipc.favoriteNoteSet({
        ...input,
        list_name: input.list_name ?? defaultListName,
      }),
    onSuccess: async () => invalidateFavoriteQueries(queryClient),
  });

  const tagsMutation = useMutation({
    mutationFn: async (input: FavoriteMetadataInput & { tags: string[] }) =>
      ipc.favoriteTagsSet({
        ...input,
        list_name: input.list_name ?? defaultListName,
      }),
    onSuccess: async () => invalidateFavoriteQueries(queryClient),
  });

  async function toggleFavorite(input: FavoriteToggleInput, isFavorited: boolean) {
    if (isFavorited) {
      return removeMutation.mutateAsync(input);
    }
    return addMutation.mutateAsync(input);
  }

  async function saveFavoriteDetails(
    input: FavoriteMetadataInput & {
      note: string;
      tags: string[];
    },
  ) {
    const base = {
      type: input.type,
      target_id: input.target_id,
      list_name: input.list_name ?? defaultListName,
    };

    await noteMutation.mutateAsync({
      ...base,
      note: input.note,
    });
    await tagsMutation.mutateAsync({
      ...base,
      tags: input.tags,
    });
  }

  return {
    addFavorite: addMutation.mutateAsync,
    removeFavorite: removeMutation.mutateAsync,
    setFavoriteNote: noteMutation.mutateAsync,
    setFavoriteTags: tagsMutation.mutateAsync,
    saveFavoriteDetails,
    toggleFavorite,
    pending:
      addMutation.isPending ||
      removeMutation.isPending ||
      noteMutation.isPending ||
      tagsMutation.isPending,
  };
}
