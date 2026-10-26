/** Reviewed image media and filename extensions share one browser-safe owner.
 * Choosers describe this policy; only server upload owners enforce it. */
const imageMedia = [
    {mime: 'image/jpeg', extensions: ['.jpg', '.jpeg']},
    {mime: 'image/png', extensions: ['.png']},
    {mime: 'image/gif', extensions: ['.gif']},
];
const pdfMedia = {mime: 'application/pdf', extensions: ['.pdf']};

export const imageMimeTypes: readonly string[] = Object.freeze(imageMedia.map(media => media.mime));
export const proofMimeTypes: readonly string[] = Object.freeze([...imageMimeTypes, pdfMedia.mime]);
export const imageFileAccept = imageMimeTypes.join(',');
export const proofFileAccept = proofMimeTypes.join(',');

/** Preserve each uploader's existing image/PDF switches, including neither.
 * Extensions and MIME types are independent admissions over the same descriptor. */
export function uploadFileMedia(allowImages: boolean, allowPdf: boolean) {
    // Preserve image-before-PDF selection for both independent parser checks.
    const admitted = [...allowImages ? imageMedia : [], ...allowPdf ? [pdfMedia] : []];
    return {mimeTypes: admitted.map(media => media.mime), extensions: admitted.flatMap(media => media.extensions)};
}

export function isImageMimeType(value: string): boolean { return imageMimeTypes.includes(value); }
export function isProofMimeType(value: string): boolean { return proofMimeTypes.includes(value); }
