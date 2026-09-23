"use client";

import { useState } from "react";
import type React from "react";
import { addLineItem } from "../actions";

const CATEGORY_LABELS: Record<string, string> = {
  rebuilding: "Rebuilding", voicing: "Voicing", actions_general: "Actions, General",
  bridle_straps: "Bridle Straps", butts_flanges: "Butts & Flanges", dampers: "Dampers",
  felt_leather: "Felt, Leather, Etc.", hammers: "Hammers",
  keys_keybed_keyframe: "Keys, Keybed & Keyframe", knuckles: "Knuckles",
  lyres_pedals_trapwork: "Lyres, Pedals & Trapwork", miscellaneous: "Miscellaneous",
  regulation: "Regulation", soundboards_bridges_plates: "Soundboards, Bridges & Plates",
  springs_action: "Springs, Action", strings_tuning_pins: "Strings & Tuning Pins",
  tuning: "Tuning", wippens: "Wippens",
};

export default function AddPhaseForm({
  estimateId,
  catalog,
  pianoType,
}: {
  estimateId: string;
  catalog: any[]; // each item includes service_catalog_prices: { piano_type, price }[]
  pianoType: string; // this estimate's piano's type - may be "" if unset on the piano record
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [locationType, setLocationType] = useState("in_home");
  const [requiresVisit, setRequiresVisit] = useState(true);
  const [dependsOnPrevious, setDependsOnPrevious] = useState(false);
  const [catalogId, setCatalogId] = useState("");
  const [catalogPriceForThisType, setCatalogPriceForThisType] = useState<number | null>(null);

  const addLineItemBound = addLineItem.bind(null, estimateId);

  function priceForType(item: any, type: string): number | null {
    const match = (item.service_catalog_prices ?? []).find((p: any) => p.piano_type === type);
    return match ? Number(match.price) : null;
  }

  function applyCatalogItem(id: string) {
    setCatalogId(id);
    const item = catalog.find((c) => c.id === id);
    if (!item) {
      setCatalogPriceForThisType(null);
      return;
    }
    setDescription(item.name);
    setLocationType(item.default_location_type);
    setRequiresVisit(item.default_requires_client_visit);
    setDependsOnPrevious(item.default_depends_on_previous);

    // Autofill using the price for THIS estimate's specific piano type —
    // not just any price the task happens to have. If this piano's type
    // isn't set, or this task has no price for that type yet, leave the
    // amount blank rather than guessing wrong (a grand and an upright
    // price for the same task can differ substantially in this catalog).
    const priceForThisPiano = pianoType ? priceForType(item, pianoType) : null;
    setCatalogPriceForThisType(priceForThisPiano);
    if (priceForThisPiano !== null) setAmount(String(priceForThisPiano));
    else setAmount("");
  }

  const grouped = catalog.reduce((acc: Record<string, any[]>, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const amountNum = Number(amount);
  const priceChangedFromCatalog =
    catalogId && catalogPriceForThisType !== null && !Number.isNaN(amountNum) && amountNum !== catalogPriceForThisType;
  const priceIsNewForThisType = catalogId && catalogPriceForThisType === null && amount !== "" && !!pianoType;

  return (
    <form action={addLineItemBound} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, border: "1px solid #eee", padding: 10 }}>
      {!pianoType && (
        <div style={{ fontSize: 12, color: "#a24b3b", background: "#f2ded8", padding: 6 }}>
          This piano has no type set (grand/upright/etc.) — catalog prices won't autofill until
          you set one on the piano's record, since the same task can price very differently by type.
        </div>
      )}

      {catalog.length > 0 && (
        <select
          value={catalogId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => applyCatalogItem(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value="">Pick from service catalog, or type a new one below…</option>
          {Object.entries(grouped).map(([cat, items]) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
              {(items as any[]).map((item) => {
                const p = pianoType ? priceForType(item, pianoType) : null;
                return (
                  <option key={item.id} value={item.id}>
                    {item.name}{p !== null ? ` — $${p.toFixed(2)}` : ""}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      )}
      <input type="hidden" name="catalog_id" value={catalogId} />
      <input type="hidden" name="piano_type" value={pianoType} />

      <div style={{ display: "flex", gap: 8 }}>
        <input
          name="description"
          placeholder="Phase description (e.g. Restringing)"
          required
          value={description}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDescription(e.target.value); setCatalogId(""); setCatalogPriceForThisType(null); }}
          style={{ flex: 2 }}
        />
        <input
          name="amount"
          type="number"
          step="0.01"
          placeholder="Amount"
          required
          value={amount}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          name="location_type"
          value={locationType}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLocationType(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="in_home">In-home</option>
          <option value="in_shop">Shop</option>
        </select>
        <input name="estimated_duration_days" type="number" placeholder="Est. days (optional)" style={{ flex: 1 }} />
      </div>
      <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          name="requires_client_visit"
          checked={requiresVisit}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRequiresVisit(e.target.checked)}
        />
        Requires a client visit/appointment (uncheck for shop-only phases like refinishing)
      </label>
      <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          name="depends_on_previous"
          checked={dependsOnPrevious}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDependsOnPrevious(e.target.checked)}
        />
        Can't start until the phase before it is completed
      </label>

      {pianoType && (priceChangedFromCatalog || priceIsNewForThisType) && (
        <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", background: "#fef6e0", padding: 6 }}>
          <input type="checkbox" name="update_catalog_price" defaultChecked />
          {priceIsNewForThisType
            ? `Set $${amount} as the standard ${pianoType.replace("_", " ")} price for "${description}"`
            : `Update the standard ${pianoType.replace("_", " ")} price for "${description}" to $${amount}`}
        </label>
      )}

      {!catalogId && description && (
        <div style={{ background: "#f2ede1", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="save_as_new_service" defaultChecked disabled={!pianoType} />
            Save "{description}" as a reusable service{pianoType ? "" : " (set this piano's type first)"}
          </label>
          <select name="new_service_category" defaultValue="miscellaneous" style={{ padding: 6, fontSize: 12.5 }}>
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
      )}

      <button type="submit" style={{ alignSelf: "flex-start" }}>Add phase</button>
    </form>
  );
}
