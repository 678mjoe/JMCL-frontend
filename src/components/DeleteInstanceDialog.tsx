import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSettings } from "@/lib/settings";
import type { InstanceManifest } from "@/lib/types";

export interface DeleteInstanceDialogProps {
  instance: InstanceManifest | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Shared destructive confirmation for removing an instance directory. */
export function DeleteInstanceDialog({
  instance,
  deleting,
  onCancel,
  onConfirm,
}: DeleteInstanceDialogProps) {
  const { t } = useSettings();

  return (
    <Dialog
      open={instance !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("instances.deleteTitle")}</DialogTitle>
          <DialogDescription>
            {instance &&
              t("instances.deleteConfirm", { name: instance.name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={deleting}
          >
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
