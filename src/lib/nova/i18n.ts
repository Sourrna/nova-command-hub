import { useNova } from "./store";

const fa: Record<string, string> = {
  "Command Center": "مرکز فرماندهی", "Nova Core": "هسته نووا", "Plugin Hub": "مرکز افزونه‌ها", "AI Models": "مدل‌های هوش مصنوعی",
  Notion: "نوشن", Lovable: "لاوبل", GitHub: "گیت‌هاب", LinkedIn: "لینکدین", "Content Studio": "استودیو محتوا",
  Projects: "پروژه‌ها", Memory: "حافظه", "Activity Log": "گزارش فعالیت", Settings: "تنظیمات", Search: "جستجو",
  Operations: "عملیات", Connectors: "اتصال‌ها", Workspace: "فضای کار", "Pending approvals": "تأییدهای در انتظار",
};

export function useT() {
  const lang = useNova((s) => s.lang);
  return (k: string) => (lang === "fa" ? fa[k] ?? k : k);
}
