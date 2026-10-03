import {assertSuccessfulResponse, del, put} from "../core/http";
import {requireEntityPerm} from "../core/permissions";
import {beginEntityCommand, reportEntityCommandError} from "../shared/ui-helpers";
import {initEntityProperties} from './entity-properties';

/**
 * Header commands keep their existing API and permission guard while the surrounding entity
 * dialog owns drafts, locking and error placement. Only an explicit API success may refresh it.
 */
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

        button.addEventListener("click", async function uploadHeaderImage() {

            const input =
                document.getElementById("entityImageInput") as HTMLInputElement;

            if (!input.files?.length) {
                reportEntityCommandError(button, new Error('Choose an image to upload.'));
                return;
            }
            const command = beginEntityCommand(button);
            if (!command) return;

            const formData = new FormData();
            formData.append("image", input.files[0]);

            try {
                requireEntityPerm("EDIT_META", "updating header image");
                const response = await put(button.dataset.api!, formData);
                assertSuccessfulResponse(response);
                command.success('Image updated.');
            } catch (err) {
                command.error(err);
            }
        });
    }

    private registerDelete(): void {

        const button =
            document.querySelector(".js-delete-image") as HTMLButtonElement | null;

        if (!button)
            return;

        button.addEventListener("click", async function deleteHeaderImage() {

            if (!confirm("Delete the current header image?"))
                return;

            const command = beginEntityCommand(button);
            if (!command) return;

            try {
                requireEntityPerm("EDIT_META", "delete header image");
                const response = await del(button.dataset.api!);
                assertSuccessfulResponse(response);
                command.success('Image removed.');
            } catch (err) {
                command.error(err);
            }
        });
    }
}

export function initEntityHeader() {
    // Every root page already initializes its shared header, including the survey's default entry.
    // Register the dialog host before binding commands so those commands share its draft/error state.
    initEntityProperties();
    new EntityImageManager();
}

