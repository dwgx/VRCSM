import {
  cardPreview,
  coerceOscValue,
  type HardwareSnapshot,
  type OscStudioCard,
  type OscValueType,
} from "@/lib/osc-studio";

/** Shape returned by the `avatar.parameters.local` IPC method. */
export interface AvatarParametersResponse {
  avatar_id: string;
  user_id: string;
  path: string;
  parameters: Array<{
    name: string;
    value_type: OscValueType | string;
    default_value: unknown;
  }>;
}

/**
 * A card is "template style" when it renders a chatbox text line rather than a
 * single typed value. These cards edit a template string; everything else edits
 * a value + valueType pair.
 */
export function isTemplateCard(card: OscStudioCard): boolean {
  return card.template !== undefined || card.address === "/chatbox/input";
}

/** What actually goes on the wire for a card — the concrete OSC address + type. */
export interface OutgoingSpec {
  address: string;
  valueType: OscValueType;
  argPreview: string;
}

export function outgoingSpecForCard(
  card: OscStudioCard,
  hardware: HardwareSnapshot | null,
  now: Date,
): OutgoingSpec {
  if (isTemplateCard(card)) {
    return {
      address: "/chatbox/input",
      valueType: "string",
      argPreview: cardPreview(card, { hardware, now }),
    };
  }
  const coerced = coerceOscValue(card.valueType, card.value);
  return {
    address: card.address,
    valueType: card.valueType,
    argPreview: coerced === null ? card.value : String(coerced),
  };
}

export function safeValueType(type: string): OscValueType {
  return type === "int" || type === "float" || type === "string" || type === "bool"
    ? type
    : "float";
}
