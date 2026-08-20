import { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";
import { parseLocation } from "@/lib/vrcFriends";
import { useSelfLocation } from "@/lib/useSelfLocation";
import { getWorldDetails } from "@/lib/vrchat-api";
import type { DbWorldVisit } from "@/lib/types";

export interface OscWorldContext {
  worldName: string;
  worldId: string;
  instanceId: string;
  instanceType: string;
}

const EMPTY: OscWorldContext = {
  worldName: "",
  worldId: "",
  instanceId: "",
  instanceType: "",
};

function visitToLocation(item: DbWorldVisit): OscWorldContext {
  const locRaw =
    item.instance_id && item.instance_id.startsWith("wrld_")
      ? item.instance_id
      : item.world_id && item.instance_id
        ? `${item.world_id}:${item.instance_id}`
        : item.world_id;
  const loc = parseLocation(locRaw ?? null);
  const type =
    loc.instanceType && loc.instanceType !== "unknown"
      ? loc.instanceType
      : (item.access_type ?? "");
  return {
    worldName: "",
    worldId: loc.worldId ?? item.world_id ?? "",
    instanceId: loc.instanceId ?? item.instance_id ?? "",
    instanceType: type,
  };
}

/**
 * Cheap world/instance snapshot for OSC tokens. Prefers the live
 * `user-location` pipeline location; falls back to the latest
 * `db.worldVisits.list` row. `{world.name}` is filled from `world.details`
 * once per world id (cached in component state, no new C++).
 */
export function useOscWorldContext(): OscWorldContext {
  const self = useSelfLocation();
  const [fromVisit, setFromVisit] = useState<OscWorldContext>(EMPTY);
  const [worldName, setWorldName] = useState("");

  useEffect(() => {
    let cancelled = false;
    ipc
      .call<{ limit: number; offset: number }, { items?: DbWorldVisit[] }>(
        "db.worldVisits.list",
        { limit: 1, offset: 0 },
      )
      .then((res) => {
        if (cancelled) return;
        const item = res?.items?.[0];
        setFromVisit(item ? visitToLocation(item) : EMPTY);
      })
      .catch(() => {
        if (!cancelled) setFromVisit(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const worldId = self.isInWorld && self.worldId ? self.worldId : fromVisit.worldId;
  const instanceId = self.isInWorld && self.instanceId ? self.instanceId : fromVisit.instanceId;
  const instanceType =
    self.isInWorld && self.info.instanceType && self.info.instanceType !== "unknown"
      ? self.info.instanceType
      : fromVisit.instanceType;

  useEffect(() => {
    if (!worldId) {
      setWorldName("");
      return;
    }
    let cancelled = false;
    getWorldDetails(worldId)
      .then((r) => {
        if (!cancelled) setWorldName(r.details?.name ?? "");
      })
      .catch(() => {
        if (!cancelled) setWorldName("");
      });
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  return { worldName, worldId, instanceId, instanceType };
}
