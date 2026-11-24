/** Rejects removed free-text inputs from older forms, including repeated fields. */
export function assertNoOperationalFreeText(formData: FormData, ...fields: string[]): void {
  if (fields.some((field) => formData.getAll(field).some((value) => typeof value !== "string" || value.trim() !== ""))) {
    throw new Error("Free-text notes are unavailable. Refresh and use the available operational fields.");
  }
}
