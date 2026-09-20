"use client";

import { useState } from "react";
import type React from "react";
import { addLineItem } from "../actions";

const CATEGORY_LABELS: Record<string, string> = {
  rebuilding: "Rebuilding",
  regulation: "Regulation",
  repair: "Repair",
  voicing: "Voicing",
  tuning: "Tuning",
};

export default function AddPhaseForm({ estimateId, catalog }: { estimateId: string; catalog: any[] }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [locationType, setLocationType] = useState("in_home");
  const [requiresVisit, setRequiresVisit] = useState(true);
  const [dependsOnPrevious, setDependsOnPrevious] = useState(false);
  const [catalogId, setCatalogId] = useState("");
  const [catalogDefaultPrice, setCatalogDefaultPrice] = useState<number | null>(null);
  const [category, setCategory] = useState("repair");

  const addLineItemBound = addLineItem.bind(null, estimateId);

  function applyCatalogItem(id: string) {
    setCatalogId(id);
    const item = catalog.find((c) => c.id === id);
    if (!item) {
      setCatalogDefaultPrice(null);
      return;
    }
    setDescription(item.name);
    setLocationType(item.default_location_type);
    setRequiresVisit(item.default_requires_client_visit);
    setDependsOnPrevious(item.default_depends_on_previous);
    setCatalogDefaultPrice(item.default_price !== null ? Number(item.default_price) : null);
    // Autofill the price too — this is the actual point. Leaving it blank
    // when there IS a stored standard price would just recreate the same
    // "type it again every time" friction this whole feature exists to fix.
    if (item.default_price !== null) setAmount(String(item.default_price));
  }

  const grouped = catalog.reduce((acc: Record<string, any[]>, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const amountNum = Number(amount);
  const priceChangedFromCatalog =
    catalogId && catalogDefaultPrice !== null && !Number.isNaN(amountNum) && amountNum !== catalogDefaultPrice;
  const priceIsNewForCatalogItem = catalogId && catalogDefaultPrice === null && amount !== "";

  return (
    <form action={addLineItemBound} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, border: "1px solid #eee", padding: 10 }}>
      {catalog.length > 0 && (
        <select
          value={catalogId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => applyCatalogItem(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value="">Pick from service catalog, or type a new one below…</option>
          {Object.entries(grouped).map(([cat, items]) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
              {(items as any[]).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.default_price !== null ? ` — $${Number(item.default_price).toFixed(2)}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <input type="hidden" name="catalog_id" value={catalogId} />

      <div style={{ display: "flex", gap: 8 }}>
        <input
          name="description"
          placeholder="Phase description (e.g. Restringing)"
          required
          value={description}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDescription(e.target.value); setCatalogId(""); setCatalogDefaultPrice(null); }}
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

      {/* The actual fix for "I have to retype the price every time": when
          a catalog item's price has changed (or never had one), offer to
          make this the standard going forward, checked by default so
          consistency is the path of least resistance rather than
          something you have to remember to do separately. */}
      {(priceChangedFromCatalog || priceIsNewForCatalogItem) && (
        <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", background: "#fef6e0", padding: 6 }}>
          <input type="checkbox" name="update_catalog_price" defaultChecked />
          {priceIsNewForCatalogItem
            ? `Set $${amount} as the standard price for "${description}"`
            : `Update the standard price for "${description}" to $${amount} for future estimates`}
        </label>
      )}

      {!catalogId && description && (
        <div style={{ background: "#f2ede1", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="save_as_new_service" defaultChecked />
            Save "{description}" as a reusable service — next time it's one click, not retyped
          </label>
          <select name="new_service_category" value={category} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)} style={{ padding: 6, fontSize: 12.5 }}>
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
