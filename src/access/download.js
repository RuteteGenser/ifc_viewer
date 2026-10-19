import { exportAccount } from "./api";
import { deleteModel, listModels } from "../library/api";

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Downloads every model the account owns, one after another. onProgress(i, n).
export async function downloadAllModels(onProgress) {
  const data = await exportAccount();
  const models = data?.models || [];
  for (let i = 0; i < models.length; i += 1) {
    onProgress?.(i + 1, models.length);
    const res = await fetch(models[i].downloadUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`download ${res.status}`);
    save(await res.blob(), models[i].name || `model-${i + 1}.ifc`);
  }
  return models.length;
}

export async function downloadAccountData() {
  const data = await exportAccount();
  save(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "argus-account-data.json");
}

// Deletes every saved model of the account (not folders, not files on the device). Returns how many.
export async function deleteAllModels() {
  const list = (await listModels()).filter((m) => m.owner === "me"); // samples are not the account's
  for (const m of list) await deleteModel(m.id);
  return list.length;
}
