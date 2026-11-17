export const TEMPLATE_CATEGORIES = Object.freeze({
  top3: "academic",
  workshop: "consistency",
  project: "academic",
  helped: "community",
});

export function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
