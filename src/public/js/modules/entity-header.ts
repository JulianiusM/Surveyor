import {del, put} from "../core/http";
import {requireEntityPerm} from "../core/permissions";
import {showInlineAlert} from "../shared/alerts";
import {reloadAfterDelay} from "../shared/ui-helpers";

class EntityImageManager {

    public constructor() {
        this.registerUpload();
        this.registerDelete();
    }

    private registerUpload(): void {

        const button =
            document.getElementById("uploadEntityImage") as HTMLButtonElement | null;

        if (!button)
            return;

        button.addEventListener("click", async () => {

            const input =
                document.getElementById("entityImageInput") as HTMLInputElement;

            if (!input.files?.length)
                return;

            const formData = new FormData();
            formData.append("image", input.files[0]);

            try {
                requireEntityPerm("EDIT_META", "updating header image");
                await put(button.dataset.api!, formData);
                showInlineAlert('success', 'image updated');
                reloadAfterDelay(1000);
            } catch (err) {
                const error = err as Error;
                showInlineAlert('error', error.message);
            }
        });
    }

    private registerDelete(): void {

        const button =
            document.querySelector(".js-delete-image") as HTMLButtonElement | null;

        if (!button)
            return;

        button.addEventListener("click", async () => {

            if (!confirm("Delete the current header image?"))
                return;

            try {
                requireEntityPerm("EDIT_META", "delete header image");
                await del(button.dataset.api!);
                showInlineAlert('success', 'image deleted');
                reloadAfterDelay(1000);
            } catch (err) {
                const error = err as Error;
                showInlineAlert('error', error.message);
            }
        });
    }
}

export function initEntityHeader() {
    new EntityImageManager();
}

