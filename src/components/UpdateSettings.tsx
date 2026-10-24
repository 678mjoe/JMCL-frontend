import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { updateAvailability } from "@/lib/updates";

export function UpdateSettings() {
  const { t } = useSettings();
  return (
    <section className="space-y-4" aria-labelledby="updates-heading">
      <h2 id="updates-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("updates.title")}
      </h2>
      <p className="text-sm">{t("updates.unconfigured")}</p>
      <p id="updates-unavailable" className="text-xs text-muted-foreground">{t("updates.hint")}</p>
      <Button variant="outline" disabled={!updateAvailability.canCheck} aria-describedby="updates-unavailable">
        {t("updates.check")}
      </Button>
    </section>
  );
}
